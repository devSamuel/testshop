# Chaos experiment: kill the app mid-checkout

`make chaos` ([`scripts/chaos.py`](../scripts/chaos.py)) runs against the live Docker Compose stack:

1. Restarts the app with a short reservation TTL (15 s) so the experiment finishes quickly.
2. Creates a product with **5 units**.
3. Starts **50 concurrent buyers**:
   - 60% approved cards, 20% declined, 20% slow-approval cards (about 6 s);
   - each buyer has its own `Idempotency-Key`;
   - each buyer behaves like a well-written client: on a dropped connection or a 5xx, it retries **with the same key** until it gets a definitive answer.
4. **SIGKILLs the app container 0.3 s into the race**, while requests are in flight and slow payments are mid-call, then starts it again.
5. Waits for the reconciler to settle every pending order, then checks the books.

## Result (final build, 100k-product catalog)

| Metric | Value |
|---|---|
| Buyers / units | 50 / 5 |
| App downtime (SIGKILL → ready) | 2.5s |
| Buyers that hit a dropped connection and retried with the same key | 50 |
| Final HTTP codes | {200: 2, 201: 2, 202: 1, 409: 45} |
| Orders by final status | {'paid': 4, 'expired': 1} |
| Total time until settled | 16.9s |

| Check | Result | Detail |
|---|---|---|
| units sold + remaining stock == initial stock | PASS | 4 + 1 = 5 |
| no overselling | PASS | sold 4 of 5 |
| every buyer got exactly one definitive answer | PASS | 50 buyers |
| no duplicate or orphan orders after retries | PASS | 5 orders, 5 seen by clients |
| no order left pending | PASS | {'paid': 4, 'expired': 1} |
| all data-integrity invariants hold | PASS | 10/10 checks |

**CHAOS RESULT: PASS**

## Reading the result
- **`200` responses are idempotent replays.** These clients lost their connection when the app died. Their retry, using the same key, returned the order that already existed instead of creating a second one.
- **The `expired` order** was reserved just before the kill, and its charge never reached the provider. After the TTL, the reconciler asked the provider, found no charge, released the unit back to stock and closed the order. The customer was not charged.
- **Why that order is not resumed automatically:** the card number is never stored (PCI scope), so the server *cannot* retry the charge on the customer's behalf. Expiring it and letting the client retry is the safe outcome.
- **The `202`** was a slow-approval card. The charge was recorded at the provider before the crash; after the restart, the reconciler found the successful charge and marked the order `paid`.
- **The ledger agrees:** the 10 invariants recompute stock from the append-only ledger and cross-check orders, reservations and provider charges.

An earlier run on a smaller catalog ended with `{'paid': 2, 'expired': 3, 'payment_failed': 1}` and also passed. The outcomes differ from run to run because the timing of the kill is non-deterministic. The invariants hold every time.
