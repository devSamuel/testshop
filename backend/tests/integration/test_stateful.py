import asyncio
import contextlib
import itertools
from collections.abc import Awaitable
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any, ClassVar, TypeVar

from hypothesis import HealthCheck
from hypothesis import settings as hypothesis_settings
from hypothesis import strategies as st
from hypothesis.stateful import (
    Bundle,
    RuleBasedStateMachine,
    initialize,
    invariant,
    rule,
    run_state_machine_as_test,
)
from sqlalchemy import text, update

from app.bootstrap import Container, build_container
from app.catalog import service as catalog
from app.core.config import Settings
from app.core.errors import InsufficientStockError
from app.inventory import service as inventory
from app.inventory.invariants import check_inventory
from app.inventory.models import MovementReason
from app.inventory.service import ReservationLine
from app.orders.checkout import CheckoutCommand, fingerprint
from app.orders.invariants import check_orders, check_payments
from app.orders.models import Order, OrderStatus
from app.payments.provider import Card
from tests.conftest import APPROVE, DECLINE, TABLES

T = TypeVar("T")
quantities = st.integers(min_value=1, max_value=3)
cards = st.sampled_from([APPROVE, APPROVE, DECLINE])


class CheckoutMachine(RuleBasedStateMachine):
    app_settings: ClassVar[Settings]

    products = Bundle("products")

    def __init__(self) -> None:
        super().__init__()
        self.loop = asyncio.new_event_loop()
        self.container: Container = build_container(self.app_settings)
        self.keys = itertools.count()
        self.run(self._truncate())

    def run(self, awaitable: Awaitable[T]) -> T:
        return self.loop.run_until_complete(awaitable)

    async def _truncate(self) -> None:
        async with self.container.db.engine.begin() as conn:
            await conn.execute(text(f"TRUNCATE {', '.join(TABLES)} RESTART IDENTITY CASCADE"))

    def teardown(self) -> None:
        self.run(self.container.db.dispose())
        self.loop.close()

    def command(self, product_id: int, quantity: int, card: str) -> CheckoutCommand:
        return CheckoutCommand(
            f"sm-{next(self.keys):06d}",
            "fuzz@example.com",
            [ReservationLine(product_id, quantity)],
            Card(card, 12, 2035, "123"),
        )

    @initialize(target=products)
    def first_product(self) -> int:
        return self.run(self._create(3))

    @rule(target=products, stock=st.integers(min_value=0, max_value=6))
    def create_product(self, stock: int) -> int:
        return self.run(self._create(stock))

    async def _create(self, stock: int) -> int:
        async with self.container.db.sessions() as session, session.begin():
            product = await catalog.create_product(
                session,
                catalog.ProductFields(
                    sku=f"SM-{next(self.keys):06d}",
                    name="Fuzz item",
                    description="",
                    category="Fuzz",
                    price=Decimal("2.50"),
                    weight_kg=None,
                ),
            )
            await inventory.set_stock(session, product.id, stock, reason=MovementReason.admin_adjustment)
            return product.id

    @rule(product=products, stock=st.integers(min_value=0, max_value=8))
    def admin_sets_stock(self, product: int, stock: int) -> None:
        self.run(self._admin_set(product, stock))

    async def _admin_set(self, product: int, stock: int) -> None:
        async with self.container.db.sessions() as session, session.begin():
            sku = await session.scalar(text("SELECT sku FROM products WHERE id = :id"), {"id": product})
        csv = f"sku,name,price,stock\n{sku},Fuzz item,2.50,{stock}\n".encode()
        await self.container.importer.import_bytes("fuzz.csv", csv, dry_run=False, source="test")

    @rule(product=products, quantity=quantities, card=cards)
    def checkout(self, product: int, quantity: int, card: str) -> None:
        with contextlib.suppress(InsufficientStockError):
            self.run(self.container.checkout.place_order(self.command(product, quantity, card)))

    @rule(product=products, quantity=quantities)
    def crash_after_reserve(self, product: int, quantity: int) -> None:
        cmd = self.command(product, quantity, APPROVE)
        with contextlib.suppress(InsufficientStockError):
            self.run(self.container.checkout.reserve(cmd, fingerprint(cmd)))

    @rule(product=products, quantity=quantities, card=cards)
    def crash_after_charge(self, product: int, quantity: int, card: str) -> None:
        cmd = self.command(product, quantity, card)
        try:
            order = self.run(self.container.checkout.reserve(cmd, fingerprint(cmd)))
        except InsufficientStockError:
            return
        self.run(self.container.checkout.charge(order, cmd.card))

    @rule()
    def time_passes_and_reconciler_runs(self) -> None:
        self.run(self._expire_all_pending())
        self.run(self.container.reconciler.run_once())

    async def _expire_all_pending(self) -> None:
        async with self.container.db.sessions() as session, session.begin():
            await session.execute(
                update(Order)
                .where(Order.status == OrderStatus.pending_payment)
                .values(reservation_expires_at=datetime.now(UTC) - timedelta(seconds=1))
            )

    @rule()
    def events_are_delivered(self) -> None:
        self.run(self.container.dispatcher.drain())

    @invariant()
    def the_books_balance(self) -> None:
        failures = self.run(self._failures())
        assert not failures, failures

    async def _failures(self) -> list[dict[str, Any]]:
        async with self.container.db.sessions() as session:
            results = [
                *await check_inventory(session),
                *await check_orders(session, stuck_grace_seconds=3600),
                *await check_payments(session, self.container.payments),
            ]
        return [{"check": r.name, "violations": r.violations} for r in results if not r.passed]


def test_random_interleavings_preserve_every_invariant(settings: Settings) -> None:
    CheckoutMachine.app_settings = settings.model_copy(
        update={"reconcile_after_seconds": 0, "db_pool_size": 5}
    )
    run_state_machine_as_test(
        CheckoutMachine,
        settings=hypothesis_settings(
            max_examples=25,
            stateful_step_count=30,
            deadline=None,
            suppress_health_check=[HealthCheck.too_slow, HealthCheck.filter_too_much],
        ),
    )
