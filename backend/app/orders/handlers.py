import logging

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.events.envelope import EventEnvelope
from app.events.registry import registry
from app.orders.checkout import ORDER_EXPIRED, ORDER_PAID, ORDER_PAYMENT_FAILED
from app.orders.models import Notification, Order

logger = logging.getLogger("orders.notifications")

SUBJECTS = {
    ORDER_PAID: ("order_paid", "Your order #{id} is confirmed"),
    ORDER_PAYMENT_FAILED: ("payment_failed", "Payment for order #{id} was declined"),
    ORDER_EXPIRED: ("order_expired", "Order #{id} expired before payment completed"),
}


@registry.handles(ORDER_PAID, ORDER_PAYMENT_FAILED, ORDER_EXPIRED)
async def send_order_notification(event: EventEnvelope, session: AsyncSession) -> None:
    order_id = int(event.payload["order_id"])
    recipient = await session.scalar(select(Order.customer_email).where(Order.id == order_id))
    if recipient is None:
        return
    kind, template = SUBJECTS[event.event_type]
    subject = template.format(id=order_id)
    await session.execute(
        pg_insert(Notification)
        .values(order_id=order_id, kind=kind, recipient=recipient, subject=subject)
        .on_conflict_do_nothing(index_elements=[Notification.order_id, Notification.kind])
    )
    logger.info("notification sent", extra={"order_id": order_id, "kind": kind, "recipient": recipient})
