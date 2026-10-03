import asyncio
import io
import logging
import time
import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal
from enum import StrEnum
from typing import Any, BinaryIO

from sqlalchemy import Boolean, String, any_, cast, func, insert, literal_column, select, tuple_
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.catalog.models import Category, Product
from app.catalog.normalize import category_key
from app.catalog.service import ensure_categories
from app.core.config import Settings
from app.core.errors import ConflictError, NotFoundError
from app.importing.models import ImportIssue, ImportRun
from app.importing.parsing import CsvStream, CsvStructureError, Issue, ParsedRow, Severity
from app.importing.storage import StoredUpload, UploadStore
from app.inventory.models import MovementReason
from app.inventory.service import Movement, active_reserved_quantities, record_movements

logger = logging.getLogger("importing")

ISSUE_FLUSH_SIZE = 1000
ISSUE_VALUE_MAX = 300


class ImportStatus(StrEnum):
    dry_run = "dry_run"
    running = "running"
    completed = "completed"
    rejected = "rejected"
    failed = "failed"


class ImportNotApplicableError(ConflictError):
    type_slug = "import-not-applicable"
    title = "This import cannot be applied"


@dataclass(slots=True)
class ImportReport:
    run_id: uuid.UUID
    filename: str
    status: ImportStatus
    dry_run: bool
    parent_run_id: uuid.UUID | None = None
    file_size: int | None = None
    file_sha256: str | None = None
    rows_total: int = 0
    rows_valid: int = 0
    rows_invalid: int = 0
    rows_applied: int = 0
    created: int = 0
    updated: int = 0
    unchanged: int = 0
    duplicates: int = 0
    blank_rows: int = 0
    error_count: int = 0
    warning_count: int = 0
    duration_ms: int = 0
    failure: str | None = None
    preview: list[Issue] = field(default_factory=list)

    @property
    def issues_total(self) -> int:
        return self.error_count + self.warning_count


@dataclass(frozen=True, slots=True)
class _Existing:
    id: int
    stock: int
    name: str
    description: str
    category_key: str
    price: Decimal
    weight_kg: Decimal | None


class _IssueSink:
    def __init__(self, report: ImportReport) -> None:
        self._report = report
        self.pending: list[Issue] = []

    def add(self, issues: Iterable[Issue]) -> None:
        for issue in issues:
            if issue.severity is Severity.error:
                self._report.error_count += 1
            else:
                self._report.warning_count += 1
            self.pending.append(issue)

    def take(self) -> list[Issue]:
        taken, self.pending = self.pending, []
        return taken


class ImportService:
    def __init__(
        self, sessions: async_sessionmaker[AsyncSession], settings: Settings, store: UploadStore
    ) -> None:
        self._sessions = sessions
        self._settings = settings
        self._store = store

    async def store_upload(self, source: BinaryIO, filename: str) -> StoredUpload:
        await self._store.purge_expired()
        return await self._store.save(source, filename[:255] or "upload.csv", self._settings.import_max_bytes)

    async def import_bytes(self, filename: str, data: bytes, *, dry_run: bool, source: str) -> ImportReport:
        stored = await self.store_upload(io.BytesIO(data), filename)
        return await self.run(stored, dry_run=dry_run, source=source)

    async def apply(self, dry_run_id: uuid.UUID) -> ImportReport:
        new_run_id = uuid.uuid4()
        async with self._sessions() as session, session.begin():
            parent = await session.get(ImportRun, dry_run_id, with_for_update=True)
            if parent is None:
                raise NotFoundError(f"Import run {dry_run_id} does not exist")
            reason = await self._not_applicable_reason(session, parent)
            if reason:
                raise ImportNotApplicableError(reason, run_id=str(dry_run_id))
            parent.applied_run_id = new_run_id
            stored = StoredUpload(
                key=parent.stored_key or "",
                filename=parent.filename,
                size=parent.file_size or 0,
                sha256=parent.file_sha256 or "",
            )
        return await self.run(
            stored, dry_run=False, source="apply", parent_run_id=dry_run_id, run_id=new_run_id
        )

    async def can_apply(self, session: AsyncSession, run: ImportRun) -> bool:
        return await self._not_applicable_reason(session, run) is None

    async def _not_applicable_reason(self, session: AsyncSession, run: ImportRun) -> str | None:
        if run.status != ImportStatus.dry_run:
            return "Only a dry run can be applied"
        if run.rows_valid == 0:
            return "The dry run found no valid rows to import"
        if run.applied_run_id is not None:
            applied_status = await session.scalar(
                select(ImportRun.status).where(ImportRun.id == run.applied_run_id)
            )
            if applied_status != ImportStatus.failed:
                return "This dry run was already applied"
        if not run.stored_key or not self._store.exists(run.stored_key):
            return "The uploaded file is no longer stored; please upload it again"
        return None

    async def run(
        self,
        stored: StoredUpload,
        *,
        dry_run: bool,
        source: str,
        parent_run_id: uuid.UUID | None = None,
        run_id: uuid.UUID | None = None,
    ) -> ImportReport:
        started = time.perf_counter()
        report = ImportReport(
            run_id=run_id or uuid.uuid4(),
            filename=stored.filename,
            status=ImportStatus.running,
            dry_run=dry_run,
            parent_run_id=parent_run_id,
            file_size=stored.size,
            file_sha256=stored.sha256,
        )
        await self._save(report, source, stored.key)
        sink = _IssueSink(report)
        try:
            await self._process(stored, report, sink)
            report.status = ImportStatus.dry_run if dry_run else ImportStatus.completed
        except CsvStructureError as exc:
            report.status = ImportStatus.failed if report.rows_applied else ImportStatus.rejected
            report.failure = self._failure_message(str(exc), report)
            sink.add([Issue(None, Severity.error, str(exc))])
        except Exception as exc:
            logger.exception("import failed", extra={"run_id": str(report.run_id)})
            report.status = ImportStatus.failed
            report.failure = self._failure_message(f"{type(exc).__name__}: {exc}", report)
        await self._write_issues(report.run_id, sink.take())
        return await self._finish(report, started, source, stored.key)

    def _failure_message(self, reason: str, report: ImportReport) -> str:
        if report.dry_run or report.rows_applied == 0:
            return reason
        return (
            f"{reason}. The first {report.rows_applied} valid rows were applied before the failure; "
            "re-running the same file is safe because import is idempotent."
        )

    async def _process(self, stored: StoredUpload, report: ImportReport, sink: _IssueSink) -> None:
        stream = await asyncio.to_thread(self._store.open, stored.key)
        try:
            parser = CsvStream(
                stream, max_rows=self._settings.import_max_rows, batch_size=self._settings.import_batch_size
            )
            sink.add(await asyncio.to_thread(parser.open))
            categories: dict[str, int] = {}
            while (batch := await asyncio.to_thread(parser.next_batch)) is not None:
                sink.add(batch.issues)
                self._sync_stats(report, parser)
                if report.dry_run:
                    await self._plan_batch(batch.rows, report, sink)
                    await self._write_issues(report.run_id, sink.take())
                else:
                    await self._apply_batch(batch.rows, categories, report, sink)
            self._sync_stats(report, parser)
            report.unchanged = report.rows_valid - report.created - report.updated
        finally:
            await asyncio.to_thread(stream.close)

    def _sync_stats(self, report: ImportReport, parser: CsvStream) -> None:
        stats = parser.stats
        report.rows_total = stats.rows_total
        report.rows_invalid = stats.rows_invalid
        report.rows_valid = stats.rows_valid
        report.duplicates = stats.duplicates
        report.blank_rows = stats.blank_rows

    async def _plan_batch(self, rows: Sequence[ParsedRow], report: ImportReport, sink: _IssueSink) -> None:
        if not rows:
            return
        async with self._sessions() as session:
            await _use_custom_plans(session)
            existing = await self._load_existing(session, rows, lock=False)
            reserved = await active_reserved_quantities(session, [e.id for e in existing.values()])
        for row in rows:
            current = existing.get(row.sku)
            target = self._target_stock(row, current, reserved, sink)
            if current is None:
                report.created += 1
            elif _changed(row, current, target):
                report.updated += 1
                self._price_warning(row, current, sink)

    async def _apply_batch(
        self, rows: Sequence[ParsedRow], categories: dict[str, int], report: ImportReport, sink: _IssueSink
    ) -> None:
        async with self._sessions() as session, session.begin():
            await _use_custom_plans(session)
            created, updated = await self._upsert(session, rows, categories, report.run_id, sink)
            await self._insert_issues(session, report.run_id, sink.take())
        report.created += created
        report.updated += updated
        report.rows_applied += len(rows)

    async def _upsert(
        self,
        session: AsyncSession,
        rows: Sequence[ParsedRow],
        categories: dict[str, int],
        run_id: uuid.UUID,
        sink: _IssueSink,
    ) -> tuple[int, int]:
        if not rows:
            return 0, 0
        missing = {row.category for row in rows if category_key(row.category) not in categories}
        if missing:
            categories.update(await ensure_categories(session, missing))
        existing = await self._load_existing(session, rows, lock=True)
        reserved = await active_reserved_quantities(session, [e.id for e in existing.values()])
        values: list[dict[str, Any]] = []
        for row in rows:
            current = existing.get(row.sku)
            target = self._target_stock(row, current, reserved, sink)
            if current is not None and _changed(row, current, target):
                self._price_warning(row, current, sink)
            values.append(
                {
                    "sku": row.sku,
                    "name": row.name,
                    "description": row.description,
                    "category_id": categories[category_key(row.category)],
                    "price": row.price,
                    "stock": target,
                    "weight_kg": row.weight_kg,
                }
            )
        statement = pg_insert(Product).values(values)
        excluded = statement.excluded
        tracked = ("name", "description", "category_id", "price", "weight_kg", "stock")
        upsert = statement.on_conflict_do_update(
            index_elements=[Product.sku],
            index_where=Product.deleted_at.is_(None),
            set_={
                **{column: getattr(excluded, column) for column in tracked},
                "version": Product.version + 1,
                "updated_at": datetime.now(UTC),
            },
            where=tuple_(*(getattr(Product, c) for c in tracked)).is_distinct_from(
                tuple_(*(getattr(excluded, c) for c in tracked))
            ),
        ).returning(
            Product.id,
            Product.sku,
            Product.stock,
            literal_column("xmax = 0", Boolean).label("inserted"),
        )
        created = updated = 0
        movements: list[Movement] = []
        for product_id, sku, stock, inserted in (await session.execute(upsert)).all():
            previous = existing.get(sku)
            if inserted:
                created += 1
            else:
                updated += 1
            movements.append(
                Movement(
                    product_id=product_id,
                    sku=sku,
                    delta=stock - (previous.stock if previous else 0),
                    balance_after=stock,
                    reason=MovementReason.import_,
                    reference_type="import_run",
                    reference_id=str(run_id),
                )
            )
        await record_movements(session, movements)
        return created, updated

    async def _load_existing(
        self, session: AsyncSession, batch: Sequence[ParsedRow], *, lock: bool
    ) -> dict[str, _Existing]:
        stmt = (
            select(
                Product.id,
                Product.sku,
                Product.stock,
                Product.name,
                Product.description,
                Product.category_id,
                Product.price,
                Product.weight_kg,
            )
            .where(
                Product.sku == any_(cast([row.sku for row in batch], ARRAY(String))),
                Product.deleted_at.is_(None),
            )
            .order_by(Product.id)
        )
        if lock:
            stmt = stmt.with_for_update()
        rows = (await session.execute(stmt)).all()
        keys = await self._category_keys(session, {r.category_id for r in rows})
        return {
            r.sku: _Existing(
                id=r.id,
                stock=r.stock,
                name=r.name,
                description=r.description,
                category_key=keys[r.category_id],
                price=r.price,
                weight_kg=r.weight_kg,
            )
            for r in rows
        }

    async def _category_keys(self, session: AsyncSession, ids: set[int]) -> dict[int, str]:
        if not ids:
            return {}
        rows = await session.execute(select(Category.id, Category.name_key).where(Category.id.in_(ids)))
        return {category_id: key for category_id, key in rows.all()}

    def _target_stock(
        self, row: ParsedRow, current: _Existing | None, reserved: dict[int, int], sink: _IssueSink
    ) -> int:
        if current is None:
            return row.stock
        held = reserved.get(current.id, 0)
        if held == 0:
            return row.stock
        target = row.stock - held
        if target < 0:
            sink.add(
                [
                    Issue(
                        row.row,
                        Severity.warning,
                        f"CSV stock {row.stock} is below the {held} unit(s) reserved by in-flight checkouts; "
                        "sellable stock set to 0",
                        "stock",
                        str(row.stock),
                    )
                ]
            )
            return 0
        sink.add(
            [
                Issue(
                    row.row,
                    Severity.warning,
                    f"{held} unit(s) are reserved by in-flight checkouts; sellable stock set to {target}",
                    "stock",
                    str(row.stock),
                )
            ]
        )
        return target

    def _price_warning(self, row: ParsedRow, current: _Existing, sink: _IssueSink) -> None:
        if current.price <= 0 or row.price == current.price:
            return
        change = (row.price - current.price) / current.price
        if abs(change) >= Decimal(str(self._settings.import_price_change_warning_ratio)):
            sink.add(
                [
                    Issue(
                        row.row,
                        Severity.warning,
                        f"Price changes from {current.price} to {row.price} ({change:+.0%}); "
                        "please double-check",
                        "price",
                        str(row.price),
                    )
                ]
            )

    async def _write_issues(self, run_id: uuid.UUID, issues: list[Issue]) -> None:
        if not issues:
            return
        async with self._sessions() as session, session.begin():
            await self._insert_issues(session, run_id, issues)

    async def _insert_issues(self, session: AsyncSession, run_id: uuid.UUID, issues: list[Issue]) -> None:
        for start in range(0, len(issues), ISSUE_FLUSH_SIZE):
            chunk = issues[start : start + ISSUE_FLUSH_SIZE]
            await session.execute(
                insert(ImportIssue),
                [
                    {
                        "run_id": run_id,
                        "row": issue.row,
                        "severity": issue.severity.value,
                        "field": issue.field,
                        "value": _clip(issue.value),
                        "message": issue.message,
                    }
                    for issue in chunk
                ],
            )

    async def _save(
        self, report: ImportReport, source: str, stored_key: str, *, finished: bool = False
    ) -> None:
        async with self._sessions() as session, session.begin():
            await session.merge(
                ImportRun(
                    id=report.run_id,
                    filename=report.filename,
                    status=report.status.value,
                    dry_run=report.dry_run,
                    source=source,
                    rows_total=report.rows_total,
                    rows_valid=report.rows_valid,
                    rows_invalid=report.rows_invalid,
                    rows_applied=report.rows_applied,
                    created=report.created,
                    updated=report.updated,
                    unchanged=report.unchanged,
                    duplicates=report.duplicates,
                    blank_rows=report.blank_rows,
                    error_count=report.error_count,
                    warning_count=report.warning_count,
                    failure=report.failure,
                    stored_key=stored_key,
                    file_size=report.file_size,
                    file_sha256=report.file_sha256,
                    parent_run_id=report.parent_run_id,
                    finished_at=datetime.now(UTC) if finished else None,
                    duration_ms=report.duration_ms if finished else None,
                )
            )

    async def _finish(
        self, report: ImportReport, started: float, source: str, stored_key: str
    ) -> ImportReport:
        report.duration_ms = int((time.perf_counter() - started) * 1000)
        await self._save(report, source, stored_key, finished=True)
        async with self._sessions() as session:
            report.preview = await load_issue_preview(
                session, report.run_id, self._settings.import_preview_issues
            )
        logger.info(
            "import finished",
            extra={
                "run_id": str(report.run_id),
                "status": report.status.value,
                "dry_run": report.dry_run,
                "rows_total": report.rows_total,
                "rows_created": report.created,
                "rows_updated": report.updated,
                "rows_unchanged": report.unchanged,
                "errors": report.error_count,
                "warnings": report.warning_count,
                "duration_ms": report.duration_ms,
            },
        )
        return report


def issue_order() -> tuple[Any, ...]:
    return (ImportIssue.row.asc().nulls_first(), ImportIssue.id.asc())


async def load_issue_preview(session: AsyncSession, run_id: uuid.UUID, limit: int) -> list[Issue]:
    rows = await session.scalars(
        select(ImportIssue).where(ImportIssue.run_id == run_id).order_by(*issue_order()).limit(limit)
    )
    return [
        Issue(row=i.row, severity=Severity(i.severity), message=i.message, field=i.field, value=i.value)
        for i in rows.all()
    ]


def _clip(value: str | None) -> str | None:
    if value is None or len(value) <= ISSUE_VALUE_MAX:
        return value
    return value[: ISSUE_VALUE_MAX - 1] + "…"


async def _use_custom_plans(session: AsyncSession) -> None:
    await session.execute(select(func.set_config("plan_cache_mode", "force_custom_plan", True)))


def _changed(row: ParsedRow, current: _Existing, target_stock: int) -> bool:
    return (
        row.name != current.name
        or row.description != current.description
        or category_key(row.category) != current.category_key
        or row.price != current.price
        or row.weight_kg != current.weight_kg
        or target_stock != current.stock
    )
