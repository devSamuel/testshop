# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is
This is an e-commerce project, branded **"Test Shop"**: a FastAPI + PostgreSQL backend (`backend/`) and a React + Vite + Mantine SPA (`frontend/`), shipped as **one Docker image**. FastAPI serves both `/api` and the built SPA, and a separate Postgres container runs alongside it.

The README is the main deliverable alongside the code: reviewer's guide, decisions, the questions asked of the product owner, and evidence. Further docs:
- `docs/architecture.md`: structure, flows, data model, and a patterns catalog;
- `docs/plan.md`: the approved plan and how the build deviated from it;
- `docs/adr/`: one decision per file;
- `docs/upload-path.md`: how an upload travels hop by hop;
- `docs/evolution.md`: broker and scaling designs;
- `docs/scaling.md`: the recommended-but-not-built designs (the whole shop at scale on AWS with rate limiting, Redis, SQS and dead-letter queues; Elasticsearch or OpenSearch and hybrid semantic search; load and burst testing with k6; S3, parallel imports, Kafka, outbox at scale);
- `docs/questions.md`: all 25 product-owner questions and the assumption behind each;
- `docs/build-journal/README.md` and `docs/ai-log.md`: the build story and the AI corrections.

## Hard rule: no comments in code
The requirements say "if you use AI, remove comments from the code". **Do not add comments** in Python, TypeScript, SQL migrations, YAML, the Dockerfile or the Makefile. That includes `# noqa`, `eslint-disable` and `// TODO`.
- The frontend enforces it with a custom ESLint rule (`local/no-comments` in `frontend/eslint.config.js`).
- On the backend it's a convention. If a linter suppression seems necessary, restructure the code or use a `per-file-ignores` entry in `backend/pyproject.toml` instead (`bootstrap.py` uses `importlib` precisely to avoid a `# noqa`).
- Reasoning belongs in the README, `docs/adr/`, `docs/ai-log.md` or `docs/build-journal/README.md`.

## Hard rule: never name the company behind the requirements
**Never write the company's name**: not in code, docs, commit messages, package names, storage keys, Docker project, image or tag names, or images. The brand is **"Test Shop"**; the compose project and image are `test-shop`.
- Before committing, grep case-insensitively for the name, excluding `node_modules`, `.venv` and `.git`.
- **Screenshots can't be grepped.** If the UI text changes, recapture `docs/screenshots/` with `make screenshots` against a fresh stack (`make reset up`).

## Commands

### Whole stack
- `docker compose up --build` (or `make up`) runs migrations and seeds on start → http://localhost:8080.
  - It starts the API (`app`: endpoints and the SPA only) and a `worker` container (`python -m app.worker`).
  - The worker runs the outbox dispatchers and the reconciler and only polls Postgres.
- Ports: `APP_PORT=8088 DB_PORT=5433 docker compose up --build`.
- Base images are build args: `NODE_IMAGE` (default `node:22-alpine`) and `PYTHON_IMAGE` (default `python:3.13-slim`).
- `make reset` runs `docker compose down -v`, which also deletes the `shop_test` database.
- **Worker scaling:** `make up WORKERS=N` runs N worker containers. The count is `deploy.replicas: ${WORKERS:-1}` in compose, so any `docker compose up` keeps it.
  - The 4 dispatcher tasks share one event loop, so one CPU core per container. Scale with containers, not `DISPATCHER_WORKERS`.
  - `make drain-bench` measures the drain rate with 1, 2 and 4 containers.
  - The worker runs with `RUN_MIGRATIONS=false` (only the API container migrates) and a pool capped at 8.
- **The API never runs background work.** There is no in-process switch; only `app.worker` starts the dispatchers and the reconciler.

### Backend (Python 3.13, uv)
Run these from `backend/`.

| Task | Command |
|---|---|
| Install | `uv sync` |
| Lint | `make lint` (repo root): `ruff check`, `ruff format --check`, `mypy app` (**strict**), `lint-imports` (architecture contracts), plus frontend ESLint and `tsc` |
| All tests | `make test-backend` (repo root): starts the compose `db`, creates `shop_test` if missing, runs pytest |
| Unit tests only (no DB) | `make test-unit` |
| Single test | `TEST_DATABASE_URL=postgresql+asyncpg://shop:shop@localhost:5432/shop_test uv run pytest tests/integration/test_checkout.py::test_declined_card_compensates_stock -q` |
| Migrate | `uv run alembic upgrade head` |
| Check migrations match models | `uv run alembic check` (CI fails on drift) |
| CLI | `uv run python -m app.cli import <file.csv> [--dry-run]` · `seed-if-empty` · `seed-large --count N` |
| Dev server | `make dev-api` (repo root): API on :8000 with reload, against the compose DB; `make dev-worker` runs the background worker |

- **Tests need real Postgres.** Without `TEST_DATABASE_URL`, `tests/conftest.py` falls back to testcontainers.
- **For a single integration test after a volume reset,** create the DB first: `docker compose exec -T db psql -U shop -d shop -c "CREATE DATABASE shop_test"`.

### Frontend (Node 22.22+ or 24+)
Run these from `frontend/`.
- `npm run lint` (`--max-warnings 0`), `npm run typecheck`, `npm test` (Vitest), `npm run build`.
- Single test file: `npx vitest run src/lib/money.test.ts`; by name: `npx vitest run -t "clamps"`.
- End to end (Playwright, needs a running stack): `make e2e` or `BASE_URL=http://localhost:8080 npm run test:e2e`. Specs live in `frontend/e2e/`, use unique SKUs so reruns are safe, and must not contain comments either.
- Dev: `make dev-web` (repo root) proxies `/api` to `VITE_API_PROXY`, which defaults to `http://localhost:8080`; `make dev-web` points it at `:8000`.

### Evidence scripts (run against a live stack)
Run these from the repo root, using `BASE_URL=http://localhost:<port>`. They're local evidence, not load tests; load and burst testing at scale is recommended with k6 in `docs/scaling.md`, and the scripts stay as they are.
- `make chaos`: SIGKILLs the app mid-checkout, then checks the invariants.
- `make drain-bench`: outbox drain rate with 1, 2 and 4 worker containers.
- `make seed-large && make bench`: rewrites `docs/benchmarks.md`.
- `make invariants`

## Architecture (the parts that span files)

**Modular monolith with enforced layers.** `import-linter` contracts in `backend/pyproject.toml` fail CI on violations. Higher layers may import lower ones, never the reverse:

```
app.api → app.orders | app.importing → app.inventory → app.catalog → app.payments | app.events → app.core
```

`app.payments` and `app.events` must not import any domain module. Wiring lives outside the layers:
- **`bootstrap.py`** builds a `Container` (DB, payment provider, checkout service, reconciler, dispatcher, importer) and lists `HANDLER_MODULES`. A new event-handler module must be added there.
- **`main.py` and `worker.py`:**
  - `create_app()` builds the HTTP app only; its lifespan never starts background work.
  - `app.worker` is the only entrypoint that calls `bootstrap.start_background_workers()`. Tests drive `container.dispatcher.drain()` / `container.reconciler.run_once()` explicitly.

**Inventory: stock only changes through `app/inventory/service.py`.**
- Every stock change goes through `reserve` / `release_reservations` / `commit_reservations` / `set_stock` / `record_movement(s)`. Each writes an append-only `stock_movements` row (a DB trigger blocks UPDATE and DELETE) and an outbox event **in the same transaction**. Never `UPDATE products SET stock` anywhere else, or the ledger invariants break.
- `catalog.update_product` deliberately ignores stock. The API orchestrates `set_stock(..., expected_current=...)` for admin edits.
- Reservation is a single conditional `UPDATE … WHERE stock >= :qty`, with lines merged and sorted by product id to avoid deadlocks.

**Checkout saga (`app/orders/checkout.py`):**
1. `reserve`: transaction 1 inserts the order as `pending_payment` and reserves stock.
2. `charge`: no transaction held; payment idempotency key `order-{id}`; timeout → `202`.
3. `settle`: transaction 2 marks the order `paid`, or `payment_failed` and releases stock.

Rules:
- **Order status changes only via `transition()`**, a conditional UPDATE `WHERE status IN sources_for(target)`, so concurrent actors can't both win.
- `OrderReconciler` settles or expires stale pending orders by asking the provider first. A success after expiry emits `RefundRequired`.
  - It is **single-active across worker replicas**: `run_once` takes `pg_try_advisory_lock(RECONCILER_LOCK_NAMESPACE, 0)` on an autocommit connection, and the others return `skipped`.
  - The dispatchers stay parallel.
- The `Idempotency-Key` header plus a request fingerprint make retries safe.
- `FakePaymentProvider` stores charges in its own `payment_sim_charges` table to simulate an external system. Test cards: `4242…` approves, `4000…0002` declines, `4000…0101` approves slowly (~6 s).

**Events (`app/events/`): the transactional outbox.**
- `record_event` / `record_events` insert outbox rows in the caller's transaction.
- **Event catalog:**

  | Event | Written by | Handled by |
  |---|---|---|
  | `inventory.StockChanged` | every ledger row (`inventory/service.py`) | `sync_stock_alert` |
  | `orders.OrderPaid`, `OrderPaymentFailed`, `OrderExpired` | the order's state change (`orders/checkout.py`) | `send_order_notification` |
  | `orders.OrderPlaced`, `orders.RefundRequired` | `orders/checkout.py` | none (integration hooks) |

- **Writing events:** never call a handler or an external system directly from a state change. Write the event in the same transaction and let a handler react.
- **New side effect = new handler:** `@registry.handles(...)` in a domain `handlers.py`, with the module listed in `bootstrap.HANDLER_MODULES` (otherwise the event is marked published with no handler run).
- **Handler rules:**
  - idempotent (the `processed_events` inbox is automatic);
  - **convergent:** re-read current state rather than trusting the event payload;
  - see `inventory/handlers.py`, which also takes a per-product advisory lock because dispatchers run in parallel across containers;
  - for an external call (email, webhook), pass `event_id` as the provider's idempotency key, because the call can't share our transaction.
- **Payment is not an outbox command.** The charge is a direct call between the two checkout transactions. The reconciler doesn't read the outbox: it polls `orders` and reuses `settle()` / `expire()`, which write the same events.
- `InProcessDispatcher.dispatch_batch` claims rows with `SKIP LOCKED` and runs a savepoint per event, with retry/backoff and dead-lettering. It runs only in the worker container, and throughput scales with `WORKERS=N`, not with `DISPATCHER_WORKERS`.
- **Broker-ready:** handlers must not depend on how events arrive. A future Kafka relay replaces the dispatcher in the worker container (`docs/evolution.md`). Published rows are not cleaned up yet (README, "Outbox at scale").

**CSV import (`app/importing/`):**
- `parsing.py` is pure, fuzz-tested by Hypothesis, and streams:
  - `CsvStream.open()` does a pre-pass (encoding detection and line count);
  - `next_batch()` yields batches of rows plus `Issue`s;
  - `parse_record` and the field parsers deliberately **refuse to guess**: unknown stock, textual prices (`free`), non-USD prices and more than 2 decimals on money are row errors;
  - HTML markup in product text is an error (also enforced by the API schemas through `contains_markup` in `catalog/normalize.py`). SQL-looking text is kept: parameterized SQL is the defence;
  - repeated SKUs: an **identical** repeat is skipped with a warning; a **conflicting** repeat is an error, and the first row is kept;
  - each rule traces to a row of the official file (README, "Rules derived from the official example file"). Rules beyond it are listed in the addendum of `docs/adr/0005-partial-success-import.md`.
- `service.py`:
  - `store_upload` streams through the `UploadStore` port (`storage.py`, local disk) with a SHA-256;
  - `run()` either does a dry run (classifies batches, no writes) or applies with **one transaction per batch**, using `plan_cache_mode = force_custom_plan` to avoid a generic-plan performance trap;
  - issues go to the `import_issues` table (the API returns a 1,000-issue preview plus a streamed CSV);
  - `apply(run_id)` applies a stored dry run without a re-upload.
- `core/limits.py` enforces the upload size and must raise `HTTPException(413)`: FastAPI converts any other exception raised while reading the body into a `400`.

**Invariants as executable truth.**
- `inventory/invariants.py` and `orders/invariants.py`: ledger equals balance, the running balance chain, reservations vs. movements, order vs. reservation status, paid orders vs. provider charges, and so on.
- They're exposed at `GET /api/admin/invariants` and asserted by the integration tests, the Hypothesis state machine (`tests/integration/test_stateful.py`) and `make chaos`. New stock or order flows must keep them green.

**Errors and money:**
- Raise `DomainError` subclasses from `core/errors.py`; they render as RFC 7807 `application/problem+json`, with a `type` slug the frontend matches on.
- Money is `Decimal` / `NUMERIC(12,2)` and is serialized as JSON strings. The frontend does arithmetic in integer cents (`frontend/src/lib/money.ts`). Never use floats for money.

**Frontend:**
- `src/api/` holds the typed `apiFetch` / `ApiError` (problem+json parsing) and one module per resource.
- `src/features/*` holds pages. `src/lib/idempotency.ts` reuses the same key on network or 5xx errors and rotates it when the payload changes.
- Never render product text as HTML (no `dangerouslySetInnerHTML`). `src/features/shop/ProductCard.test.tsx` guards this with the official file's XSS payload.

## Conventions and gotchas
- **Migrations:** add a new numbered file in `backend/migrations/versions/` (the latest is `0002`); never edit applied ones. Constraint names follow the naming convention in `core/db.py`. Test upgrade → `alembic check` → downgrade → upgrade.
- **New tables** must be added to `TABLES` in `tests/conftest.py`, which truncates them between tests.
- **Logging:** `extra={...}` keys must not collide with `LogRecord` attributes. `created`, `name` and `msg` once crashed every import at INFO level.
- **Security scope:** authentication and authorization are deliberately out of scope. Don't add them. Document security gaps in the README's "Security scope" section and ADR 0008 instead.
- **Docs:** keep the README short (about 350 lines) and put depth in `docs/`. It separates what is built from what is recommended but not built: the README's "Scope" section has the summary table, and the designs live in `docs/scaling.md`. The README shows the top 8 product-owner questions; all of them live in `docs/questions.md`. Record significant decisions as ADRs, and record AI mistakes and corrections in `docs/ai-log.md`.
- **Test data:** `data/products.csv` is the example file that came with the requirements (downloaded 2026-10-02). The app seeds from it, and its rows define the import rules (README, "Rules derived from the official example file"); `test_official_example_file_end_to_end` pins the outcome. It's the only data file, and `.gitignore` keeps anything else in `data/` out of git; the extra parser rules are covered by unit tests and the fixtures in `backend/tests/fixtures`.
