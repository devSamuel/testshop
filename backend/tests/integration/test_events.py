import asyncio
import random

import httpx
import pytest
from sqlalchemy import select

from app.bootstrap import Container, register_handlers
from app.events.dispatcher import DispatcherConfig, InProcessDispatcher
from app.events.envelope import EventEnvelope
from app.events.models import OutboxEvent
from app.events.outbox import envelope_from_row, record_event
from app.events.registry import HandlerRegistry, deliver
from app.inventory.handlers import desired_level, sync_stock_alert
from app.inventory.models import MovementReason
from app.inventory.service import set_stock
from tests.conftest import DECLINE, Factory, checkout_body


def registry_with_handlers() -> HandlerRegistry:
    return register_handlers()


async def test_event_is_written_in_the_same_transaction(container: Container, factory: Factory) -> None:
    product = await factory.product(stock=10)
    before = await factory.scalar("SELECT count(*) FROM outbox_events")

    async def failing_transaction() -> None:
        async with container.db.sessions() as session, session.begin():
            await set_stock(session, product, 3, reason=MovementReason.admin_adjustment)
            raise RuntimeError("boom")

    with pytest.raises(RuntimeError):
        await failing_transaction()
    assert await factory.scalar("SELECT count(*) FROM outbox_events") == before
    assert await factory.stock(product) == 10


async def test_dispatcher_delivers_alerts_and_notifications(
    client: httpx.AsyncClient, container: Container, factory: Factory
) -> None:
    product = await factory.product(stock=6)
    await client.post(
        "/api/orders", json=checkout_body([(product, 2)]), headers={"Idempotency-Key": "evt-0001"}
    )
    await client.post(
        "/api/orders",
        json=checkout_body([(product, 1)], card=DECLINE),
        headers={"Idempotency-Key": "evt-0002"},
    )
    delivered = await container.dispatcher.drain()
    assert delivered >= 5
    alerts = (await client.get("/api/admin/alerts")).json()
    assert [(a["level"], a["stock_at_alert"]) for a in alerts] == [("low", 4)]
    kinds = sorted(n["kind"] for n in (await client.get("/api/admin/notifications")).json())
    assert kinds == ["order_paid", "payment_failed"]
    stats = (await client.get("/api/admin/outbox")).json()
    assert (stats["pending"], stats["dead_lettered"]) == (0, 0)


async def test_alerts_converge_regardless_of_delivery_order(container: Container, factory: Factory) -> None:
    product = await factory.product(stock=10)
    async with container.db.sessions() as session, session.begin():
        await set_stock(session, product, 0, reason=MovementReason.admin_adjustment)
        await set_stock(session, product, 3, reason=MovementReason.admin_adjustment)
    async with container.db.sessions() as session:
        rows = (
            await session.scalars(
                select(OutboxEvent)
                .where(OutboxEvent.event_type == "inventory.StockChanged")
                .order_by(OutboxEvent.occurred_at.desc())
            )
        ).all()
    async with container.db.sessions() as session, session.begin():
        for row in rows:
            await sync_stock_alert(envelope_from_row(row), session)
    assert await factory.scalar("SELECT count(*) FROM stock_alerts WHERE resolved_at IS NULL") == 1
    assert await factory.scalar("SELECT level FROM stock_alerts WHERE resolved_at IS NULL") == "low"

    async with container.db.sessions() as session, session.begin():
        await set_stock(session, product, 20, reason=MovementReason.admin_adjustment)
    await container.dispatcher.drain()
    assert await factory.scalar("SELECT count(*) FROM stock_alerts WHERE resolved_at IS NULL") == 0


async def test_duplicate_delivery_runs_each_handler_once(container: Container, factory: Factory) -> None:
    calls: list[str] = []
    local = HandlerRegistry()

    @local.handles("test.Ping")
    async def count(event: EventEnvelope, session: object) -> None:
        calls.append(str(event.event_id))

    envelope = EventEnvelope("test.Ping", "test", "1", {})
    for _ in range(3):
        async with container.db.sessions() as session, session.begin():
            await deliver(session, envelope, local.handlers_for("test.Ping"))
    assert calls == [str(envelope.event_id)]


async def test_failing_handler_retries_then_dead_letters(container: Container) -> None:
    local = HandlerRegistry()

    @local.handles("test.Broken")
    async def broken(event: EventEnvelope, session: object) -> None:
        raise ValueError("downstream unavailable")

    async with container.db.sessions() as session, session.begin():
        record_event(session, "test.Broken", "test", "1", {})
    dispatcher = InProcessDispatcher(
        container.db.sessions, local, DispatcherConfig(max_attempts=3, backoff_base_seconds=0)
    )
    for _ in range(3):
        assert await dispatcher.dispatch_batch() == 1
    assert await dispatcher.dispatch_batch() == 0
    async with container.db.sessions() as session:
        row = await session.scalar(select(OutboxEvent))
    assert row is not None
    assert (row.attempts, row.published_at is None, row.failed_at is not None) == (3, True, True)
    assert "downstream unavailable" in (row.last_error or "")


async def test_one_bad_event_does_not_block_others(container: Container) -> None:
    seen: list[str] = []
    local = HandlerRegistry()

    @local.handles("test.Mixed")
    async def picky(event: EventEnvelope, session: object) -> None:
        if event.payload["bad"]:
            raise ValueError("poison")
        seen.append(event.aggregate_id)

    async with container.db.sessions() as session, session.begin():
        record_event(session, "test.Mixed", "t", "poison", {"bad": True})
        record_event(session, "test.Mixed", "t", "good", {"bad": False})
    dispatcher = InProcessDispatcher(container.db.sessions, local, DispatcherConfig(backoff_base_seconds=60))
    await dispatcher.drain()
    assert seen == ["good"]


async def test_failed_event_can_be_retried_from_admin(
    client: httpx.AsyncClient, container: Container
) -> None:
    async with container.db.sessions() as session, session.begin():
        envelope = record_event(session, "test.Unhandled", "t", "1", {})
    async with container.db.sessions() as session, session.begin():
        row = await session.get_one(OutboxEvent, envelope.event_id)
        row.failed_at = row.occurred_at
        row.attempts = 5
    assert (await client.post(f"/api/admin/outbox/{envelope.event_id}/retry")).status_code == 204
    assert await container.dispatcher.drain() == 1


async def test_parallel_dispatchers_converge_on_correct_alerts(
    container: Container, factory: Factory
) -> None:
    products = [await factory.product(stock=10) for _ in range(4)]
    rng = random.Random(11)
    for _ in range(60):
        async with container.db.sessions() as session, session.begin():
            await set_stock(
                session, rng.choice(products), rng.randint(0, 8), reason=MovementReason.admin_adjustment
            )
    workers = [
        InProcessDispatcher(container.db.sessions, registry_with_handlers(), DispatcherConfig(batch_size=7))
        for _ in range(4)
    ]
    await asyncio.gather(*(w.drain() for w in workers))
    assert await factory.scalar("SELECT count(*) FROM outbox_events WHERE published_at IS NULL") == 0
    for product in products:
        stock = await factory.stock(product)
        open_levels = await factory.scalar(
            "SELECT coalesce(string_agg(level, ','), '') FROM stock_alerts "
            "WHERE product_id = :id AND resolved_at IS NULL",
            id=product,
        )
        expected = desired_level(stock, threshold=5)
        assert open_levels == (expected.value if expected else ""), (product, stock, open_levels)
