from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.events.models import OutboxEvent
from app.inventory.invariants import InvariantResult
from app.orders.checkout import REFUND_REQUIRED, payment_key
from app.orders.models import Order, OrderStatus
from app.payments.provider import ChargeStatus, PaymentProvider

ORDER_MATCHES_RESERVATIONS = """
SELECT o.id AS order_id, o.status, r.product_id, r.status AS reservation_status
FROM orders o
JOIN stock_reservations r ON r.order_id = o.id
WHERE r.status <> CASE o.status
    WHEN 'pending_payment' THEN 'active'
    WHEN 'paid' THEN 'committed'
    ELSE 'released'
END
"""

ORDER_HAS_RESERVATION_PER_ITEM = """
SELECT o.id AS order_id, i.product_id
FROM orders o
JOIN order_items i ON i.order_id = o.id
LEFT JOIN stock_reservations r ON r.order_id = o.id AND r.product_id = i.product_id
WHERE r.id IS NULL OR r.quantity <> i.quantity
"""

ORDER_TOTAL_MATCHES_LINES = """
SELECT o.id AS order_id, o.total, SUM(i.line_total) AS lines_total
FROM orders o
JOIN order_items i ON i.order_id = o.id
GROUP BY o.id
HAVING o.total <> SUM(i.line_total)
"""

NO_STUCK_PENDING_ORDERS = """
SELECT id AS order_id, reservation_expires_at
FROM orders
WHERE status = 'pending_payment'
  AND reservation_expires_at < now() - make_interval(secs => :grace)
"""


async def check_orders(session: AsyncSession, stuck_grace_seconds: int = 120) -> list[InvariantResult]:
    async def run(name: str, description: str, sql: str, **params: object) -> InvariantResult:
        rows = (await session.execute(text(sql), params)).mappings().all()
        return InvariantResult(name=name, description=description, violations=[dict(r) for r in rows[:50]])

    return [
        await run(
            "order_status_matches_reservations",
            "pending→active, paid→committed, failed/expired→released",
            ORDER_MATCHES_RESERVATIONS,
        ),
        await run(
            "order_items_reserved",
            "Every order line has a reservation for the same quantity",
            ORDER_HAS_RESERVATION_PER_ITEM,
        ),
        await run(
            "order_total_matches_lines", "Order total equals the sum of its lines", ORDER_TOTAL_MATCHES_LINES
        ),
        await run(
            "no_stuck_pending_orders",
            "No order stays pending long after its reservation expired",
            NO_STUCK_PENDING_ORDERS,
            grace=stuck_grace_seconds,
        ),
    ]


async def check_payments(
    session: AsyncSession, provider: PaymentProvider, limit: int = 500
) -> list[InvariantResult]:
    closed = (
        await session.execute(
            select(Order.id, Order.status, Order.payment_ref)
            .where(Order.status != OrderStatus.pending_payment)
            .order_by(Order.id.desc())
            .limit(limit)
        )
    ).all()
    refund_flagged = set(
        (
            await session.scalars(
                select(OutboxEvent.aggregate_id).where(OutboxEvent.event_type == REFUND_REQUIRED)
            )
        ).all()
    )
    paid_without_charge: list[dict[str, object]] = []
    charged_but_unpaid: list[dict[str, object]] = []
    for order_id, status, payment_ref in closed:
        charge = await provider.get_status(payment_key(order_id))
        charged = charge.status is ChargeStatus.succeeded
        if status == OrderStatus.paid and (not charged or payment_ref != charge.reference):
            paid_without_charge.append({"order_id": order_id, "provider_status": charge.status.value})
        if status != OrderStatus.paid and charged and str(order_id) not in refund_flagged:
            charged_but_unpaid.append({"order_id": order_id, "status": status})
    return [
        InvariantResult(
            "paid_orders_have_successful_charge",
            "Every paid order matches a succeeded charge at the payment provider",
            paid_without_charge[:50],
        ),
        InvariantResult(
            "no_charge_without_paid_order",
            "No customer is charged for an order that is not paid (unless a refund was flagged)",
            charged_but_unpaid[:50],
        ),
    ]
