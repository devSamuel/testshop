# ADR 0006: Append-only inventory ledger

**Status:** Accepted

## Context
"Why is stock 3?" must be answerable. Stock changes from four sources: admin edits, imports, reservations and releases. It's the same rule as in accounting: never change a balance without a journal entry.

## Decision
- `products.stock` is the **cached balance**, kept for fast atomic reservation.
- Every change writes a `stock_movements` row in the same transaction:
  - `delta`, `balance_after`, `reason`, and a reference to the order, import run or admin action.
- A database trigger rejects `UPDATE` and `DELETE` on `stock_movements`.
- Reservations are first-class rows (`active → committed | released`), so in-flight stock is visible.
- Invariants, checked by the test suite, the chaos script and `GET /api/admin/invariants`:
  1. `stock == SUM(delta)` for every product;
  2. `balance_after` equals the running sum of deltas, in order;
  3. active or committed reservations net `-quantity` in the ledger, and released ones net zero;
  4. order status matches reservation status;
  5. every paid order has a successful charge, and no customer is charged for an unpaid order unless a refund was flagged.

## Consequences
- Full audit trail and a per-product "Stock history" view.
- Drift is detectable, and the invariants endpoint can back an alert in production.
- Writes cost slightly more (one extra insert per change), which is negligible.

## Alternatives considered
- **Event sourcing (stock derived only from events):** more powerful, but every read becomes a projection. The cached balance plus ledger gives most of the benefit at a fraction of the complexity.
