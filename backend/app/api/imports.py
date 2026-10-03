import csv
import io
import uuid
from collections.abc import AsyncIterator
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, File, Query, UploadFile, status
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import ContainerDep, SessionDep
from app.bootstrap import Container
from app.core.errors import InvalidRequestError, NotFoundError
from app.importing.models import ImportIssue, ImportRun
from app.importing.parsing import Severity
from app.importing.service import ImportReport, ImportStatus, issue_order, load_issue_preview

router = APIRouter(prefix="/api/imports", tags=["imports"])

ACCEPTED_TYPES = {
    "text/csv",
    "application/csv",
    "application/vnd.ms-excel",
    "text/plain",
    "application/octet-stream",
    "",
}
FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")
DOWNLOAD_BATCH = 2000


class IssueOut(BaseModel):
    row: int | None
    severity: str
    field: str | None
    value: str | None
    message: str


class ImportRunOut(BaseModel):
    id: uuid.UUID
    filename: str
    status: str
    dry_run: bool
    source: str
    rows_total: int
    rows_valid: int
    rows_invalid: int
    rows_applied: int
    created: int
    updated: int
    unchanged: int
    duplicates: int
    blank_rows: int
    error_count: int
    warning_count: int
    issues_total: int
    failure: str | None
    file_size: int | None
    file_sha256: str | None
    parent_run_id: uuid.UUID | None
    applied_run_id: uuid.UUID | None
    can_apply: bool
    started_at: datetime
    duration_ms: int | None


class ImportRunDetail(ImportRunOut):
    issues: list[IssueOut]
    issues_truncated: bool
    preview_limit: int
    issues_report_url: str


class ImportReportOut(BaseModel):
    run_id: uuid.UUID
    filename: str
    status: str
    dry_run: bool
    parent_run_id: uuid.UUID | None
    file_size: int | None
    file_sha256: str | None
    rows_total: int
    rows_valid: int
    rows_invalid: int
    rows_applied: int
    created: int
    updated: int
    unchanged: int
    duplicates: int
    blank_rows: int
    error_count: int
    warning_count: int
    issues_total: int
    duration_ms: int
    failure: str | None
    can_apply: bool
    issues: list[IssueOut]
    issues_truncated: bool
    preview_limit: int
    issues_report_url: str


def _report_url(run_id: uuid.UUID) -> str:
    return f"/api/imports/{run_id}/issues.csv"


def _report_out(report: ImportReport, preview_limit: int, can_apply: bool) -> ImportReportOut:
    return ImportReportOut(
        run_id=report.run_id,
        filename=report.filename,
        status=report.status.value,
        dry_run=report.dry_run,
        parent_run_id=report.parent_run_id,
        file_size=report.file_size,
        file_sha256=report.file_sha256,
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
        issues_total=report.issues_total,
        duration_ms=report.duration_ms,
        failure=report.failure,
        can_apply=can_apply,
        issues=[IssueOut.model_validate(i.as_dict()) for i in report.preview],
        issues_truncated=report.issues_total > preview_limit,
        preview_limit=preview_limit,
        issues_report_url=_report_url(report.run_id),
    )


async def _respond(
    report: ImportReport, container: Container, session: AsyncSession
) -> ImportReportOut | JSONResponse:
    can_apply = False
    if report.status is ImportStatus.dry_run:
        run = await session.get(ImportRun, report.run_id)
        can_apply = run is not None and await container.importer.can_apply(session, run)
    body = _report_out(report, container.settings.import_preview_issues, can_apply)
    if report.status in {ImportStatus.rejected, ImportStatus.failed}:
        return JSONResponse(body.model_dump(mode="json"), status_code=status.HTTP_422_UNPROCESSABLE_CONTENT)
    return body


@router.post(
    "",
    response_model=ImportReportOut,
    responses={
        status.HTTP_413_CONTENT_TOO_LARGE: {"description": "File exceeds the upload limit"},
        status.HTTP_422_UNPROCESSABLE_CONTENT: {"model": ImportReportOut},
    },
)
async def upload_csv(
    container: ContainerDep,
    session: SessionDep,
    file: Annotated[
        UploadFile, File(description="CSV with name, sku, description, category, price, stock, weight_kg")
    ],
    dry_run: Annotated[bool, Query()] = True,
) -> ImportReportOut | JSONResponse:
    filename = file.filename or "upload.csv"
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if content_type not in ACCEPTED_TYPES and not filename.lower().endswith((".csv", ".txt")):
        raise InvalidRequestError(f"Expected a CSV file, got {content_type or 'unknown type'}")
    stored = await container.importer.store_upload(file.file, filename)
    report = await container.importer.run(stored, dry_run=dry_run, source="api")
    return await _respond(report, container, session)


@router.post(
    "/{run_id}/apply",
    response_model=ImportReportOut,
    responses={
        status.HTTP_404_NOT_FOUND: {"description": "Unknown run"},
        status.HTTP_409_CONFLICT: {"description": "Not an un-applied dry run, or its file expired"},
        status.HTTP_422_UNPROCESSABLE_CONTENT: {"model": ImportReportOut},
    },
)
async def apply_dry_run(
    run_id: uuid.UUID, container: ContainerDep, session: SessionDep
) -> ImportReportOut | JSONResponse:
    report = await container.importer.apply(run_id)
    return await _respond(report, container, session)


async def _run_out(run: ImportRun, container: Container, session: AsyncSession) -> dict[str, object]:
    return {
        "id": run.id,
        "filename": run.filename,
        "status": run.status,
        "dry_run": run.dry_run,
        "source": run.source,
        "rows_total": run.rows_total,
        "rows_valid": run.rows_valid,
        "rows_invalid": run.rows_invalid,
        "rows_applied": run.rows_applied,
        "created": run.created,
        "updated": run.updated,
        "unchanged": run.unchanged,
        "duplicates": run.duplicates,
        "blank_rows": run.blank_rows,
        "error_count": run.error_count,
        "warning_count": run.warning_count,
        "issues_total": run.error_count + run.warning_count,
        "failure": run.failure,
        "file_size": run.file_size,
        "file_sha256": run.file_sha256,
        "parent_run_id": run.parent_run_id,
        "applied_run_id": run.applied_run_id,
        "can_apply": await container.importer.can_apply(session, run),
        "started_at": run.started_at,
        "duration_ms": run.duration_ms,
    }


@router.get("", response_model=list[ImportRunOut])
async def list_runs(
    session: SessionDep, container: ContainerDep, limit: Annotated[int, Query(ge=1, le=100)] = 20
) -> list[ImportRunOut]:
    runs = (await session.scalars(select(ImportRun).order_by(ImportRun.started_at.desc()).limit(limit))).all()
    return [ImportRunOut.model_validate(await _run_out(r, container, session)) for r in runs]


async def _get_run(session: AsyncSession, run_id: uuid.UUID) -> ImportRun:
    run = await session.get(ImportRun, run_id)
    if run is None:
        raise NotFoundError(f"Import run {run_id} does not exist")
    return run


@router.get("/{run_id}", response_model=ImportRunDetail)
async def get_run(run_id: uuid.UUID, session: SessionDep, container: ContainerDep) -> ImportRunDetail:
    run = await _get_run(session, run_id)
    limit = container.settings.import_preview_issues
    preview = await load_issue_preview(session, run_id, limit)
    return ImportRunDetail.model_validate(
        {
            **await _run_out(run, container, session),
            "issues": [i.as_dict() for i in preview],
            "issues_truncated": run.error_count + run.warning_count > limit,
            "preview_limit": limit,
            "issues_report_url": _report_url(run_id),
        }
    )


def _safe_cell(value: object) -> str:
    text = "" if value is None else str(value)
    return f"'{text}" if text.startswith(FORMULA_PREFIXES) else text


def _csv_lines(rows: list[list[object]]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    for row in rows:
        writer.writerow([_safe_cell(cell) for cell in row])
    return buffer.getvalue()


@router.get("/{run_id}/issues.csv", response_class=StreamingResponse)
async def download_issues(
    run_id: uuid.UUID,
    session: SessionDep,
    container: ContainerDep,
    severity: Annotated[Severity | None, Query()] = None,
) -> StreamingResponse:
    await _get_run(session, run_id)
    conditions = [ImportIssue.run_id == run_id]
    if severity is not None:
        conditions.append(ImportIssue.severity == severity.value)
    statement = (
        select(
            ImportIssue.row, ImportIssue.severity, ImportIssue.field, ImportIssue.value, ImportIssue.message
        )
        .where(*conditions)
        .order_by(*issue_order())
        .execution_options(yield_per=DOWNLOAD_BATCH)
    )

    async def body() -> AsyncIterator[str]:
        yield _csv_lines([["row", "severity", "field", "value", "message"]])
        async with container.db.sessions() as stream_session:
            result = await stream_session.stream(statement)
            async for partition in result.partitions(DOWNLOAD_BATCH):
                yield _csv_lines([list(row) for row in partition])

    suffix = f"-{severity.value}s" if severity else ""
    return StreamingResponse(
        body(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="import-{run_id}-issues{suffix}.csv"'},
    )
