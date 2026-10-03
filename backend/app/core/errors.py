from http import HTTPStatus
from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

PROBLEM_JSON = "application/problem+json"
HTTP_ERROR_TYPES = {
    404: "not-found",
    405: "method-not-allowed",
    413: "payload-too-large",
}


class DomainError(Exception):
    status_code: int = status.HTTP_400_BAD_REQUEST
    type_slug: str = "bad-request"
    title: str = "Bad request"

    def __init__(self, detail: str, **extensions: Any) -> None:
        super().__init__(detail)
        self.detail = detail
        self.extensions = extensions


class NotFoundError(DomainError):
    status_code = status.HTTP_404_NOT_FOUND
    type_slug = "not-found"
    title = "Resource not found"


class ConflictError(DomainError):
    status_code = status.HTTP_409_CONFLICT
    type_slug = "conflict"
    title = "Conflict"


class StaleVersionError(ConflictError):
    type_slug = "stale-version"
    title = "The resource was modified by someone else"


class StockChangedError(StaleVersionError):
    pass


class DuplicateSkuError(ConflictError):
    type_slug = "duplicate-sku"
    title = "SKU already exists"


class InsufficientStockError(ConflictError):
    type_slug = "insufficient-stock"
    title = "Not enough stock"


class IdempotencyKeyReusedError(DomainError):
    status_code = status.HTTP_422_UNPROCESSABLE_CONTENT
    type_slug = "idempotency-key-reused"
    title = "Idempotency-Key was already used with a different request"


class InvalidRequestError(DomainError):
    status_code = status.HTTP_422_UNPROCESSABLE_CONTENT
    type_slug = "invalid-request"
    title = "Invalid request"


class PayloadTooLargeError(DomainError):
    status_code = status.HTTP_413_CONTENT_TOO_LARGE
    type_slug = "payload-too-large"
    title = "Payload too large"


def problem(
    status_code: int, type_slug: str, title: str, detail: str, instance: str, **extensions: Any
) -> JSONResponse:
    body: dict[str, Any] = {
        "type": f"https://errors.shop.local/{type_slug}",
        "title": title,
        "status": status_code,
        "detail": detail,
        "instance": instance,
        **extensions,
    }
    return JSONResponse(body, status_code=status_code, media_type=PROBLEM_JSON)


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(DomainError)
    async def handle_domain_error(request: Request, exc: DomainError) -> JSONResponse:
        return problem(
            exc.status_code, exc.type_slug, exc.title, exc.detail, request.url.path, **exc.extensions
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        errors = [
            {"field": ".".join(str(p) for p in err["loc"] if p != "body"), "message": err["msg"]}
            for err in exc.errors()
        ]
        return problem(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "validation-error",
            "Request validation failed",
            "One or more fields are invalid",
            request.url.path,
            errors=errors,
        )

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        return problem(
            exc.status_code,
            HTTP_ERROR_TYPES.get(exc.status_code, "http-error"),
            HTTPStatus(exc.status_code).phrase,
            str(exc.detail),
            request.url.path,
        )
