# The plan: as approved, and what happened to it

This document preserves the implementation plan I approved on **2026-10-02**, before any code was written. It then records, item by item, what was built, what changed during the build, and why. The plan was written in Claude Code's plan mode, which stores plans outside the repository. This copy keeps it with the code it produced.

**Related documents:**
- [`architecture.md`](architecture.md): the structure and patterns as built.
- [`build-journal/README.md`](build-journal/README.md): the chronological story.
- [`adr/`](adr): the individual decisions.

---

## Part 1: The plan as approved (2026-10-02)

### Context
The task is an e-commerce app: product CRUD, CSV import, search, a purchase flow with fake payment, a UI, Docker, and a README covering decisions and alternatives. The closing note says what matters most: *"ask the right questions and guide AI using your experience and foreseeing skills."* Working features alone aren't enough. The work has to anticipate failure modes, make its trade-offs explicit, and be ready for the future without over-building.

**Decisions taken while planning:**
- **Stack:** Python (FastAPI) + React (Vite/TS) + PostgreSQL.
- **Scope:** focused and polished.
- **Architecture:**
  - **Option A**, a future-ready monolith, was selected, with every recommended extra.
  - **Option B**, A plus an opt-in Kafka profile, was deferred: documented as an evolution step, not built.

I reached these through three questions:
1. "Shouldn't an enterprise app use a saga with a broker like Kafka?" → no broker for a single database; a saga only at the external payment boundary; an outbox so a broker can be added later.
2. "If checkout is synchronous, won't it bottleneck the database?" → a short lock window, a `202` fallback for slow payments, a hot-product benchmark, and a scaling ladder.
3. Which extras do the requirements imply? → each extra mapped to a phrase in the requirements.

### Quality goals (each must show up in code, tests and README)
1. **Messy CSV data:** validate every row, upsert by SKU, accept the good rows and report the bad ones row by row, offer a dry-run preview.
2. **No overselling:** atomic conditional stock decrement, plus a parallel-purchase test that proves it.
3. **Money correctness:** `NUMERIC`/`Decimal` everywhere, price snapshots on order lines, the server prices the order.
4. **Idempotent checkout:** an `Idempotency-Key` header means a double-click creates exactly one order.
5. **Checkout as an explicit saga:** reserve → charge → confirm or compensate, with an order state machine and a sweeper for stale reservations.
6. **Transactional outbox and transport-agnostic event handlers:** broker-ready by design.
7. **Soft delete** keeps order history intact.
8. **Postgres search:** full-text plus trigram matching, with pagination.
9. **README:** "Questions I'd ask and assumptions made", plus a distributed-evolution design doc.

### Shared core
- **Layout:** a modular monolith organised by domain (`catalog`, `inventory`, `orders`, `payments`, `events`, `core`, `api`). Modules call each other only through service interfaces.
- **Data model:**
  - `products`: SKU unique and normalised, `NUMERIC` price, `stock CHECK ≥ 0`, `version`, `deleted_at`, a weighted `tsvector` with a GIN index, trigram indexes;
  - `categories`;
  - `orders`: state machine, `idempotency_key UNIQUE`, `reservation_expires_at`;
  - `order_items`: price snapshots;
  - `import_runs`;
  - `outbox_events`: with retries and dead-letter columns;
  - `processed_events`: the inbox;
  - `stock_alerts`;
  - `stock_movements`: the ledger.
- **CRUD:** `/api/products`. A duplicate SKU or a stale `version` returns 409; DELETE is a soft delete.
- **Import:**
  - one `ImportService` behind both `POST /api/imports?dry_run=` and the CLI;
  - BOM and `utf-8-sig` handling, header normalisation, a lenient row model;
  - duplicate SKUs reported as warnings;
  - batched `INSERT … ON CONFLICT`;
  - partial success with a downloadable error CSV (escaped against CSV injection);
  - the final rules to be set after profiling the real CSV.
- **Search:** `websearch_to_tsquery` plus trigram similarity, an exact SKU match boosted, offset pagination.
- **Checkout:**
  1. Replay check on the idempotency key.
  2. Transaction 1: reserve with a conditional `UPDATE`, in product-id order.
  3. Charge with a ~3 s timeout, with no transaction held. Test cards approve, decline, or approve slowly (→ `202`).
  4. Transaction 2: confirm, or compensate by releasing stock.
  5. A sweeper that asks the provider before expiring an order.
- **Events:** an envelope, and registered idempotent handlers (low-stock alert, order notification) that don't know their transport.
- **Frontend:**
  - Shop: search, filters synced to the URL;
  - Cart and checkout: localStorage cart, one idempotency key per attempt;
  - Admin: products (with 409 handling), import (dry run → confirm), alerts;
  - Orders.
- **Testing:**
  - pytest on real Postgres, with unit and integration tests;
  - a concurrency test: 10 buyers, 1 unit, exactly 1 success;
  - Vitest; ruff, mypy, ESLint;
  - CI that runs lint, tests, the build and a Docker build.

### Option A, plus the extras
- **In-process dispatcher:** a lifespan task polling the outbox with `SKIP LOCKED`, one transaction per event, retries with backoff, and dead-lettering. The sweeper runs as a second task.
- **Extras, each mapped to a phrase in the requirements:**
  1. **CSV contract critique** in the README ("*proposed* csv structure").
  2. **Fuzz-tested importer** ("add the *date* you downloaded the CSV" → the file will change).
  3. **Inventory ledger**: append-only `stock_movements`, the invariant `stock == SUM(delta)`, a stock-history UI ("enterprise-grade").
  4. **Proof suite**: a Hypothesis state machine, `make chaos` (kill the app mid-checkout), and benchmarks on 100k products with `EXPLAIN`, plus a hot-product checkout benchmark and a scaling ladder ("foreseeing skills").
  5. **Reviewer experience**: a 5-minute reviewer's guide, ADRs, an AI log and a demo GIF ("ask the right questions and guide AI").
  6. **Light guardrails**: `import-linter`, a non-root image, `pip-audit` and `npm audit`.
- **Deliberately skipped:** Prometheus and Grafana, ETag/If-Match, a generated TS client, auth, and option B.

### Option B (deferred)
A Redpanda/Kafka profile with a relay (outbox → topic, keyed by `aggregate_id`), a consumer (inbox, retries, DLQ topic), and its own tests and CI job. The default `docker compose up` would stay identical to option A.

### Implementation order (one meaningful commit per step)
1. scaffolding
2. catalog and ledger
3. **profile the real CSV**, then the importer with fuzz tests
4. search
5. outbox, inbox and dispatcher
6. checkout saga and sweeper, with the concurrency and idempotency tests
7. stateful test, chaos and benchmarks
8. frontend
9. docs and a clean-clone verification
10. *(option B only)* the Kafka profile

### Verification (as planned)
- A clean `docker compose up --build`.
- The import: dry run, then re-import without duplicates.
- CRUD, including a 409 on a stale edit.
- Search for partial words, typos and SKUs.
- Every checkout path: approve, decline, double-click, out of stock, expiry, `202`.
- Alerts, the stock ledger and reconcile.
- `make chaos` PASS, `make bench`, and `make test` with CI green.

---

## Part 2: What happened to each part of the plan

| Plan item | Status | Notes |
|---|---|---|
| Stack (FastAPI, React, PostgreSQL) | ✅ Built | **PostgreSQL 16** rather than 17: the 17 image pull stalled on the build machine, and 16 has every feature used |
| Modular monolith | ✅ Built, and enforced | `import-linter` contracts in CI. CSV import became its own module, `app/importing` (the plan had it inside `catalog`), so that `catalog` stays below `inventory` in the layers |
| Data model | ✅ Built, and extended | Added `stock_reservations` (reservations as first-class rows), `notifications`, `payment_sim_charges` (the fake provider's own storage), and later `import_issues` plus file metadata on `import_runs` (migration `0002`) |
| Product CRUD with optimistic locking | ✅ Built, and hardened | After review: an `expected_stock` precondition on stock edits, and `DELETE` requires `version` |
| CSV import: dry run, partial success, upsert, error CSV | ✅ Built, and substantially changed | See the "changed during the build" table below: streaming, per-batch commits, first-row-wins duplicates, apply-by-run-id, a performance fix |
| "Final parsing rules after profiling the real CSV" | ✅ Done 2026-10-03 | The official file, `data/products.csv`, is now the reference: **its rows define the rules**. Every planted problem was already caught; five refinements were added from specific rows (identical duplicate → warning, HTML markup rejected, missing-weight and placeholder-stock warnings, a clearer `free` message). 95 rows → 87 imported, 7 rejected, 6 warnings |
| Search | ✅ Built, and improved | A **fuzzy fallback** for transposed letters (`keybaord`), added when a test showed a single threshold couldn't do both jobs |
| Checkout saga, reconciler, `202` fallback | ✅ Built | Plus a `RefundRequired` event for a payment that succeeds after its order expired |
| Events, outbox, inbox, dispatcher | ✅ Built, and changed | The dispatcher became **batched with a savepoint per event, with 4 parallel workers**; alerts became **convergent**, with a per-product advisory lock |
| Frontend | ✅ Built | By a sub-agent working from a written API contract, then reviewed. Includes a System health page (invariants, outbox, alerts, reconciler) and a Stock history page |
| Testing and CI | ✅ Built, and extended | 186 backend and 155 frontend tests when the plan was completed; 185 and 157 now, plus 6 Playwright end-to-end tests. CI also runs `alembic check` and asserts the container is non-root |
| Extra 1: CSV critique | ✅ | README "Critique of the proposed CSV structure" |
| Extra 2: fuzz-tested importer | ✅ | Found a real crash (a decimal overflow) |
| Extra 3: inventory ledger | ✅ | Plus a DB trigger that makes the ledger append-only, and 10 invariants exposed in the API |
| Extra 4: proof suite | ✅ | The stateful test found a real bug on its first run. The benchmark gained a **control group** (hot vs. spread: 87% at first, 85% in the latest run) |
| Extra 5: reviewer experience | ✅ | Reviewer's guide, 7 ADRs, AI log, build journal, demo GIF and screenshots |
| Extra 6: guardrails | ✅ | `import-linter`, non-root image, `pip-audit`, `npm audit` |
| Option B (Kafka) | 🟦 Deferred, as planned | Designed in [`evolution.md`](evolution.md) |
| Implementation order | ✅ Steps 1–9 | Built as 13 step-by-step commits; the history was consolidated into a single commit before publishing |
| Verification: Docker with the official base images | ✅ Verified in CI | Docker Hub pulls hung on the build machine, so local builds used build-arg stand-ins. CI's Docker job builds the official images (amd64) and passed on 2026-10-03 |
| Verification: CI on GitHub | ✅ Green | Pushed on 2026-10-03. The first run passed: linters, `alembic check`, tests on Postgres, dependency audits, and the Docker build with smoke tests |

### What changed during the build, and why

| Change | Trigger | Why it's better than the plan |
|---|---|---|
| **Convergent low-stock alerts** (re-read current stock) instead of reacting to a downward crossing | A smoke test: products imported with low stock never alerted | Correct under duplicate and out-of-order delivery, which a broker would require anyway |
| **Fuzzy search fallback** | A test with transposed letters | Catches `keybaord` without adding noise to every query |
| **Rows with extra values are errors**, not warnings | Writing dirty test data: an unquoted `12,99` shifted the columns | Prevents silently importing price 12, stock 99, weight 200 kg |
| **`plan_cache_mode = force_custom_plan` in imports** | Measuring a 100k-row import at 143 s | Generic-plan caching made it quadratic: **143 s → 17 s** |
| **Per-batch commits** instead of one transaction per file | Asking what happens to checkouts during a big import | No long locks on products being sold; re-runs are idempotent |
| **Batched, parallel outbox dispatcher** | Watching 100k events drain at ~700/s | ~1,400 events/s, with ordered batches and advisory locks so parallelism stays correct |
| **Benchmark control group and a realistic `EXPLAIN`** | The first benchmark couldn't separate lock cost from Python cost | Proves the hot-row lock isn't the bottleneck (87% at first, 85% in the latest run) |
| **`expected_stock` precondition; `DELETE` requires `version`** | The frontend sub-agent's review of the backend | Admin stock edits can't silently erase sales |
| **End-to-end streaming imports** (early `413`, streamed to disk, line-by-line parsing, `import_issues`, preview plus a streamed report, apply-by-run-id) | **I asked:** "aren't we streaming from the front end to the endpoint?" The first version loaded the whole file into memory | 100k rows: 252 → 98 MB peak memory; 1M rows supported; a 600k-issue report streams in 1.3 s; a 230 MB upload rejected with 0 bytes read |
| **Duplicate SKUs: first row wins, later rows are errors** (the plan said "last row wins", as a warning). Later refined by the official file: *identical* repeats are skipped with a warning; only *conflicting* repeats are errors | Streaming can't know which row is last without reading the whole file | Streamable, and it doesn't guess |
| **Upload path documented** (two copies on disk, kept by design) | My follow-up questions about headers, chunking and memory | The trade-off is explicit; the single-write alternative is documented and deferred |
| **Rules taken from the official example file** (identical duplicate → warning; HTML markup rejected; missing-weight and placeholder-stock warnings; a clearer `free` message) | **I provided the file** and directed that the rules come from it, with any extra rule documented | Every rule now traces to a row in the real data; unit tests and fixtures back the additional defensive rules |
| **README split between built and "Improvements and alternatives"** | My suggestion | Reviewers can see at a glance what runs and what is recommended (S3 + AWS parallel imports, Kafka, scaling) |
| **Background work moved to its own worker container** (`make up WORKERS=N`); the in-process option was then removed | **I asked:** "if we are limited by the GIL, shouldn't it be an isolated container that just polls?" | One event loop uses one core, so delivery now scales by container: 1,223 → 2,343 → 3,511 events/s with 1, 2 and 4 containers (ADR 0003) |
| **Separate worker process** (`python -m app.worker`; `make up-split` at the time, now the default) and a documented extraction path | **I asked:** "where do we say it's modular but ready to become microservices?" | Turns "ready to split" from a claim into something demonstrable: the API keeps working with the worker down, and the outbox delivers once it's back. The docs state honestly that the data isn't split yet, and how to split it |

### Still open
- Nothing from the plan itself. The repository is on GitHub and CI is green.
