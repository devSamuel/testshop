# ADR 0006: Postgres full-text plus trigram search with a fuzzy fallback

**Status:** Accepted

## Context
Shoppers type partial words ("headph"), make typos ("headphnes", "keybaord") and paste SKUs. `LIKE '%q%'` cannot use a B-tree index, does not rank, and does not handle typos.

## Decision
- A generated, weighted `tsvector` (name A, sku B, description C) with a GIN index; prefix `to_tsquery` handles partial words.
- `pg_trgm` GIN indexes on name and sku. `q <% name` (word similarity ≥ 0.45) handles typos, and `sku ILIKE 'q%'` handles SKU prefixes.
- Ranking: exact SKU match first, then `ts_rank_cd`, then word similarity.
- **Fuzzy fallback.** If the strict query returns nothing, retry once at threshold 0.3 and return `fuzzy: true`, so the UI says "showing approximate matches". This catches transposed letters without adding noise to normal searches.
- Offset pagination with a windowed `count(*) OVER ()`, so one query returns both the page and the total.

## Consequences
- The planner uses a `BitmapOr` across the three indexes; see the `EXPLAIN` output in [`docs/benchmarks.md`](../benchmarks.md).
- No extra infrastructure is needed.

## Alternatives considered
- **Elasticsearch/OpenSearch/Meilisearch:** better relevance tuning, facets and synonyms, but a second datastore to keep in sync. It becomes the right choice when there are millions of products, multiple languages, or merchandising rules. Search already has one entry point and outbox events on every product change, so an indexer can subscribe later.
- **Semantic search with embeddings:** finds products by meaning rather than words ("something to keep coffee hot" finds the thermos flask), with pgvector in the same Postgres or OpenSearch k-NN. It's weak on exact SKUs and needs an embedding pipeline and a relevance evaluation, so it would run as a hybrid with keyword search, merged by reciprocal rank fusion. It's the next step after a dedicated engine, or directly after today's design with pgvector.
- **Keyset pagination:** better for deep pages. It is listed as the next step, because offset is fine for UI-sized pages and supports "jump to page N".
