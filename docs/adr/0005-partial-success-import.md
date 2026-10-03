# ADR 0005: CSV import accepts valid rows, reports invalid ones, and never guesses

**Status:** Accepted

## Context
The proposed structure says `stock (string/int)`, and the example file has to be downloaded on a specific date. Both hint that real files are dirty and change over time. An importer that crashes on one bad row is useless; one that silently "fixes" bad data is dangerous.

## Decision
- **Partial success.** Valid rows are upserted by SKU. Invalid rows are reported with row number, field, raw value and reason. The downloadable issues CSV escapes cells against CSV injection.
- **Dry run first, then apply by run id.** The dry run stores the file (with a SHA-256) and previews creates, updates, unchanged rows and warnings. Confirming applies that stored file with no re-upload. Stored uploads expire after 24 h.
- **Normalize only what is unambiguous, and warn about it:** BOM, Windows-1252, `;`/tab/`|` delimiters, header aliases, `$1,299.99`, `12 units`, `500 g`/`2 lb` → kg, category casing.
- **Refuse what is ambiguous:** unknown stock (`N/A`), text prices (`free`), non-USD currency, more than 2 decimals on money, negative values, HTML markup, and rows with more values than the header (an unquoted `12,99` would shift price, stock and weight).
- **Duplicate SKUs in one file:** the first row is kept and a conflicting repeat is an error naming the earlier row. An identical repeat is skipped with a warning. Choosing a winner silently would be a guess, and a streaming parser can't know which row is last.
- **Stock is absolute.** Units reserved by in-flight checkouts are subtracted, so an import can't resurrect stock that is being sold.
- **Commit per batch of 500 rows.** A file-wide transaction would hold row locks on updated products and block their checkouts for the whole import. Per-batch commits are safe because the dry run validated every row and re-running a file is idempotent (upsert by SKU, absolute stock, unchanged rows skipped). A mid-file failure is reported as `failed` with "re-running is safe", and a test proves a re-run converges.
- **Stream end to end.** A middleware returns `413` for oversized uploads before or while reading the body; the file is streamed to disk; rows are parsed and committed in batches; issues go to an `import_issues` table. Memory depends on the number of distinct SKUs, not file size.
- **Audit.** Every import writes an `import_runs` row and ledger entries. Price changes of ±50% or more are flagged.
- **Query plan.** The existing-SKU lookup runs with `plan_cache_mode = force_custom_plan` for the import transaction only. Without it, Postgres reused a plan chosen while the table was empty, which made large imports quadratic.

## Consequences
- The parser is fuzz-tested with Hypothesis: arbitrary bytes produce a structured rejection, never an exception. The fuzzer found one real crash (a 26-digit weight), now fixed with a regression test.
- The upload is on disk twice: Starlette's spool file, then the durable copy that apply-by-run-id needs. Writing straight to the store would save a fraction of a second per 100 MB and isn't worth owning multipart parsing.
- Throughput and memory figures are in [benchmarks](../benchmarks.md).
- Limits: 200 MB and 1,000,000 data rows per file, both configurable. Larger files would need direct-to-storage uploads and a background job.

## Alternatives considered
- **All-or-nothing in one transaction:** the first implementation; rejected after measuring its lock time. The dry run gives "review before writing" without the locks.
- **Lenient coercion** (`N/A` → 0, rounding prices): silent data changes are worse than a clear error.
- **Load the whole file into memory:** the first implementation; peak memory was about 10× the file size.
- **Re-upload on confirm:** the confirmed bytes could differ from what was reviewed.

## Rules traced to the example file
`data/products.csv` (downloaded 2026-10-02) is the reference. Reading it row by row added five refinements: identical duplicates become warnings (row 89), HTML markup is rejected (row 20), a missing weight gets a warning (row 50), `99999` stock is flagged as a likely placeholder (row 52), and text prices get a clearer message (row 7). Result: 95 rows → 87 imported, 7 rejected, 6 warnings. The [README](../../README.md#rules-derived-from-the-example-file) lists every row.
