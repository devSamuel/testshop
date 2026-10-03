import asyncio
import contextlib
import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.events.models import OutboxEvent
from app.events.outbox import envelope_from_row
from app.events.registry import HandlerRegistry, deliver

logger = logging.getLogger("events.dispatcher")


@dataclass(frozen=True, slots=True)
class DispatcherConfig:
    batch_size: int = 50
    max_attempts: int = 5
    backoff_base_seconds: float = 2.0
    poll_interval_seconds: float = 1.0


class InProcessDispatcher:
    def __init__(
        self,
        sessions: async_sessionmaker[AsyncSession],
        registry: HandlerRegistry,
        config: DispatcherConfig,
    ) -> None:
        self._sessions = sessions
        self._registry = registry
        self._config = config

    async def dispatch_batch(self) -> int:
        async with self._sessions() as session, session.begin():
            rows = (
                await session.scalars(
                    select(OutboxEvent)
                    .where(
                        OutboxEvent.published_at.is_(None),
                        OutboxEvent.failed_at.is_(None),
                        OutboxEvent.next_attempt_at <= func.now(),
                    )
                    .order_by(OutboxEvent.next_attempt_at, OutboxEvent.occurred_at)
                    .limit(self._config.batch_size)
                    .with_for_update(skip_locked=True)
                )
            ).all()
            now = datetime.now(UTC)
            for row in sorted(rows, key=lambda r: (r.aggregate_type, r.aggregate_id, r.occurred_at)):
                try:
                    async with session.begin_nested():
                        await deliver(
                            session, envelope_from_row(row), self._registry.handlers_for(row.event_type)
                        )
                except Exception as exc:
                    self._record_failure(row, exc, now)
                else:
                    row.published_at = now
            return len(rows)

    def _record_failure(self, row: OutboxEvent, exc: Exception, now: datetime) -> None:
        row.attempts += 1
        row.last_error = f"{type(exc).__name__}: {exc}"[:2000]
        if row.attempts >= self._config.max_attempts:
            row.failed_at = now
            logger.error("event dead-lettered", extra={"event_id": str(row.id), "event_type": row.event_type})
            return
        delay = self._config.backoff_base_seconds * (2 ** (row.attempts - 1))
        row.next_attempt_at = now + timedelta(seconds=delay)
        logger.warning(
            "event handler failed, will retry",
            extra={"event_id": str(row.id), "attempt": row.attempts, "error": row.last_error},
        )

    async def drain(self, max_batches: int | None = None) -> int:
        processed = 0
        batches = 0
        while max_batches is None or batches < max_batches:
            handled = await self.dispatch_batch()
            if handled == 0:
                break
            processed += handled
            batches += 1
        return processed

    async def run_forever(self, stop: asyncio.Event) -> None:
        logger.info("dispatcher started")
        while not stop.is_set():
            try:
                processed = await self.drain(max_batches=20)
            except Exception:
                logger.exception("dispatcher iteration failed")
                processed = 0
            if processed == 0:
                with contextlib.suppress(TimeoutError):
                    await asyncio.wait_for(stop.wait(), timeout=self._config.poll_interval_seconds)
        logger.info("dispatcher stopped")
