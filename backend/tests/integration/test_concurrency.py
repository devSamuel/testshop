import asyncio
import random

import httpx

from tests.conftest import APPROVE, DECLINE, Factory, checkout_body


async def test_last_unit_is_sold_exactly_once(client: httpx.AsyncClient, factory: Factory) -> None:
    product = await factory.product(stock=1)
    responses = await asyncio.gather(
        *[
            client.post(
                "/api/orders",
                json=checkout_body([(product, 1)], email=f"buyer{i}@example.com"),
                headers={"Idempotency-Key": f"race-last-unit-{i:03d}"},
            )
            for i in range(10)
        ]
    )
    codes = sorted(r.status_code for r in responses)
    assert codes == [201] + [409] * 9
    assert await factory.stock(product) == 0
    assert await factory.scalar("SELECT count(*) FROM orders WHERE status = 'paid'") == 1


async def test_many_buyers_never_oversell(client: httpx.AsyncClient, factory: Factory) -> None:
    product = await factory.product(stock=5)
    rng = random.Random(7)
    responses = await asyncio.gather(
        *[
            client.post(
                "/api/orders",
                json=checkout_body(
                    [(product, rng.randint(1, 2))], card=rng.choice([APPROVE, APPROVE, DECLINE])
                ),
                headers={"Idempotency-Key": f"race-many-{i:03d}"},
            )
            for i in range(30)
        ]
    )
    assert {r.status_code for r in responses} <= {201, 402, 409}
    sold = await factory.scalar(
        "SELECT COALESCE(SUM(i.quantity), 0) FROM order_items i JOIN orders o ON o.id = i.order_id "
        "WHERE o.status = 'paid'"
    )
    assert sold + await factory.stock(product) == 5
    assert (await client.get("/api/admin/invariants")).json()["passed"]


async def test_concurrent_double_submit_creates_one_order(
    client: httpx.AsyncClient, factory: Factory
) -> None:
    product = await factory.product(stock=10)
    body = checkout_body([(product, 2)])
    responses = await asyncio.gather(
        *[
            client.post("/api/orders", json=body, headers={"Idempotency-Key": "double-click-0001"})
            for _ in range(8)
        ]
    )
    assert sorted(r.status_code for r in responses).count(201) == 1
    assert await factory.stock(product) == 8
    assert await factory.scalar("SELECT count(*) FROM orders") == 1
    assert {r.json()["id"] for r in responses} == {await factory.scalar("SELECT id FROM orders")}


async def test_opposite_cart_order_does_not_deadlock(client: httpx.AsyncClient, factory: Factory) -> None:
    a = await factory.product(stock=100)
    b = await factory.product(stock=100)
    responses = await asyncio.wait_for(
        asyncio.gather(
            *[
                client.post(
                    "/api/orders",
                    json=checkout_body([(a, 1), (b, 1)] if i % 2 else [(b, 1), (a, 1)]),
                    headers={"Idempotency-Key": f"deadlock-{i:03d}"},
                )
                for i in range(20)
            ]
        ),
        timeout=30,
    )
    assert all(r.status_code == 201 for r in responses)
    assert (await factory.stock(a), await factory.stock(b)) == (80, 80)


async def test_import_racing_checkouts_keeps_ledger_consistent(
    client: httpx.AsyncClient, factory: Factory
) -> None:
    header = "name,sku,description,category,price,stock,weight_kg\n"
    await client.post(
        "/api/imports?dry_run=false",
        files={"file": ("p.csv", (header + "Hot Item,HOT-1,,Deals,5,50,1\n").encode(), "text/csv")},
    )
    product = await factory.scalar("SELECT id FROM products WHERE sku = 'HOT-1'")
    buyers = [
        client.post(
            "/api/orders",
            json=checkout_body([(product, 1)]),
            headers={"Idempotency-Key": f"import-race-{i:03d}"},
        )
        for i in range(15)
    ]
    reimport = client.post(
        "/api/imports?dry_run=false",
        files={"file": ("p.csv", (header + "Hot Item,HOT-1,,Deals,5,40,1\n").encode(), "text/csv")},
    )
    await asyncio.gather(*buyers, reimport)
    report = (await client.get("/api/admin/invariants")).json()
    assert report["passed"], [c for c in report["checks"] if not c["passed"]]
