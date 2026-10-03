import asyncio
import importlib
from dataclasses import dataclass
from datetime import timedelta

from app.core.config import Settings
from app.core.db import Database
from app.events.dispatcher import DispatcherConfig, InProcessDispatcher
from app.events.registry import HandlerRegistry, registry
from app.importing.service import ImportService
from app.importing.storage import LocalUploadStore
from app.orders.checkout import CheckoutService
from app.orders.reconciler import OrderReconciler
from app.payments.fake import FakePaymentProvider
from app.payments.provider import PaymentProvider

HANDLER_MODULES = ("app.inventory.handlers", "app.orders.handlers")


def register_handlers() -> HandlerRegistry:
    for module in HANDLER_MODULES:
        importlib.import_module(module)
    return registry


@dataclass(slots=True)
class Container:
    settings: Settings
    db: Database
    payments: PaymentProvider
    checkout: CheckoutService
    reconciler: OrderReconciler
    dispatcher: InProcessDispatcher
    importer: ImportService


def build_container(settings: Settings, payments: PaymentProvider | None = None) -> Container:
    db = Database(settings)
    provider = payments or FakePaymentProvider(db.sessions, settings.fake_payment_slow_seconds)
    checkout = CheckoutService(db.sessions, provider, settings)
    return Container(
        settings=settings,
        db=db,
        payments=provider,
        checkout=checkout,
        reconciler=OrderReconciler(
            db.engine,
            db.sessions,
            provider,
            checkout,
            reconcile_after=timedelta(seconds=settings.reconcile_after_seconds),
            interval_seconds=settings.sweeper_interval_seconds,
        ),
        dispatcher=InProcessDispatcher(
            db.sessions,
            register_handlers(),
            DispatcherConfig(
                batch_size=settings.dispatcher_batch_size,
                max_attempts=settings.outbox_max_attempts,
                backoff_base_seconds=settings.outbox_backoff_base_seconds,
                poll_interval_seconds=settings.dispatcher_poll_interval_seconds,
            ),
        ),
        importer=ImportService(
            db.sessions,
            settings,
            LocalUploadStore(settings.import_storage_dir, settings.import_upload_retention_hours * 3600),
        ),
    )


def start_background_workers(container: Container, stop: asyncio.Event) -> list[asyncio.Task[None]]:
    tasks = [
        asyncio.create_task(container.dispatcher.run_forever(stop), name=f"outbox-dispatcher-{n}")
        for n in range(container.settings.dispatcher_workers)
    ]
    tasks.append(asyncio.create_task(container.reconciler.run_forever(stop), name="order-reconciler"))
    return tasks
