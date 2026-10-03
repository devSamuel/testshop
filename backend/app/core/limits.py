from fastapi import HTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.errors import problem


class UploadTooLargeError(HTTPException):
    def __init__(self, max_body_bytes: int) -> None:
        super().__init__(status_code=413, detail=f"File is larger than {max_body_bytes // (1024 * 1024)} MB")


class UploadSizeLimitMiddleware:
    def __init__(self, app: ASGIApp, *, path: str, max_body_bytes: int) -> None:
        self.app = app
        self.path = path.rstrip("/")
        self.max_body_bytes = max_body_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] != "POST" or scope["path"].rstrip("/") != self.path:
            await self.app(scope, receive, send)
            return
        declared = dict(scope["headers"]).get(b"content-length")
        if declared is not None and declared.isdigit() and int(declared) > self.max_body_bytes:
            await self._reject(scope, receive, send)
            return

        received = 0
        response_started = False

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_body_bytes:
                    raise UploadTooLargeError(self.max_body_bytes)
            return message

        async def tracking_send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, tracking_send)
        except UploadTooLargeError:
            if not response_started:
                await self._reject(scope, receive, send)

    async def _reject(self, scope: Scope, receive: Receive, send: Send) -> None:
        limit_mb = self.max_body_bytes // (1024 * 1024)
        response = problem(
            413,
            "payload-too-large",
            "Payload too large",
            f"File is larger than {limit_mb} MB",
            scope["path"],
        )
        response.headers["Connection"] = "close"
        await response(scope, receive, send)
