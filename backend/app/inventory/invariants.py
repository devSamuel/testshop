from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


@dataclass(slots=True)
class InvariantResult:
    name: str
    description: str
    violations: list[dict[str, Any]] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return not self.violations


async def _check(session: AsyncSession, name: str, description: str, sql: str) -> InvariantResult:
    rows = (await session.execute(text(sql))).mappings().all()
    return InvariantResult(name=name, description=description, violations=[dict(r) for r in rows[:50]])


LEDGER_MATCHES_BALANCE = """
SELECT p.id AS product_id, p.sku, p.stock, COALESCE(SUM(m.delta), 0)::int AS ledger_sum
FROM products p
LEFT JOIN stock_movements m ON m.product_id = p.id
GROUP BY p.id
HAVING p.stock <> COALESCE(SUM(m.delta), 0)
"""

RUNNING_BALANCE_CHAIN = """
SELECT product_id, id AS movement_id, balance_after, running_sum
FROM (
    SELECT product_id, id, balance_after,
           SUM(delta) OVER (PARTITION BY product_id ORDER BY id) AS running_sum
    FROM stock_movements
) chain
WHERE balance_after <> running_sum
"""

NO_NEGATIVE_STOCK = """
SELECT id AS product_id, sku, stock FROM products WHERE stock < 0
"""

RESERVATIONS_MATCH_MOVEMENTS = """
SELECT r.order_id, r.product_id, r.status, r.quantity, COALESCE(SUM(m.delta), 0)::int AS net_movement
FROM stock_reservations r
LEFT JOIN stock_movements m
       ON m.product_id = r.product_id
      AND m.reference_type = 'order'
      AND m.reference_id = r.order_id::text
GROUP BY r.id
HAVING COALESCE(SUM(m.delta), 0) <> CASE WHEN r.status = 'released' THEN 0 ELSE -r.quantity END
"""


async def check_inventory(session: AsyncSession) -> list[InvariantResult]:
    return [
        await _check(session, "no_negative_stock", "Stock is never negative", NO_NEGATIVE_STOCK),
        await _check(
            session,
            "ledger_matches_balance",
            "products.stock equals the sum of its stock_movements",
            LEDGER_MATCHES_BALANCE,
        ),
        await _check(
            session,
            "running_balance_chain",
            "Every movement's balance_after equals the running sum of deltas",
            RUNNING_BALANCE_CHAIN,
        ),
        await _check(
            session,
            "reservations_match_movements",
            "Active/committed reservations net -quantity in the ledger; released ones net zero",
            RESERVATIONS_MATCH_MOVEMENTS,
        ),
    ]
