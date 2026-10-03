import asyncio
import hashlib
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Protocol

from app.core.errors import PayloadTooLargeError

COPY_CHUNK_BYTES = 1 << 20


@dataclass(frozen=True, slots=True)
class StoredUpload:
    key: str
    filename: str
    size: int
    sha256: str


class UploadStore(Protocol):
    async def save(self, source: BinaryIO, filename: str, max_bytes: int) -> StoredUpload: ...

    def open(self, key: str) -> BinaryIO: ...

    def exists(self, key: str) -> bool: ...

    async def purge_expired(self) -> int: ...


class LocalUploadStore:
    def __init__(self, root: Path, retention_seconds: float) -> None:
        self._root = root
        self._retention_seconds = retention_seconds

    def _path(self, key: str) -> Path:
        if not key.endswith(".csv") or "/" in key or ".." in key:
            raise ValueError(f"Invalid upload key {key!r}")
        return self._root / key

    async def save(self, source: BinaryIO, filename: str, max_bytes: int) -> StoredUpload:
        return await asyncio.to_thread(self._save, source, filename, max_bytes)

    def _save(self, source: BinaryIO, filename: str, max_bytes: int) -> StoredUpload:
        self._root.mkdir(parents=True, exist_ok=True)
        key = f"{uuid.uuid4().hex}.csv"
        target = self._path(key)
        digest = hashlib.sha256()
        size = 0
        try:
            with target.open("wb") as sink:
                while chunk := source.read(COPY_CHUNK_BYTES):
                    size += len(chunk)
                    if size > max_bytes:
                        raise PayloadTooLargeError(f"File is larger than {max_bytes // (1024 * 1024)} MB")
                    digest.update(chunk)
                    sink.write(chunk)
        except BaseException:
            target.unlink(missing_ok=True)
            raise
        return StoredUpload(key=key, filename=filename, size=size, sha256=digest.hexdigest())

    def open(self, key: str) -> BinaryIO:
        return self._path(key).open("rb")

    def exists(self, key: str) -> bool:
        try:
            return self._path(key).is_file()
        except ValueError:
            return False

    async def purge_expired(self) -> int:
        return await asyncio.to_thread(self._purge_expired)

    def _purge_expired(self) -> int:
        if not self._root.is_dir():
            return 0
        cutoff = time.time() - self._retention_seconds
        removed = 0
        for path in self._root.glob("*.csv"):
            if path.stat().st_mtime < cutoff:
                path.unlink(missing_ok=True)
                removed += 1
        return removed
