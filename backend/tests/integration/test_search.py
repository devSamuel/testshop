import httpx
import pytest

from tests.conftest import Factory


@pytest.fixture
async def catalog(factory: Factory) -> dict[str, int]:
    return {
        "headphones": await factory.product(
            sku="AUD-100",
            name="Wireless Noise Cancelling Headphones",
            category="Audio",
            price="199.00",
            stock=5,
        ),
        "earbuds": await factory.product(
            sku="AUD-200", name="Wireless Earbuds", category="Audio", price="79.00", stock=0
        ),
        "keyboard": await factory.product(
            sku="KEY-100",
            name="Mechanical Keyboard",
            description="Hot-swappable switches",
            category="Office",
            price="89.00",
        ),
        "lamp": await factory.product(sku="LMP-1", name="Desk Lamp", category="Office", price="29.00"),
        "sku_lookalike": await factory.product(
            sku="AUD-1000", name="Audio Cable", category="Audio", price="9.00"
        ),
    }


async def names(client: httpx.AsyncClient, query: str) -> list[str]:
    return [p["name"] for p in (await client.get(f"/api/products?{query}")).json()["items"]]


async def test_prefix_search(client: httpx.AsyncClient, catalog: dict[str, int]) -> None:
    assert "Wireless Noise Cancelling Headphones" in await names(client, "q=headph")


async def test_typo_tolerance(client: httpx.AsyncClient, catalog: dict[str, int]) -> None:
    assert (await names(client, "q=headphnes"))[0] == "Wireless Noise Cancelling Headphones"
    page = (await client.get("/api/products?q=headphnes")).json()
    assert page["fuzzy"] is False


async def test_transposed_letters_fall_back_to_fuzzy_matching(
    client: httpx.AsyncClient, catalog: dict[str, int]
) -> None:
    page = (await client.get("/api/products?q=keybaord")).json()
    assert page["fuzzy"] is True
    assert page["items"][0]["name"] == "Mechanical Keyboard"


async def test_nonsense_returns_nothing_even_with_fallback(
    client: httpx.AsyncClient, catalog: dict[str, int]
) -> None:
    page = (await client.get("/api/products?q=zzxqv")).json()
    assert (page["total"], page["fuzzy"]) == (0, False)


async def test_description_is_searchable(client: httpx.AsyncClient, catalog: dict[str, int]) -> None:
    assert await names(client, "q=swappable") == ["Mechanical Keyboard"]


async def test_exact_sku_ranks_first(client: httpx.AsyncClient, catalog: dict[str, int]) -> None:
    results = await names(client, "q=aud-100")
    assert results[0] == "Wireless Noise Cancelling Headphones"
    assert "Audio Cable" in results


async def test_multi_word_query(client: httpx.AsyncClient, catalog: dict[str, int]) -> None:
    assert (await names(client, "q=wireless+earbuds"))[0] == "Wireless Earbuds"


async def test_filters(client: httpx.AsyncClient, catalog: dict[str, int]) -> None:
    assert set(await names(client, "category=office")) == {"Desk Lamp", "Mechanical Keyboard"}
    assert set(await names(client, "min_price=50&max_price=100")) == {
        "Wireless Earbuds",
        "Mechanical Keyboard",
    }
    assert "Wireless Earbuds" not in await names(client, "in_stock=true")


async def test_sorting_and_pagination(client: httpx.AsyncClient, catalog: dict[str, int]) -> None:
    page1 = (await client.get("/api/products?sort=price_asc&page_size=2&page=1")).json()
    page3 = (await client.get("/api/products?sort=price_asc&page_size=2&page=3")).json()
    assert page1["total"] == 5
    assert [p["price"] for p in page1["items"]] == ["9.00", "29.00"]
    assert [p["price"] for p in page3["items"]] == ["199.00"]
    beyond = (await client.get("/api/products?page_size=2&page=9")).json()
    assert beyond["items"] == []
    assert beyond["total"] == 5


async def test_special_characters_are_safe(client: httpx.AsyncClient, catalog: dict[str, int]) -> None:
    for query in ["q=%25", "q=_", "q=%27%3B+drop+table+products%3B--", "q=%26%7C%21", "q=+"]:
        assert (await client.get(f"/api/products?{query}")).status_code == 200
    assert (await client.get("/api/products")).json()["total"] == 5


async def test_invalid_params_are_rejected(client: httpx.AsyncClient) -> None:
    assert (await client.get("/api/products?page_size=1000")).status_code == 422
    assert (await client.get("/api/products?sort=random")).status_code == 422
