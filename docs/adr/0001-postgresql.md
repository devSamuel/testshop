# ADR 0001: PostgreSQL as the single local database

**Status:** Accepted

## Context
The requirements call for a local database (SQL or NoSQL). The domain is relational: products, categories, orders, order lines, stock reservations and a stock ledger. Money must be exact. Checkout must not oversell under concurrency. Search has to tolerate typos.

## Decision
Use PostgreSQL 16, run through Docker Compose, accessed through SQLAlchemy 2 (async) and migrated with Alembic.

## Consequences
- `NUMERIC(12,2)` gives exact money, and `CHECK (stock >= 0)` makes overselling impossible even if application code has a bug.
- Row-level locks, conditional `UPDATE … RETURNING` and `FOR UPDATE SKIP LOCKED` provide the concurrency primitives the checkout saga and the outbox need.
- The built-in full-text search plus the `pg_trgm` extension remove the need for a separate search engine at this scale.
- Partial unique indexes give soft delete with reusable SKUs, and only one open alert per product.
- Tests run against real Postgres, never SQLite, because the behaviour under test (locking, search, constraints) is Postgres-specific.

## Alternatives considered
| Option | Why not |
|---|---|
| SQLite | A single-container story is attractive, but it has database-level write locking, no `SKIP LOCKED` and weaker search. The concurrency guarantees would be hard to prove. |
| MongoDB | Atomic `$inc` with a guard works for stock, but orders, lines, reservations and the ledger are relational. Multi-document transactions are heavier than in Postgres. |
| MySQL | Viable, but Postgres has better full-text plus trigram search, partial indexes and `RETURNING`. |
