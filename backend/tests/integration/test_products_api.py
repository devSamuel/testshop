import httpx

from tests.conftest import Factory


async def create(client: httpx.AsyncClient, **overrides: object) -> httpx.Response:
    body = {
        "sku": "kb-01",
        "name": "  Mechanical   Keyboard ",
        "description": "RGB",
        "category": "electronics",
        "price": "89.50",
        "stock": 7,
        "weight_kg": "0.9",
        **overrides,
    }
    return await client.post("/api/products", json=body)


async def test_create_normalizes_and_writes_initial_stock_to_ledger(client: httpx.AsyncClient) -> None:
    response = await create(client)
    assert response.status_code == 201
    product = response.json()
    assert response.headers["location"] == f"/api/products/{product['id']}"
    assert product["sku"] == "KB-01"
    assert product["name"] == "Mechanical Keyboard"
    assert product["category"] == "Electronics"
    assert product["price"] == "89.50"
    assert product["stock"] == 7
    assert product["version"] == 1
    history = (await client.get(f"/api/products/{product['id']}/stock-movements")).json()
    assert [(m["delta"], m["balance_after"], m["reason"]) for m in history] == [(7, 7, "admin_adjustment")]


async def test_duplicate_sku_is_a_conflict(client: httpx.AsyncClient) -> None:
    assert (await create(client)).status_code == 201
    response = await create(client, sku="KB-01 ")
    assert response.status_code == 409
    assert response.headers["content-type"] == "application/problem+json"
    assert response.json()["type"].endswith("/duplicate-sku")


async def test_html_markup_is_rejected_on_create_and_update(client: httpx.AsyncClient) -> None:
    response = await create(client, name="<script>alert('xss')</script>")
    assert response.status_code == 422
    assert {e["field"] for e in response.json()["errors"]} == {"name"}
    product = (await create(client)).json()
    edit = await client.patch(
        f"/api/products/{product['id']}", json={"version": 1, "description": "<img src=x onerror=alert(1)>"}
    )
    assert edit.status_code == 422


async def test_validation_errors_are_problem_json(client: httpx.AsyncClient) -> None:
    response = await create(client, price="12.345", stock=-1, sku="bad sku!")
    assert response.status_code == 422
    fields = {e["field"] for e in response.json()["errors"]}
    assert {"price", "stock", "sku"} <= fields


async def test_update_with_optimistic_locking(client: httpx.AsyncClient) -> None:
    product = (await create(client)).json()
    first = await client.patch(f"/api/products/{product['id']}", json={"version": 1, "price": "79.00"})
    assert first.status_code == 200
    assert first.json()["version"] == 2
    stale = await client.patch(f"/api/products/{product['id']}", json={"version": 1, "name": "Overwrite"})
    assert stale.status_code == 409
    assert stale.json()["current_version"] == 2
    assert (await client.get(f"/api/products/{product['id']}")).json()["price"] == "79.00"


async def test_stock_edit_is_recorded_as_adjustment(client: httpx.AsyncClient) -> None:
    product = (await create(client)).json()
    response = await client.patch(f"/api/products/{product['id']}", json={"version": 1, "stock": 3})
    assert response.json()["stock"] == 3
    history = (await client.get(f"/api/products/{product['id']}/stock-movements")).json()
    assert [(m["delta"], m["balance_after"]) for m in history] == [(-4, 3), (7, 7)]


async def test_stock_edit_detects_sales_since_the_form_was_loaded(
    client: httpx.AsyncClient, factory: Factory
) -> None:
    product = (await create(client)).json()
    await client.post(
        "/api/orders",
        json={
            "email": "a@b.co",
            "items": [{"product_id": product["id"], "quantity": 2}],
            "card": {"number": "4242424242424242", "exp_month": 12, "exp_year": 2035, "cvc": "123"},
        },
        headers={"Idempotency-Key": "sold-while-editing"},
    )
    stale = await client.patch(
        f"/api/products/{product['id']}", json={"version": 1, "stock": 10, "expected_stock": 7}
    )
    assert stale.status_code == 409
    assert (stale.json()["current_stock"], stale.json()["your_stock"]) == (5, 7)
    fresh = await client.patch(
        f"/api/products/{product['id']}", json={"version": 1, "stock": 10, "expected_stock": 5}
    )
    assert fresh.json()["stock"] == 10


async def test_delete_requires_a_version(client: httpx.AsyncClient) -> None:
    product = (await create(client)).json()
    assert (await client.delete(f"/api/products/{product['id']}")).status_code == 422


async def test_partial_update_keeps_other_fields_and_can_clear_weight(client: httpx.AsyncClient) -> None:
    product = (await create(client)).json()
    updated = (
        await client.patch(
            f"/api/products/{product['id']}", json={"version": 1, "weight_kg": None, "name": None}
        )
    ).json()
    assert updated["weight_kg"] is None
    assert updated["name"] == "Mechanical Keyboard"


async def test_soft_delete_hides_product_but_keeps_sku_reusable(
    client: httpx.AsyncClient, factory: Factory
) -> None:
    product = (await create(client)).json()
    assert (await client.delete(f"/api/products/{product['id']}?version=1")).status_code == 204
    assert (await client.get(f"/api/products/{product['id']}")).status_code == 404
    assert (await client.get("/api/products?q=keyboard")).json()["total"] == 0
    assert await factory.scalar("SELECT count(*) FROM products WHERE deleted_at IS NOT NULL") == 1
    assert (await create(client)).status_code == 201


async def test_delete_with_stale_version_is_rejected(client: httpx.AsyncClient) -> None:
    product = (await create(client)).json()
    await client.patch(f"/api/products/{product['id']}", json={"version": 1, "price": "1.00"})
    assert (await client.delete(f"/api/products/{product['id']}?version=1")).status_code == 409


async def test_categories_endpoint_counts_active_products(
    client: httpx.AsyncClient, factory: Factory
) -> None:
    await factory.product(category="Home")
    await factory.product(category="home ")
    await factory.product(category="Office")
    categories = {c["name"]: c["product_count"] for c in (await client.get("/api/categories")).json()}
    assert categories == {"Home": 2, "Office": 1}


async def test_unknown_api_route_is_problem_json(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/nope")
    assert response.status_code == 404
    assert response.headers["content-type"] == "application/problem+json"


async def test_health_endpoints(client: httpx.AsyncClient) -> None:
    assert (await client.get("/healthz")).json() == {"status": "ok"}
    assert (await client.get("/readyz")).json()["database"] == "up"
