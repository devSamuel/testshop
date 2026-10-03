import asyncio
import hashlib
import json
import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.core.errors import IdempotencyKeyReusedError
from app.core.money import to_money
from app.events.outbox import record_event
from app.inventory import service as inventory
from app.inventory.service import ReservationLine
from app.orders.models import Order, OrderItem, OrderStatus, sources_for
from app.payments.provider import Card, ChargeResult, ChargeStatus, PaymentProvider, card_brand

logger = logging.getLogger("orders.checkout")

ORDER_PLACED = "orders.OrderPlaced"
ORDER_PAID = "orders.OrderPaid"
ORDER_PAYMENT_FAILED = "orders.OrderPaymentFailed"
ORDER_EXPIRED = "orders.OrderExpired"
REFUND_REQUIRED = "orders.RefundRequired"


class CheckoutResult(StrEnum):
    created = "created"
    replayed = "replayed"


@dataclass(frozen=True, slots=True)
class CheckoutCommand:
    idempotency_key: str
    email: str
    lines: list[ReservationLine]
    card: Card


@dataclass(frozen=True, slots=True)
class CheckoutOutcome:
    order: Order
    result: CheckoutResult


def payment_key(order_id: int) -> str:
    return f"order-{order_id}"


def fingerprint(command: CheckoutCommand) -> str:
    canonical = {
        "email": command.email.lower(),
        "lines": [[line.product_id, line.quantity] for line in inventory.merge_lines(command.lines)],
        "card": command.card.last4,
    }
    return hashlib.sha256(json.dumps(canonical, sort_keys=True).encode()).hexdigest()


async def transition(session: AsyncSession, order_id: int, target: OrderStatus, **values: object) -> bool:
    result = await session.execute(
        update(Order)
        .where(Order.id == order_id, Order.status.in_(sources_for(target)))
        .values(status=target, updated_at=datetime.now(UTC), **values)
        .returning(Order.id)
    )
    return result.first() is not None


async def load_order(session: AsyncSession, order_id: int) -> Order:
    order = await session.scalar(
        select(Order).where(Order.id == order_id).execution_options(populate_existing=True)
    )
    if order is None:
        raise LookupError(order_id)
    return order


class CheckoutService:
    def __init__(
        self, sessions: async_sessionmaker[AsyncSession], provider: PaymentProvider, settings: Settings
    ) -> None:
        self._sessions = sessions
        self._provider = provider
        self._settings = settings

    async def place_order(self, command: CheckoutCommand) -> CheckoutOutcome:
        request_print = fingerprint(command)
        replay = await self._find_replay(command.idempotency_key, request_print)
        if replay is not None:
            return replay
        try:
            order = await self.reserve(command, request_print)
        except IntegrityError as exc:
            if "uq_orders_idempotency_key" not in str(exc.orig):
                raise
            replay = await self._find_replay(command.idempotency_key, request_print)
            if replay is None:
                raise
            return replay

        try:
            charge = await asyncio.wait_for(
                self.charge(order, command.card), timeout=self._settings.payment_timeout_seconds
            )
        except TimeoutError:
            logger.warning("payment timed out; reconciler will settle", extra={"order_id": order.id})
            return CheckoutOutcome(order=order, result=CheckoutResult.created)
        except Exception:
            logger.exception("payment provider error; reconciler will settle", extra={"order_id": order.id})
            return CheckoutOutcome(order=order, result=CheckoutResult.created)

        settled = await self.settle(order.id, charge)
        return CheckoutOutcome(order=settled, result=CheckoutResult.created)

    async def _find_replay(self, key: str, request_print: str) -> CheckoutOutcome | None:
        async with self._sessions() as session:
            order = await session.scalar(select(Order).where(Order.idempotency_key == key))
        if order is None:
            return None
        if order.request_fingerprint != request_print:
            raise IdempotencyKeyReusedError(
                "This Idempotency-Key was used for a different order; generate a new key", order_id=order.id
            )
        return CheckoutOutcome(order=order, result=CheckoutResult.replayed)

    async def reserve(self, command: CheckoutCommand, request_print: str) -> Order:
        async with self._sessions() as session, session.begin():
            order = Order(
                idempotency_key=command.idempotency_key,
                request_fingerprint=request_print,
                status=OrderStatus.pending_payment,
                customer_email=command.email,
                currency=self._settings.currency,
                total=Decimal("0"),
                reservation_expires_at=datetime.now(UTC)
                + timedelta(seconds=self._settings.reservation_ttl_seconds),
                card_last4=command.card.last4,
                card_brand=card_brand(command.card.number),
            )
            session.add(order)
            await session.flush()
            reserved = await inventory.reserve(session, order.id, command.lines)
            total = Decimal("0")
            for line in reserved:
                line_total = to_money(line.unit_price * line.quantity)
                total += line_total
                session.add(
                    OrderItem(
                        order_id=order.id,
                        product_id=line.product_id,
                        sku=line.sku,
                        name=line.name,
                        unit_price=line.unit_price,
                        quantity=line.quantity,
                        line_total=line_total,
                    )
                )
            order.total = to_money(total)
            record_event(
                session,
                ORDER_PLACED,
                "order",
                order.id,
                {
                    "order_id": order.id,
                    "total": str(order.total),
                    "currency": order.currency,
                    "items": [
                        {"product_id": r.product_id, "sku": r.sku, "quantity": r.quantity} for r in reserved
                    ],
                },
            )
            await session.flush()
            return await load_order(session, order.id)

    async def charge(self, order: Order, card: Card) -> ChargeResult:
        return await self._provider.charge(
            idempotency_key=payment_key(order.id), amount=order.total, currency=order.currency, card=card
        )

    async def settle(self, order_id: int, charge: ChargeResult) -> Order:
        async with self._sessions() as session, session.begin():
            if charge.status is ChargeStatus.succeeded:
                await self._mark_paid(session, order_id, charge)
            elif charge.status is ChargeStatus.declined:
                await self._mark_failed(session, order_id, charge)
            return await load_order(session, order_id)

    async def expire(self, order_id: int) -> bool:
        async with self._sessions() as session, session.begin():
            if not await transition(session, order_id, OrderStatus.expired, closed_at=datetime.now(UTC)):
                return False
            released = await inventory.release_reservations(session, order_id)
            record_event(
                session,
                ORDER_EXPIRED,
                "order",
                order_id,
                {"order_id": order_id, "released": [[r.product_id, r.quantity] for r in released]},
            )
            return True

    async def _mark_paid(self, session: AsyncSession, order_id: int, charge: ChargeResult) -> None:
        now = datetime.now(UTC)
        if await transition(
            session, order_id, OrderStatus.paid, payment_ref=charge.reference, paid_at=now, closed_at=now
        ):
            await inventory.commit_reservations(session, order_id)
            order = await load_order(session, order_id)
            record_event(
                session,
                ORDER_PAID,
                "order",
                order_id,
                {"order_id": order_id, "total": str(order.total), "payment_ref": charge.reference},
            )
            return
        current = await load_order(session, order_id)
        if current.status != OrderStatus.paid:
            logger.error(
                "payment succeeded for a closed order; refund required",
                extra={"order_id": order_id, "status": current.status, "payment_ref": charge.reference},
            )
            record_event(
                session,
                REFUND_REQUIRED,
                "order",
                order_id,
                {"order_id": order_id, "payment_ref": charge.reference, "order_status": current.status},
            )

    async def _mark_failed(self, session: AsyncSession, order_id: int, charge: ChargeResult) -> None:
        if not await transition(
            session,
            order_id,
            OrderStatus.payment_failed,
            decline_reason=charge.decline_reason,
            closed_at=datetime.now(UTC),
        ):
            return
        released = await inventory.release_reservations(session, order_id)
        record_event(
            session,
            ORDER_PAYMENT_FAILED,
            "order",
            order_id,
            {
                "order_id": order_id,
                "reason": charge.decline_reason,
                "released": [[r.product_id, r.quantity] for r in released],
            },
        )
