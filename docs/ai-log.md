# How I used AI on this project

**Tooling:** Claude Code (Claude Opus 5.5). **Rule:** nothing was accepted because it looked right; every behavior is pinned by a test on real Postgres.

## Guardrails set before any code
- Money is `Decimal` / `NUMERIC(12,2)`; the frontend sums integer cents.
- Stock is reserved with one conditional `UPDATE … WHERE stock >= :qty`, never check-then-update.
- Every order needs an `Idempotency-Key`; no transaction is held across the payment call.
- Side effects go through an outbox with idempotent handlers.
- The importer never guesses: ambiguous values are row errors.
- Every import rule traces to a row of the provided example file.
- No comments in code, as the brief asks.

## Questions that changed the design

| I asked | What changed |
|---|---|
| "Shouldn't an enterprise app use a saga with Kafka?" | A saga replaces an ACID transaction you can't have; here everything is in one Postgres. The saga stays only around the external payment call, with an outbox so a broker can be added later. |
| "Won't concurrent buyers bottleneck the database?" | The lock covers only the reservation; a slow provider gets a `202` fallback settled by a reconciler; a hot-product benchmark measures it. |
| "Aren't we streaming from the front end to the endpoint?" | The honest answer was "only half way": the upload was read into memory. It now streams end to end; 100k rows went from 252 MB to 98 MB peak. |
| "If we're limited by the GIL, shouldn't the workers be an isolated container?" | Background work moved out of the API process into a worker container scaled by replicas (measured 1,223 → 3,511 events/s with 1 → 4 containers). |
| "Did moving to isolated workers lose anything?" | Checked against the live database: nothing lost, but N workers meant N reconcilers querying the provider. Now one is active, through an advisory lock. |

## Where the AI was wrong, and how it was caught

| # | First version | Caught by | Fix |
|---|---|---|---|
| 1 | A crash right after a successful charge would expire the order and release its stock while the customer stayed charged | Walking through the saga step by step | The reconciler asks the provider before expiring; a late success raises `RefundRequired` |
| 2 | A 100k-row import took 143 s; two plausible causes were disproved by measurement | Timing every SQL statement | Postgres reused a plan chosen while the table was empty; `plan_cache_mode = force_custom_plan` for imports: **143 s → 17 s** |
| 3 | A logging field named `created` (reserved) would have turned every committed import into a 500 | The Hypothesis state machine, on its first run | Renamed the keys and hardened the log formatter |
| 4 | Rows with extra values were only a warning; `12,99` unquoted would import price 12, stock 99 | Deliberately dirty test data | Shifted rows are now errors |
| 5 | A one-file transaction locked updated products for the whole import | Asking "what happens to checkouts during a large import?" | Per-batch commits, safe because re-runs are idempotent |
| 6 | An admin stock edit could erase units sold since the form opened | The frontend sub-agent was told to report backend gaps, not work around them | An `expected_stock` precondition (`409` if stale) |
| 7 | A 26-digit weight crashed the parser | Hypothesis fuzzing | Check magnitude before rounding |

## How the work was split
The backend, tests and docs were built in the main session. The frontend was built by a sub-agent from a written API contract; I reviewed its riskiest code (money, idempotency keys, the `202` polling loop) and re-ran all its checks.
