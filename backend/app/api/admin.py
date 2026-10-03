import uuid
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Query, Response, status
from pydantic import BaseModel
from sqlalchemy import func, select, update

from app.api.deps import ContainerDep, SessionDep
from app.core.errors import NotFoundError
from app.events.models import OutboxEvent
from app.inventory.invariants import InvariantResult, check_inventory
from app.inventory.models import StockAlert
from app.orders.invariants import check_orders, check_payments
from app.orders.models import Notification

router = APIRouter(prefix="/api/admin", tags=["admin"])


class AlertOut(BaseModel):
    id: int
    product_id: int
    sku: str
    level: str
    stock_at_alert: int
    threshold: int
    created_at: datetime
    resolved_at: datetime | None


class InvariantOut(BaseModel):
    name: str
    description: str
    passed: bool
    violations: list[dict[str, Any]]


class InvariantReport(BaseModel):
    passed: bool
    checked_at: datetime
    checks: list[InvariantOut]


class OutboxEventOut(BaseModel):
    id: uuid.UUID
    event_type: str
    aggregate_type: str
    aggregate_id: str
    attempts: int
    last_error: str | None
    occurred_at: datetime
    failed_at: datetime | None


class OutboxStats(BaseModel):
    pending: int
    published: int
    dead_lettered: int
    oldest_pending_seconds: float | None
    recent_failures: list[OutboxEventOut]


class NotificationOut(BaseModel):
    id: int
    order_id: int
    kind: str
    recipient: str
    subject: str
    created_at: datetime


class ReconcileOut(BaseModel):
    examined: int
    paid: int
    failed: int
    expired: int
    waiting: int
    skipped: bool


@router.get("/alerts", response_model=list[AlertOut])
async def list_alerts(
    session: SessionDep, include_resolved: Annotated[bool, Query()] = False
) -> list[AlertOut]:
    stmt = select(StockAlert).order_by(StockAlert.id.desc()).limit(200)
    if not include_resolved:
        stmt = stmt.where(StockAlert.resolved_at.is_(None))
    return [
        AlertOut(
            id=a.id,
            product_id=a.product_id,
            sku=a.sku,
            level=a.level,
            stock_at_alert=a.stock_at_alert,
            threshold=a.threshold,
            created_at=a.created_at,
            resolved_at=a.resolved_at,
        )
        for a in (await session.scalars(stmt)).all()
    ]


@router.post("/alerts/{alert_id}/resolve", status_code=status.HTTP_204_NO_CONTENT)
async def resolve_alert(alert_id: int, session: SessionDep) -> Response:
    async with session.begin():
        result = await session.execute(
            update(StockAlert)
            .where(StockAlert.id == alert_id)
            .values(resolved_at=func.coalesce(StockAlert.resolved_at, func.now()))
            .returning(StockAlert.id)
        )
        if result.first() is None:
            raise NotFoundError(f"Alert {alert_id} does not exist")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _invariant_out(result: InvariantResult) -> InvariantOut:
    return InvariantOut(
        name=result.name,
        description=result.description,
        passed=result.passed,
        violations=[{k: str(v) for k, v in row.items()} for row in result.violations],
    )


@router.get("/invariants", response_model=InvariantReport)
async def invariants(session: SessionDep, container: ContainerDep) -> InvariantReport:
    results = [
        *await check_inventory(session),
        *await check_orders(session),
        *await check_payments(session, container.payments),
    ]
    checks = [_invariant_out(r) for r in results]
    return InvariantReport(passed=all(c.passed for c in checks), checked_at=datetime.now(UTC), checks=checks)


@router.get("/outbox", response_model=OutboxStats)
async def outbox_stats(session: SessionDep) -> OutboxStats:
    pending_filter = (OutboxEvent.published_at.is_(None), OutboxEvent.failed_at.is_(None))
    pending = await session.scalar(select(func.count()).where(*pending_filter)) or 0
    published = await session.scalar(select(func.count()).where(OutboxEvent.published_at.is_not(None))) or 0
    dead = await session.scalar(select(func.count()).where(OutboxEvent.failed_at.is_not(None))) or 0
    oldest = await session.scalar(select(func.min(OutboxEvent.occurred_at)).where(*pending_filter))
    failures = (
        await session.scalars(
            select(OutboxEvent)
            .where(OutboxEvent.last_error.is_not(None), OutboxEvent.published_at.is_(None))
            .order_by(OutboxEvent.occurred_at.desc())
            .limit(20)
        )
    ).all()
    return OutboxStats(
        pending=pending,
        published=published,
        dead_lettered=dead,
        oldest_pending_seconds=(datetime.now(UTC) - oldest).total_seconds() if oldest else None,
        recent_failures=[
            OutboxEventOut(
                id=e.id,
                event_type=e.event_type,
                aggregate_type=e.aggregate_type,
                aggregate_id=e.aggregate_id,
                attempts=e.attempts,
                last_error=e.last_error,
                occurred_at=e.occurred_at,
                failed_at=e.failed_at,
            )
            for e in failures
        ],
    )


@router.post("/outbox/{event_id}/retry", status_code=status.HTTP_204_NO_CONTENT)
async def retry_event(event_id: uuid.UUID, session: SessionDep) -> Response:
    async with session.begin():
        result = await session.execute(
            update(OutboxEvent)
            .where(OutboxEvent.id == event_id, OutboxEvent.published_at.is_(None))
            .values(failed_at=None, attempts=0, next_attempt_at=func.now())
            .returning(OutboxEvent.id)
        )
        if result.first() is None:
            raise NotFoundError(f"Unpublished event {event_id} does not exist")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/notifications", response_model=list[NotificationOut])
async def list_notifications(
    session: SessionDep, limit: Annotated[int, Query(ge=1, le=200)] = 50
) -> list[NotificationOut]:
    rows = (await session.scalars(select(Notification).order_by(Notification.id.desc()).limit(limit))).all()
    return [
        NotificationOut(
            id=n.id,
            order_id=n.order_id,
            kind=n.kind,
            recipient=n.recipient,
            subject=n.subject,
            created_at=n.created_at,
        )
        for n in rows
    ]


@router.post("/reconcile", response_model=ReconcileOut)
async def reconcile_now(container: ContainerDep) -> ReconcileOut:
    stats = await container.reconciler.run_once()
    return ReconcileOut(
        examined=stats.examined,
        paid=stats.paid,
        failed=stats.failed,
        expired=stats.expired,
        waiting=stats.waiting,
        skipped=stats.skipped,
    )
