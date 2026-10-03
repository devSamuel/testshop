from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.catalog.models import Product
from app.core.errors import InsufficientStockError, NotFoundError, StockChangedError
from app.events.outbox import new_envelope, record_event, record_events
from app.inventory.models import MovementReason, ReservationStatus, StockMovement, StockReservation

STOCK_CHANGED = "inventory.StockChanged"


@dataclass(frozen=True, slots=True)
class ReservationLine:
    product_id: int
    quantity: int


@dataclass(frozen=True, slots=True)
class ReservedLine:
    product_id: int
    sku: str
    name: str
    unit_price: Decimal
    quantity: int
    balance_after: int


def merge_lines(lines: Iterable[ReservationLine]) -> list[ReservationLine]:
    totals: dict[int, int] = defaultdict(int)
    for line in lines:
        totals[line.product_id] += line.quantity
    return [ReservationLine(product_id=pid, quantity=qty) for pid, qty in sorted(totals.items())]


@dataclass(frozen=True, slots=True)
class Movement:
    product_id: int
    sku: str
    delta: int
    balance_after: int
    reason: MovementReason
    reference_type: str | None
    reference_id: str | None

    def row(self) -> dict[str, object]:
        return {
            "product_id": self.product_id,
            "delta": self.delta,
            "balance_after": self.balance_after,
            "reason": self.reason.value,
            "reference_type": self.reference_type,
            "reference_id": self.reference_id,
        }

    def payload(self) -> dict[str, object]:
        return {"sku": self.sku, **self.row()}


def record_movement(
    session: AsyncSession,
    *,
    product_id: int,
    sku: str,
    delta: int,
    balance_after: int,
    reason: MovementReason,
    reference_type: str | None,
    reference_id: object | None,
) -> None:
    if delta == 0:
        return
    movement = Movement(product_id, sku, delta, balance_after, reason, reference_type, _ref(reference_id))
    session.add(StockMovement(**movement.row()))
    record_event(session, STOCK_CHANGED, "product", product_id, movement.payload())


async def record_movements(session: AsyncSession, movements: Sequence[Movement]) -> None:
    changed = [m for m in movements if m.delta != 0]
    if not changed:
        return
    await session.execute(insert(StockMovement), [m.row() for m in changed])
    await record_events(
        session, [new_envelope(STOCK_CHANGED, "product", m.product_id, m.payload()) for m in changed]
    )


def _ref(reference_id: object | None) -> str | None:
    return None if reference_id is None else str(reference_id)


async def reserve(
    session: AsyncSession, order_id: int, lines: Sequence[ReservationLine]
) -> list[ReservedLine]:
    reserved: list[ReservedLine] = []
    shortages: list[dict[str, int]] = []
    for line in merge_lines(lines):
        result = await session.execute(
            update(Product)
            .where(
                Product.id == line.product_id,
                Product.deleted_at.is_(None),
                Product.stock >= line.quantity,
            )
            .values(stock=Product.stock - line.quantity)
            .returning(Product.stock, Product.sku, Product.name, Product.price)
        )
        row = result.one_or_none()
        if row is None:
            shortages.append({"product_id": line.product_id, "requested": line.quantity})
            continue
        session.add(StockReservation(order_id=order_id, product_id=line.product_id, quantity=line.quantity))
        record_movement(
            session,
            product_id=line.product_id,
            sku=row.sku,
            delta=-line.quantity,
            balance_after=row.stock,
            reason=MovementReason.reservation,
            reference_type="order",
            reference_id=order_id,
        )
        reserved.append(
            ReservedLine(
                product_id=line.product_id,
                sku=row.sku,
                name=row.name,
                unit_price=row.price,
                quantity=line.quantity,
                balance_after=row.stock,
            )
        )
    if shortages:
        raise InsufficientStockError(
            "Some items do not have enough stock", items=await _describe_shortages(session, shortages)
        )
    return reserved


async def _describe_shortages(
    session: AsyncSession, shortages: list[dict[str, int]]
) -> list[dict[str, object]]:
    ids = [s["product_id"] for s in shortages]
    rows = await session.execute(
        select(Product.id, Product.sku, Product.stock, Product.deleted_at).where(Product.id.in_(ids))
    )
    found = {r.id: r for r in rows}
    described: list[dict[str, object]] = []
    for shortage in shortages:
        row = found.get(shortage["product_id"])
        described.append(
            {
                "product_id": shortage["product_id"],
                "sku": row.sku if row else None,
                "requested": shortage["requested"],
                "available": 0 if row is None or row.deleted_at is not None else row.stock,
            }
        )
    return described


async def commit_reservations(session: AsyncSession, order_id: int) -> int:
    result = await session.execute(
        update(StockReservation)
        .where(StockReservation.order_id == order_id, StockReservation.status == ReservationStatus.active)
        .values(status=ReservationStatus.committed, updated_at=func.now())
        .returning(StockReservation.id)
    )
    return len(result.all())


async def release_reservations(session: AsyncSession, order_id: int) -> list[ReservationLine]:
    active = (
        await session.scalars(
            select(StockReservation)
            .where(StockReservation.order_id == order_id, StockReservation.status == ReservationStatus.active)
            .order_by(StockReservation.product_id)
            .with_for_update()
        )
    ).all()
    released: list[ReservationLine] = []
    for reservation in active:
        row = (
            await session.execute(
                update(Product)
                .where(Product.id == reservation.product_id)
                .values(stock=Product.stock + reservation.quantity)
                .returning(Product.stock, Product.sku)
            )
        ).one()
        reservation.status = ReservationStatus.released
        record_movement(
            session,
            product_id=reservation.product_id,
            sku=row.sku,
            delta=reservation.quantity,
            balance_after=row.stock,
            reason=MovementReason.reservation_released,
            reference_type="order",
            reference_id=order_id,
        )
        released.append(ReservationLine(product_id=reservation.product_id, quantity=reservation.quantity))
    await session.flush()
    return released


async def active_reserved_quantities(session: AsyncSession, product_ids: Iterable[int]) -> dict[int, int]:
    ids = list(product_ids)
    if not ids:
        return {}
    rows = await session.execute(
        select(StockReservation.product_id, func.sum(StockReservation.quantity))
        .where(StockReservation.product_id.in_(ids), StockReservation.status == ReservationStatus.active)
        .group_by(StockReservation.product_id)
    )
    return {pid: int(qty) for pid, qty in rows.all()}


async def set_stock(
    session: AsyncSession,
    product_id: int,
    target: int,
    *,
    reason: MovementReason,
    reference_type: str | None = None,
    reference_id: object | None = None,
    expected_current: int | None = None,
) -> int:
    row = (
        await session.execute(
            select(Product.stock, Product.sku)
            .where(Product.id == product_id, Product.deleted_at.is_(None))
            .with_for_update()
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError(f"Product {product_id} does not exist", product_id=product_id)
    if expected_current is not None and row.stock != expected_current:
        raise StockChangedError(
            f"Stock changed from {expected_current} to {row.stock} since you loaded it "
            "(orders or imports happened); reload and re-enter the count",
            current_stock=row.stock,
            your_stock=expected_current,
        )
    delta = target - row.stock
    if delta == 0:
        return target
    await session.execute(update(Product).where(Product.id == product_id).values(stock=target))
    record_movement(
        session,
        product_id=product_id,
        sku=row.sku,
        delta=delta,
        balance_after=target,
        reason=reason,
        reference_type=reference_type,
        reference_id=reference_id,
    )
    return target


async def stock_history(
    session: AsyncSession, product_id: int, limit: int, before_id: int | None
) -> list[StockMovement]:
    stmt = select(StockMovement).where(StockMovement.product_id == product_id)
    if before_id is not None:
        stmt = stmt.where(StockMovement.id < before_id)
    return list((await session.scalars(stmt.order_by(StockMovement.id.desc()).limit(limit))).all())
