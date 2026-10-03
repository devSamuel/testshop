import asyncio

from app.bootstrap import Container
from app.inventory.models import MovementReason
from app.inventory.service import ReservationLine, set_stock
from app.orders.checkout import CheckoutCommand, fingerprint
from app.payments.provider import Card
from app.worker import serve
from tests.conftest import APPROVE, Factory


async def test_worker_process_drains_the_outbox_on_its_own(container: Container, factory: Factory) -> None:
    product = await factory.product(stock=10)
    async with container.db.sessions() as session, session.begin():
        await set_stock(session, product, 2, reason=MovementReason.admin_adjustment)
    assert await factory.scalar("SELECT count(*) FROM outbox_events WHERE published_at IS NULL") > 0

    stop = asyncio.Event()
    worker = asyncio.create_task(serve(container, stop))
    for _ in range(100):
        pending = await factory.scalar("SELECT count(*) FROM outbox_events WHERE published_at IS NULL")
        if pending == 0:
            break
        await asyncio.sleep(0.05)
    stop.set()
    await asyncio.wait_for(worker, timeout=10)

    assert pending == 0
    assert await factory.scalar("SELECT level FROM stock_alerts WHERE resolved_at IS NULL") == "low"


async def test_worker_process_reconciles_notifies_and_alerts(container: Container, factory: Factory) -> None:
    product = await factory.product(stock=5)
    cmd = CheckoutCommand(
        "worker-crash-0001",
        "buyer@example.com",
        [ReservationLine(product, 1)],
        Card(APPROVE, 12, 2035, "123"),
    )
    order = await container.checkout.reserve(cmd, fingerprint(cmd))
    await container.checkout.charge(order, cmd.card)

    stop = asyncio.Event()
    worker = asyncio.create_task(serve(container, stop))
    for _ in range(200):
        status = await factory.scalar("SELECT status FROM orders WHERE id = :id", id=order.id)
        pending = await factory.scalar("SELECT count(*) FROM outbox_events WHERE published_at IS NULL")
        if status == "paid" and pending == 0:
            break
        await asyncio.sleep(0.05)
    stop.set()
    await asyncio.wait_for(worker, timeout=10)

    assert (status, pending) == ("paid", 0)
    notification = await factory.scalar("SELECT kind FROM notifications WHERE order_id = :id", id=order.id)
    assert notification == "order_paid"
    alert = await factory.scalar(
        "SELECT level FROM stock_alerts WHERE product_id = :id AND resolved_at IS NULL", id=product
    )
    assert alert == "low"
