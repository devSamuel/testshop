import asyncio
import logging
import signal
import sys

from app.bootstrap import Container, build_container, start_background_workers
from app.core.config import get_settings
from app.core.logging import configure_logging

logger = logging.getLogger("worker")


async def serve(container: Container, stop: asyncio.Event) -> None:
    tasks = start_background_workers(container, stop)
    logger.info(
        "worker started",
        extra={"dispatchers": container.settings.dispatcher_workers, "reconciler": True},
    )
    await stop.wait()
    await asyncio.gather(*tasks, return_exceptions=True)
    logger.info("worker stopped")


async def run() -> int:
    settings = get_settings()
    configure_logging(settings.log_level)
    container = build_container(settings)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    try:
        await serve(container, stop)
    finally:
        await container.db.dispose()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(run()))
