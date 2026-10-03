# ADR 0004: Atomic stock reservation with an append-only ledger

**Status:** Accepted

## Context
Two problems share one table. The classic oversell bug is check-then-act: two buyers both read `stock = 1` and both buy the last unit. And "why is stock 3?" must be answerable, because stock changes from four sources: admin edits, imports, reservations and releases.

## Decision
**Reserve with one conditional statement:**

```sql
UPDATE products
SET stock = stock - :qty
WHERE id = :id AND stock >= :qty AND deleted_at IS NULL
RETURNING stock, sku, name, price
```

- Lines are merged and processed in ascending `product_id` order, so carts with the same products in opposite order cannot deadlock.
- If any line returns no row, the transaction rolls back and the API returns `409` listing every short item. `CHECK (stock >= 0)` is the last line of defense.
- The price comes from the database (`RETURNING price`), never from the client.

**Record every change in a ledger:**
- `products.stock` is the cached balance used by the reservation above.
- Every change writes a `stock_movements` row (`delta`, `balance_after`, `reason`, reference) in the same transaction. A trigger rejects `UPDATE` and `DELETE` on that table.
- Reservations are rows of their own (`active → committed | released`), so in-flight stock is visible.
- Invariants are checked by the tests, the chaos script and `GET /api/admin/invariants`: stock equals the sum of deltas, the running balance chain holds, reservations net correctly in the ledger, and order status matches reservation and charge status.

## Consequences
- Overselling is impossible by construction; `test_last_unit_is_sold_exactly_once` and the chaos test prove it.
- The row lock lasts only for the reservation transaction (about 1–5 ms); the payment call happens outside it. 200 buyers on one product reach 85% of the throughput of 200 buyers on different products ([benchmarks](../benchmarks.md)).
- A full audit trail backs the per-product "Stock history" view, and drift is detectable. The cost is one extra insert per change.

## Alternatives considered
- **`SELECT … FOR UPDATE`, then check, then update:** correct, but two round trips while holding the lock.
- **Optimistic version check plus retry:** a hot product causes retry storms.
- **Redis counter in front of the database:** helps flash sales at very high scale, but adds a second source of truth.
- **Mutable stock column only:** no audit trail.
- **Event sourcing:** every read becomes a projection; the cached balance plus ledger gives most of the benefit for much less complexity.
