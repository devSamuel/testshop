import logging

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.catalog.models import Product
from app.core.config import get_settings
from app.events.envelope import EventEnvelope
from app.events.registry import registry
from app.inventory.models import AlertLevel, StockAlert
from app.inventory.service import STOCK_CHANGED

logger = logging.getLogger("inventory.alerts")

ALERT_LOCK_NAMESPACE = 41_001


def desired_level(stock: int | None, threshold: int) -> AlertLevel | None:
    if stock is None or stock >= threshold:
        return None
    return AlertLevel.out_of_stock if stock == 0 else AlertLevel.low


@registry.handles(STOCK_CHANGED)
async def sync_stock_alert(event: EventEnvelope, session: AsyncSession) -> None:
    threshold = get_settings().low_stock_threshold
    product_id = int(event.payload["product_id"])
    await session.execute(select(func.pg_advisory_xact_lock(ALERT_LOCK_NAMESPACE, product_id)))
    current = (
        await session.execute(
            select(Product.stock, Product.sku).where(Product.id == product_id, Product.deleted_at.is_(None))
        )
    ).one_or_none()
    level = desired_level(current.stock if current else None, threshold)

    await session.execute(
        update(StockAlert)
        .where(
            StockAlert.product_id == product_id,
            StockAlert.resolved_at.is_(None),
            StockAlert.level != (level.value if level else ""),
        )
        .values(resolved_at=func.now())
    )
    if level is None or current is None:
        return
    inserted = await session.execute(
        pg_insert(StockAlert)
        .values(
            product_id=product_id,
            sku=current.sku,
            level=level.value,
            stock_at_alert=current.stock,
            threshold=threshold,
            source_event_id=event.event_id,
        )
        .on_conflict_do_nothing(
            index_elements=[StockAlert.product_id], index_where=StockAlert.resolved_at.is_(None)
        )
        .returning(StockAlert.id)
    )
    if inserted.first() is not None:
        logger.info(
            "stock alert raised",
            extra={"product_id": product_id, "alert_level": level.value, "stock": current.stock},
        )
