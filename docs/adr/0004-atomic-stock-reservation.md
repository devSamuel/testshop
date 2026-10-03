# ADR 0004: Reserve stock with a single conditional UPDATE

**Status:** Accepted

## Context
The classic oversell bug is check-then-act: `SELECT stock` → `if stock >= qty` → `UPDATE`. Two buyers both read `1` and both buy the last unit.

## Decision
Reserve each line with one atomic statement:

```sql
UPDATE products
SET stock = stock - :qty
WHERE id = :id AND stock >= :qty AND deleted_at IS NULL
RETURNING stock, sku, name, price
```

Lines are merged and processed in ascending `product_id` order, so two carts that contain the same products in opposite order cannot deadlock. If any line returns no row, the whole transaction rolls back and the API returns `409` listing every short item with its available quantity. `CHECK (stock >= 0)` is the last line of defense.

## Consequences
- Overselling is impossible by construction. `test_last_unit_is_sold_exactly_once` and the chaos test prove it.
- The row lock is held only for transaction 1, roughly 1–5 ms. The payment call happens outside it, so even a single hot product sustains high throughput (see [`docs/benchmarks.md`](../benchmarks.md)).
- The price comes from the database (`RETURNING price`), never from the client.

## Alternatives considered
- **`SELECT … FOR UPDATE`, then check, then update:** correct, but two round trips while holding the lock.
- **Optimistic version check plus retry:** a hot product causes retry storms.
- **Redis counter in front of the database:** useful for flash sales at very high scale, but it adds a second source of truth. This is step 5 of the [checkout scaling ladder](../evolution.md#checkout-scaling-ladder).
