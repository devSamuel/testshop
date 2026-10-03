import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api import admin, health, imports, orders, products
from app.bootstrap import Container, build_container
from app.core.config import Settings, get_settings
from app.core.errors import problem, register_error_handlers
from app.core.limits import UploadSizeLimitMiddleware
from app.core.logging import RequestContextMiddleware, configure_logging

logger = logging.getLogger("app")

MULTIPART_OVERHEAD_BYTES = 64 * 1024


def create_app(settings: Settings | None = None, container: Container | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.container = container or build_container(settings)
        logger.info("application started", extra={"env": settings.app_env})
        try:
            yield
        finally:
            if container is None:
                await app.state.container.db.dispose()

    app = FastAPI(
        title="Shop API",
        version="1.0.0",
        description="Catalog, CSV import, search and a crash-safe checkout saga.",
        lifespan=lifespan,
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )
    app.add_middleware(
        UploadSizeLimitMiddleware,
        path="/api/imports",
        max_body_bytes=settings.import_max_bytes + MULTIPART_OVERHEAD_BYTES,
    )
    app.add_middleware(RequestContextMiddleware)
    register_error_handlers(app)
    for module in (health, products, imports, orders, admin):
        app.include_router(module.router)
    _mount_spa(app, settings.static_dir)
    return app


def _mount_spa(app: FastAPI, static_dir: Path | None) -> None:
    @app.api_route(
        "/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False
    )
    async def api_not_found(request: Request, path: str) -> JSONResponse:
        return problem(
            404, "not-found", "Resource not found", f"No API route for /api/{path}", request.url.path
        )

    if static_dir is None or not (static_dir / "index.html").exists():
        return
    root = static_dir.resolve()
    index = root / "index.html"
    if (root / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=root / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str) -> FileResponse:
        candidate = (root / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(root):
            return FileResponse(candidate)
        return FileResponse(index, headers={"Cache-Control": "no-cache"})


app = create_app()
