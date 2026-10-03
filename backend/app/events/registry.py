from collections import defaultdict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.events.envelope import EventEnvelope
from app.events.models import ProcessedEvent

HandlerFn = Callable[[EventEnvelope, AsyncSession], Awaitable[None]]


@dataclass(frozen=True, slots=True)
class Handler:
    name: str
    fn: HandlerFn


class HandlerRegistry:
    def __init__(self) -> None:
        self._handlers: dict[str, list[Handler]] = defaultdict(list)

    def handles(self, *event_types: str) -> Callable[[HandlerFn], HandlerFn]:
        def decorator(fn: HandlerFn) -> HandlerFn:
            handler = Handler(name=f"{fn.__module__}.{fn.__qualname__}", fn=fn)
            for event_type in event_types:
                if handler not in self._handlers[event_type]:
                    self._handlers[event_type].append(handler)
            return fn

        return decorator

    def handlers_for(self, event_type: str) -> list[Handler]:
        return list(self._handlers.get(event_type, []))

    def event_types(self) -> list[str]:
        return sorted(self._handlers)


registry = HandlerRegistry()


async def claim_for_handler(session: AsyncSession, handler: Handler, envelope: EventEnvelope) -> bool:
    stmt = (
        pg_insert(ProcessedEvent)
        .values(handler=handler.name, event_id=envelope.event_id)
        .on_conflict_do_nothing()
        .returning(ProcessedEvent.event_id)
    )
    return (await session.execute(stmt)).first() is not None


async def deliver(session: AsyncSession, envelope: EventEnvelope, handlers: list[Handler]) -> int:
    executed = 0
    for handler in handlers:
        if await claim_for_handler(session, handler, envelope):
            await handler.fn(envelope, session)
            executed += 1
    return executed
