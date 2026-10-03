import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any


@dataclass(frozen=True, slots=True)
class EventEnvelope:
    event_type: str
    aggregate_type: str
    aggregate_id: str
    payload: dict[str, Any]
    event_version: int = 1
    correlation_id: str | None = None
    event_id: uuid.UUID = field(default_factory=uuid.uuid4)
    occurred_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    def to_dict(self) -> dict[str, Any]:
        return {
            "event_id": str(self.event_id),
            "event_type": self.event_type,
            "event_version": self.event_version,
            "aggregate_type": self.aggregate_type,
            "aggregate_id": self.aggregate_id,
            "correlation_id": self.correlation_id,
            "occurred_at": self.occurred_at.isoformat(),
            "payload": self.payload,
        }
