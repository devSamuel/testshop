import asyncio
import contextlib
import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.orders.checkout import CheckoutService, payment_key
from app.orders.models import Order, OrderStatus
from app.payments.provider import ChargeStatus, PaymentProvider

logger = logging.getLogger("orders.reconciler")

RECONCILER_LOCK_NAMESPACE = 41_002


@dataclass(slots=True)
class ReconcileStats:
    examined: int = 0
    paid: int = 0
    failed: int = 0
    expired: int = 0
    waiting: int = 0
    skipped: bool = False
    order_ids: list[int] = field(default_factory=list)


class OrderReconciler:
    def __init__(
        self,
        engine: AsyncEngine,
        sessions: async_sessionmaker[AsyncSession],
        provider: PaymentProvider,
        checkout: CheckoutService,
        reconcile_after: timedelta,
        interval_seconds: float,
    ) -> None:
        self._engine = engine
        self._sessions = sessions
        self._provider = provider
        self._checkout = checkout
        self._reconcile_after = reconcile_after
        self._interval = interval_seconds

    async def run_once(self, batch_size: int = 100) -> ReconcileStats:
        async with self._engine.connect() as connection:
            lock = await connection.execution_options(isolation_level="AUTOCOMMIT")
            if not await lock.scalar(select(func.pg_try_advisory_lock(RECONCILER_LOCK_NAMESPACE, 0))):
                return ReconcileStats(skipped=True)
            try:
                return await self._reconcile(batch_size)
            finally:
                await lock.execute(select(func.pg_advisory_unlock(RECONCILER_LOCK_NAMESPACE, 0)))

    async def _reconcile(self, batch_size: int) -> ReconcileStats:
        stats = ReconcileStats()
        now = datetime.now(UTC)
        async with self._sessions() as session:
            candidates = (
                await session.execute(
                    select(Order.id, Order.reservation_expires_at)
                    .where(
                        Order.status == OrderStatus.pending_payment,
                        Order.created_at <= now - self._reconcile_after,
                    )
                    .order_by(Order.created_at)
                    .limit(batch_size)
                )
            ).all()
        for order_id, expires_at in candidates:
            stats.examined += 1
            stats.order_ids.append(order_id)
            charge = await self._provider.get_status(payment_key(order_id))
            if charge.status is ChargeStatus.succeeded:
                order = await self._checkout.settle(order_id, charge)
                stats.paid += order.status == OrderStatus.paid
            elif charge.status is ChargeStatus.declined:
                order = await self._checkout.settle(order_id, charge)
                stats.failed += order.status == OrderStatus.payment_failed
            elif expires_at <= now:
                stats.expired += await self._checkout.expire(order_id)
            else:
                stats.waiting += 1
        if stats.examined:
            logger.info(
                "reconciled pending orders",
                extra={
                    "examined": stats.examined,
                    "paid": stats.paid,
                    "failed": stats.failed,
                    "expired": stats.expired,
                    "waiting": stats.waiting,
                },
            )
        return stats

    async def run_forever(self, stop: asyncio.Event) -> None:
        logger.info("reconciler started")
        while not stop.is_set():
            try:
                await self.run_once()
            except Exception:
                logger.exception("reconciler iteration failed")
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(stop.wait(), timeout=self._interval)
        logger.info("reconciler stopped")
