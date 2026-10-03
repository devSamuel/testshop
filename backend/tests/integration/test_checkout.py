from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import func, select, update

from app.bootstrap import Container
from app.inventory.service import ReservationLine
from app.orders.checkout import CheckoutCommand, fingerprint, payment_key
from app.orders.models import Order
from app.orders.reconciler import RECONCILER_LOCK_NAMESPACE
from app.payments.provider import Card
from tests.conftest import APPROVE, DECLINE, SLOW, Factory, checkout_body


async def post_order(client: httpx.AsyncClient, key: str, body: dict[str, object]) -> httpx.Response:
    return await client.post("/api/orders", json=body, headers={"Idempotency-Key": key})


async def test_successful_checkout_snapshots_prices(client: httpx.AsyncClient, factory: Factory) -> None:
    a = await factory.product(price="19.99", stock=5)
    b = await factory.product(price="0.10", stock=50)
    response = await post_order(client, "order-key-0001", checkout_body([(a, 2), (b, 3)]))
    assert response.status_code == 201
    order = response.json()
    assert order["status"] == "paid"
    assert order["total"] == "40.28"
    assert order["card_last4"] == "4242"
    assert order["payment_ref"].startswith("ch_")
    assert (await factory.stock(a), await factory.stock(b)) == (3, 47)

    await client.patch(f"/api/products/{a}", json={"version": 1, "price": "99.00"})
    again = (await client.get(f"/api/orders/{order['id']}")).json()
    assert again["items"][0]["unit_price"] == "19.99"


async def test_declined_card_compensates_stock(client: httpx.AsyncClient, factory: Factory) -> None:
    product = await factory.product(stock=3)
    response = await post_order(client, "order-key-0002", checkout_body([(product, 2)], card=DECLINE))
    assert response.status_code == 402
    problem = response.json()
    assert problem["order"]["status"] == "payment_failed"
    assert problem["order"]["decline_reason"] == "card_declined"
    assert await factory.stock(product) == 3
    reasons = await factory.scalar(
        "SELECT string_agg(reason, ',' ORDER BY id) FROM stock_movements WHERE reference_type = 'order'"
    )
    assert reasons == "reservation,reservation_released"


async def test_idempotent_replay_returns_same_order(client: httpx.AsyncClient, factory: Factory) -> None:
    product = await factory.product(stock=5)
    body = checkout_body([(product, 1)])
    first = await post_order(client, "order-key-0003", body)
    second = await post_order(client, "order-key-0003", body)
    assert (first.status_code, second.status_code) == (201, 200)
    assert second.headers["Idempotent-Replayed"] == "true"
    assert first.json()["id"] == second.json()["id"]
    assert await factory.stock(product) == 4
    assert await factory.scalar("SELECT count(*) FROM payment_sim_charges") == 1


async def test_reusing_a_key_for_a_different_cart_is_rejected(
    client: httpx.AsyncClient, factory: Factory
) -> None:
    product = await factory.product(stock=5)
    await post_order(client, "order-key-0004", checkout_body([(product, 1)]))
    response = await post_order(client, "order-key-0004", checkout_body([(product, 2)]))
    assert response.status_code == 422
    assert response.json()["type"].endswith("/idempotency-key-reused")


async def test_insufficient_stock_rolls_back_every_line(client: httpx.AsyncClient, factory: Factory) -> None:
    plenty = await factory.product(stock=10)
    scarce = await factory.product(stock=1)
    response = await post_order(client, "order-key-0005", checkout_body([(plenty, 2), (scarce, 2)]))
    assert response.status_code == 409
    assert response.json()["items"] == [
        {"product_id": scarce, "sku": "SKU-00002", "requested": 2, "available": 1}
    ]
    assert (await factory.stock(plenty), await factory.stock(scarce)) == (10, 1)
    assert await factory.scalar("SELECT count(*) FROM orders") == 0


async def test_deleted_product_cannot_be_bought(client: httpx.AsyncClient, factory: Factory) -> None:
    product = await factory.product(stock=5)
    await client.delete(f"/api/products/{product}?version=1")
    assert (await post_order(client, "order-key-0006", checkout_body([(product, 1)]))).status_code == 409


async def test_duplicate_lines_are_merged(client: httpx.AsyncClient, factory: Factory) -> None:
    product = await factory.product(stock=5)
    order = (await post_order(client, "order-key-0007", checkout_body([(product, 1), (product, 2)]))).json()
    assert [(i["product_id"], i["quantity"]) for i in order["items"]] == [(product, 3)]


async def test_card_validation(client: httpx.AsyncClient, factory: Factory) -> None:
    product = await factory.product()
    bad_luhn = checkout_body([(product, 1)], card="4242424242424241")
    assert (await post_order(client, "order-key-0008", bad_luhn)).status_code == 422
    expired = checkout_body([(product, 1)])
    expired["card"]["exp_year"] = 2020
    assert (await post_order(client, "order-key-0009", expired)).status_code == 422
    missing_key = await client.post("/api/orders", json=checkout_body([(product, 1)]))
    assert missing_key.status_code == 422


async def test_slow_provider_returns_202_and_reconciler_settles(
    client: httpx.AsyncClient, factory: Factory, container: Container
) -> None:
    product = await factory.product(stock=5)
    response = await post_order(client, "order-key-0010", checkout_body([(product, 1)], card=SLOW))
    assert response.status_code == 202
    assert response.json()["status"] == "pending_payment"
    stats = await container.reconciler.run_once()
    assert stats.paid == 1
    order = (await client.get(response.headers["location"])).json()
    assert order["status"] == "paid"
    assert await factory.stock(product) == 4


def command(key: str, product_id: int, quantity: int = 1, card: str = APPROVE) -> CheckoutCommand:
    return CheckoutCommand(
        key, "crash@example.com", [ReservationLine(product_id, quantity)], Card(card, 12, 2035, "123")
    )


async def expire_now(container: Container, order_id: int) -> None:
    async with container.db.sessions() as session, session.begin():
        await session.execute(
            update(Order)
            .where(Order.id == order_id)
            .values(reservation_expires_at=datetime.now(UTC) - timedelta(seconds=1))
        )


async def test_crash_after_reserve_is_expired_and_stock_released(
    container: Container, factory: Factory
) -> None:
    product = await factory.product(stock=5)
    cmd = command("crash-key-0001", product, 2)
    order = await container.checkout.reserve(cmd, fingerprint(cmd))
    assert await factory.stock(product) == 3

    assert (await container.reconciler.run_once()).waiting == 1
    await expire_now(container, order.id)
    stats = await container.reconciler.run_once()
    assert stats.expired == 1
    assert await factory.stock(product) == 5
    assert await factory.scalar("SELECT status FROM orders WHERE id = :id", id=order.id) == "expired"


async def test_crash_after_charge_is_reconciled_to_paid(container: Container, factory: Factory) -> None:
    product = await factory.product(stock=5)
    cmd = command("crash-key-0002", product)
    order = await container.checkout.reserve(cmd, fingerprint(cmd))
    await container.checkout.charge(order, cmd.card)
    await expire_now(container, order.id)
    stats = await container.reconciler.run_once()
    assert stats.paid == 1
    assert await factory.stock(product) == 4


async def test_only_one_reconciler_is_active_at_a_time(container: Container, factory: Factory) -> None:
    product = await factory.product(stock=5)
    cmd = command("crash-key-0009", product)
    order = await container.checkout.reserve(cmd, fingerprint(cmd))
    await container.checkout.charge(order, cmd.card)

    async with container.db.engine.connect() as connection:
        other_replica = await connection.execution_options(isolation_level="AUTOCOMMIT")
        await other_replica.execute(select(func.pg_advisory_lock(RECONCILER_LOCK_NAMESPACE, 0)))
        stats = await container.reconciler.run_once()
        assert (stats.skipped, stats.examined) == (True, 0)
        status = await factory.scalar("SELECT status FROM orders WHERE id = :id", id=order.id)
        assert status == "pending_payment"
        await other_replica.execute(select(func.pg_advisory_unlock(RECONCILER_LOCK_NAMESPACE, 0)))

    stats = await container.reconciler.run_once()
    assert (stats.skipped, stats.paid) == (False, 1)


async def test_late_payment_after_expiry_flags_refund(container: Container, factory: Factory) -> None:
    product = await factory.product(stock=5)
    cmd = command("crash-key-0003", product)
    order = await container.checkout.reserve(cmd, fingerprint(cmd))
    await container.checkout.expire(order.id)
    charge = await container.checkout.charge(order, cmd.card)
    settled = await container.checkout.settle(order.id, charge)
    assert settled.status == "expired"
    assert await factory.stock(product) == 5
    assert (
        await factory.scalar("SELECT count(*) FROM outbox_events WHERE event_type = 'orders.RefundRequired'")
        == 1
    )
    report = await _invariants(container)
    assert report["no_charge_without_paid_order"]


async def test_settling_twice_is_harmless(container: Container, factory: Factory) -> None:
    product = await factory.product(stock=5)
    cmd = command("crash-key-0004", product, card=DECLINE)
    order = await container.checkout.reserve(cmd, fingerprint(cmd))
    charge = await container.checkout.charge(order, cmd.card)
    await container.checkout.settle(order.id, charge)
    await container.checkout.settle(order.id, charge)
    assert await factory.stock(product) == 5
    assert await container.payments.get_status(payment_key(order.id)) == charge


async def _invariants(container: Container) -> dict[str, bool]:
    from app.inventory.invariants import check_inventory
    from app.orders.invariants import check_orders, check_payments

    async with container.db.sessions() as session:
        results = [
            *await check_inventory(session),
            *await check_orders(session),
            *await check_payments(session, container.payments),
        ]
    return {r.name: r.passed for r in results}


async def test_orders_listing(client: httpx.AsyncClient, factory: Factory) -> None:
    product = await factory.product(stock=5)
    await post_order(client, "list-key-0001", checkout_body([(product, 1)]))
    await post_order(client, "list-key-0002", checkout_body([(product, 1)], card=DECLINE))
    page = (await client.get("/api/orders")).json()
    assert page["total"] == 2
    assert [o["status"] for o in page["items"]] == ["payment_failed", "paid"]
    assert (await client.get("/api/orders?status=paid")).json()["total"] == 1
    assert (await client.get("/api/orders/999")).status_code == 404
