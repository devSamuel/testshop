import os
import subprocess
import sys
from collections.abc import AsyncIterator, Iterator
from decimal import Decimal
from pathlib import Path
from typing import Any

import httpx
import pytest
from sqlalchemy import text

from app.bootstrap import Container, build_container
from app.catalog import service as catalog
from app.core.config import Settings
from app.inventory import service as inventory
from app.inventory.models import MovementReason
from app.main import create_app

BACKEND_DIR = Path(__file__).resolve().parents[1]
TABLES = [
    "notifications",
    "order_items",
    "stock_reservations",
    "stock_alerts",
    "stock_movements",
    "orders",
    "products",
    "categories",
    "import_issues",
    "import_runs",
    "outbox_events",
    "processed_events",
    "payment_sim_charges",
]


def _sync_url(url: str) -> str:
    return url.replace("postgresql+asyncpg://", "postgresql+psycopg://")


@pytest.fixture(scope="session")
def database_url() -> Iterator[str]:
    configured = os.environ.get("TEST_DATABASE_URL")
    if configured:
        yield configured
        return
    os.environ.setdefault("TESTCONTAINERS_RYUK_DISABLED", "true")
    from testcontainers.postgres import PostgresContainer

    with PostgresContainer("postgres:16-alpine", driver="asyncpg") as pg:
        yield pg.get_connection_url()


@pytest.fixture(scope="session")
def migrated(database_url: str) -> str:
    import sqlalchemy

    engine = sqlalchemy.create_engine(_sync_url(database_url), isolation_level="AUTOCOMMIT")
    with engine.connect() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    engine.dispose()
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=BACKEND_DIR,
        env={**os.environ, "ALEMBIC_DATABASE_URL": database_url},
        check=True,
        capture_output=True,
    )
    return database_url


@pytest.fixture(scope="session")
def settings(migrated: str, tmp_path_factory: pytest.TempPathFactory) -> Settings:
    return Settings(
        import_storage_dir=tmp_path_factory.mktemp("uploads"),
        database_url=migrated,
        app_env="test",
        log_level="WARNING",
        reservation_ttl_seconds=600,
        reconcile_after_seconds=0,
        payment_timeout_seconds=1.0,
        fake_payment_slow_seconds=2.0,
        import_batch_size=50,
        low_stock_threshold=5,
        db_pool_size=30,
        static_dir=None,
    )


class _StorageHandle:
    root: Path = Path()


STORAGE = _StorageHandle()


@pytest.fixture(scope="session")
async def container(settings: Settings) -> AsyncIterator[Container]:
    STORAGE.root = settings.import_storage_dir
    built = build_container(settings)
    yield built
    await built.db.dispose()


@pytest.fixture(autouse=True)
async def clean_db(request: pytest.FixtureRequest) -> None:
    if "container" not in request.fixturenames:
        return
    container: Container = request.getfixturevalue("container")
    async with container.db.engine.begin() as conn:
        await conn.execute(text(f"TRUNCATE {', '.join(TABLES)} RESTART IDENTITY CASCADE"))


@pytest.fixture
async def client(settings: Settings, container: Container) -> AsyncIterator[httpx.AsyncClient]:
    app = create_app(settings, container)
    app.state.container = container
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as http:
        yield http


class Factory:
    def __init__(self, container: Container) -> None:
        self.container = container
        self._seq = 0

    async def product(
        self,
        *,
        sku: str | None = None,
        name: str | None = None,
        price: str = "10.00",
        stock: int = 10,
        category: str = "General",
        description: str = "",
        weight_kg: str | None = "1.000",
    ) -> int:
        self._seq += 1
        async with self.container.db.sessions() as session, session.begin():
            product = await catalog.create_product(
                session,
                catalog.ProductFields(
                    sku=sku or f"SKU-{self._seq:05d}",
                    name=name or f"Product {self._seq}",
                    description=description,
                    category=category,
                    price=Decimal(price),
                    weight_kg=Decimal(weight_kg) if weight_kg else None,
                ),
            )
            if stock:
                await inventory.set_stock(
                    session, product.id, stock, reason=MovementReason.admin_adjustment, reference_type="test"
                )
            return product.id

    async def stock(self, product_id: int) -> int:
        async with self.container.db.sessions() as session:
            value = await session.scalar(
                text("SELECT stock FROM products WHERE id = :id"), {"id": product_id}
            )
            return int(value)

    async def scalar(self, sql: str, **params: Any) -> Any:
        async with self.container.db.sessions() as session:
            return await session.scalar(text(sql), params)


@pytest.fixture
def factory(container: Container) -> Factory:
    return Factory(container)


APPROVE = "4242424242424242"
DECLINE = "4000000000000002"
SLOW = "4000000000000101"


def checkout_body(
    items: list[tuple[int, int]], card: str = APPROVE, email: str = "buyer@example.com"
) -> dict[str, Any]:
    return {
        "email": email,
        "items": [{"product_id": pid, "quantity": qty} for pid, qty in items],
        "card": {"number": card, "exp_month": 12, "exp_year": 2035, "cvc": "123"},
    }
