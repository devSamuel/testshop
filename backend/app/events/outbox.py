from collections.abc import Sequence
from typing import Any

from sqlalchemy import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import current_request_id
from app.events.envelope import EventEnvelope
from app.events.models import OutboxEvent


def new_envelope(
    event_type: str,
    aggregate_type: str,
    aggregate_id: object,
    payload: dict[str, Any],
    event_version: int = 1,
) -> EventEnvelope:
    return EventEnvelope(
        event_type=event_type,
        aggregate_type=aggregate_type,
        aggregate_id=str(aggregate_id),
        payload=payload,
        event_version=event_version,
        correlation_id=current_request_id(),
    )


def _row_values(envelope: EventEnvelope) -> dict[str, Any]:
    return {
        "id": envelope.event_id,
        "aggregate_type": envelope.aggregate_type,
        "aggregate_id": envelope.aggregate_id,
        "event_type": envelope.event_type,
        "event_version": envelope.event_version,
        "payload": envelope.payload,
        "correlation_id": envelope.correlation_id,
        "occurred_at": envelope.occurred_at,
        "next_attempt_at": envelope.occurred_at,
        "attempts": 0,
    }


def record_event(
    session: AsyncSession,
    event_type: str,
    aggregate_type: str,
    aggregate_id: object,
    payload: dict[str, Any],
    event_version: int = 1,
) -> EventEnvelope:
    envelope = new_envelope(event_type, aggregate_type, aggregate_id, payload, event_version)
    session.add(OutboxEvent(**_row_values(envelope)))
    return envelope


async def record_events(session: AsyncSession, envelopes: Sequence[EventEnvelope]) -> None:
    if envelopes:
        await session.execute(insert(OutboxEvent), [_row_values(e) for e in envelopes])


def envelope_from_row(row: OutboxEvent) -> EventEnvelope:
    return EventEnvelope(
        event_id=row.id,
        event_type=row.event_type,
        event_version=row.event_version,
        aggregate_type=row.aggregate_type,
        aggregate_id=row.aggregate_id,
        payload=row.payload,
        correlation_id=row.correlation_id,
        occurred_at=row.occurred_at,
    )
