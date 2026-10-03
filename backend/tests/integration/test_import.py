import csv
import io
from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest

from app.bootstrap import Container
from app.core.config import Settings
from app.importing.service import ImportService, ImportStatus
from app.inventory.service import ReservationLine
from app.orders.checkout import CheckoutCommand
from app.payments.provider import Card
from tests.conftest import APPROVE, Factory, checkout_body

HEADER = "name,sku,description,category,price,stock,weight_kg\n"
OFFICIAL = Path(__file__).resolve().parents[3] / "data" / "products.csv"


def upload(data: bytes, name: str = "products.csv") -> dict[str, tuple[str, bytes, str]]:
    return {"file": (name, data, "text/csv")}


async def test_dry_run_reports_plan_without_writing(client: httpx.AsyncClient, factory: Factory) -> None:
    data = (HEADER + "Lamp,L-1,,Home,10,5,1\nBad,,,,x,N/A,\n").encode()
    report = (await client.post("/api/imports?dry_run=true", files=upload(data))).json()
    assert report["status"] == "dry_run"
    assert (report["created"], report["rows_invalid"], report["error_count"]) == (1, 1, 3)
    assert await factory.scalar("SELECT count(*) FROM products") == 0
    assert await factory.scalar("SELECT count(*) FROM import_runs WHERE dry_run") == 1


async def test_import_creates_then_upserts_by_sku(client: httpx.AsyncClient, factory: Factory) -> None:
    first = (HEADER + "Lamp,L-1,Warm,Home,10,5,1\nChair,C-1,,Home,50,2,7\n").encode()
    report = (await client.post("/api/imports?dry_run=false", files=upload(first))).json()
    assert (report["created"], report["updated"], report["unchanged"]) == (2, 0, 0)

    second = (
        HEADER + "Lamp,l-1,Warm,home,12,5,1\nChair,C-1,,Home,50,2,7\nDesk,D-1,,Office,100,1,20\n"
    ).encode()
    report = (await client.post("/api/imports?dry_run=false", files=upload(second))).json()
    assert (report["created"], report["updated"], report["unchanged"]) == (1, 1, 1)
    assert await factory.scalar("SELECT count(*) FROM products") == 3
    assert await factory.scalar("SELECT price FROM products WHERE sku = 'L-1'") == 12
    assert await factory.scalar("SELECT version FROM products WHERE sku = 'L-1'") == 2
    assert await factory.scalar("SELECT version FROM products WHERE sku = 'C-1'") == 1


async def test_import_stock_changes_are_journaled(client: httpx.AsyncClient, factory: Factory) -> None:
    await client.post(
        "/api/imports?dry_run=false", files=upload((HEADER + "Lamp,L-1,,Home,10,5,1\n").encode())
    )
    await client.post(
        "/api/imports?dry_run=false", files=upload((HEADER + "Lamp,L-1,,Home,10,8,1\n").encode())
    )
    rows = await factory.scalar(
        "SELECT string_agg(delta::text || ':' || balance_after::text || ':' || reason, ',' ORDER BY id) "
        "FROM stock_movements"
    )
    assert rows == "5:5:import,3:8:import"


async def test_reserved_units_are_subtracted_from_imported_stock(
    client: httpx.AsyncClient, factory: Factory, container: Container
) -> None:
    await client.post(
        "/api/imports?dry_run=false", files=upload((HEADER + "Lamp,L-1,,Home,10,5,1\n").encode())
    )
    product_id = await factory.scalar("SELECT id FROM products WHERE sku = 'L-1'")
    await container.checkout.reserve(
        CheckoutCommand(
            "pending-order-1", "a@b.co", [ReservationLine(product_id, 2)], Card(APPROVE, 12, 2035, "123")
        ),
        "fp",
    )
    report = (
        await client.post(
            "/api/imports?dry_run=false", files=upload((HEADER + "Lamp,L-1,,Home,10,10,1\n").encode())
        )
    ).json()
    assert any("reserved by in-flight checkouts" in i["message"] for i in report["issues"])
    assert await factory.stock(product_id) == 8


async def test_large_price_swings_are_flagged(client: httpx.AsyncClient) -> None:
    await client.post(
        "/api/imports?dry_run=false", files=upload((HEADER + "Lamp,L-1,,Home,10,5,1\n").encode())
    )
    report = (
        await client.post(
            "/api/imports?dry_run=true", files=upload((HEADER + "Lamp,L-1,,Home,100,5,1\n").encode())
        )
    ).json()
    assert any("+900%" in i["message"] for i in report["issues"])


async def test_structurally_invalid_file_is_rejected_with_422(client: httpx.AsyncClient) -> None:
    response = await client.post("/api/imports?dry_run=false", files=upload(b"name,sku\nA,B\n"))
    assert response.status_code == 422
    assert response.json()["status"] == ImportStatus.rejected
    assert "Missing required column" in response.json()["failure"]


async def test_non_csv_upload_is_rejected(client: httpx.AsyncClient) -> None:
    response = await client.post("/api/imports", files={"file": ("image.png", b"\x89PNG", "image/png")})
    assert response.status_code == 422


async def test_issue_report_download_is_csv_injection_safe(client: httpx.AsyncClient) -> None:
    data = (HEADER + "=cmd|calc,X-1,,Home,@SUM(1),+5,-1\n").encode()
    report = (await client.post("/api/imports?dry_run=true", files=upload(data))).json()
    response = await client.get(f"/api/imports/{report['run_id']}/issues.csv")
    assert response.headers["content-type"].startswith("text/csv")
    rows = list(csv.reader(io.StringIO(response.text)))
    values = [row[3] for row in rows[1:] if row[3]]
    assert values
    assert all(not v.startswith(("=", "+", "-", "@")) for v in values)


async def test_run_history_endpoints(client: httpx.AsyncClient) -> None:
    report = (
        await client.post("/api/imports?dry_run=true", files=upload((HEADER + "A,A-1,,X,1,1,1\n").encode()))
    ).json()
    runs = (await client.get("/api/imports")).json()
    assert runs[0]["id"] == report["run_id"]
    detail = (await client.get(f"/api/imports/{report['run_id']}")).json()
    assert detail["rows_total"] == 1
    assert (await client.get("/api/imports/00000000-0000-0000-0000-000000000000")).status_code == 404


async def test_large_import_is_batched_and_fast_enough(client: httpx.AsyncClient, factory: Factory) -> None:
    lines = [HEADER.strip()] + [
        f"Item {i},BULK-{i:05d},,Bulk,{i % 500 + 1}.99,{i % 50},0.5" for i in range(5000)
    ]
    report = (
        await client.post("/api/imports?dry_run=false", files=upload(("\n".join(lines) + "\n").encode()))
    ).json()
    assert report["created"] == 5000
    assert await factory.scalar("SELECT count(*) FROM stock_movements WHERE reason = 'import'") == 5000 - 100
    response = await client.post(
        "/api/orders", json=checkout_body([(1, 1)]), headers={"Idempotency-Key": "bulk-0001"}
    )
    assert response.status_code in {201, 409}


async def test_failure_mid_import_is_reported_and_rerun_converges(
    client: httpx.AsyncClient, factory: Factory, container: Container, monkeypatch: pytest.MonkeyPatch
) -> None:
    lines = [HEADER.strip()] + [f"Item {i},MID-{i:03d},,Bulk,1.00,{i % 9},0.5" for i in range(120)]
    data = ("\n".join(lines) + "\n").encode()
    original = ImportService._apply_batch
    calls = {"n": 0}

    async def flaky(self: ImportService, *args: object, **kwargs: object) -> tuple[int, int]:
        calls["n"] += 1
        if calls["n"] == 2:
            raise ConnectionError("database connection lost")
        return await original(self, *args, **kwargs)

    monkeypatch.setattr(ImportService, "_apply_batch", flaky)
    report = (await client.post("/api/imports?dry_run=false", files=upload(data))).json()
    assert report["status"] == "failed"
    assert "The first 50 valid rows were applied" in report["failure"]
    assert await factory.scalar("SELECT count(*) FROM products") == 50
    assert (
        await factory.scalar("SELECT status FROM import_runs WHERE id = :id", id=report["run_id"]) == "failed"
    )

    monkeypatch.setattr(ImportService, "_apply_batch", original)
    rerun = (await client.post("/api/imports?dry_run=false", files=upload(data))).json()
    assert (rerun["status"], rerun["created"], rerun["unchanged"]) == ("completed", 70, 50)
    assert (await client.get("/api/admin/invariants")).json()["passed"]
    orphans = await factory.scalar(
        "SELECT count(*) FROM stock_movements m LEFT JOIN import_runs r ON r.id::text = m.reference_id "
        "WHERE m.reference_type = 'import_run' AND r.id IS NULL"
    )
    assert orphans == 0


async def test_large_report_returns_a_preview_and_streams_every_issue(client: httpx.AsyncClient) -> None:
    lines = [HEADER.strip()]
    for i in range(1500):
        lines.append(f"Item {i},BAD-{i:05d},,X,not-a-price,{i},1")
    lines.extend(f"Item {i},OK-{i:05d},,X,1.00,12 units,1" for i in range(700))
    report = (
        await client.post("/api/imports?dry_run=true", files=upload(("\n".join(lines) + "\n").encode()))
    ).json()
    assert (report["error_count"], report["warning_count"], report["issues_total"]) == (1500, 700, 2200)
    assert report["issues_truncated"] is True
    assert len(report["issues"]) == report["preview_limit"] == 1000
    assert report["issues_report_url"] == f"/api/imports/{report['run_id']}/issues.csv"

    async with client.stream("GET", report["issues_report_url"]) as response:
        assert response.headers["content-type"].startswith("text/csv")
        body = "".join([chunk async for chunk in response.aiter_text()])
    rows = list(csv.reader(io.StringIO(body)))
    assert rows[0] == ["row", "severity", "field", "value", "message"]
    assert len(rows) == 2201
    assert [int(r[0]) for r in rows[1:]] == sorted(int(r[0]) for r in rows[1:])

    errors_only = (await client.get(f"{report['issues_report_url']}?severity=error")).text
    assert len(list(csv.reader(io.StringIO(errors_only)))) == 1501
    assert (
        "attachment"
        in (await client.get(f"{report['issues_report_url']}?severity=warning")).headers[
            "content-disposition"
        ]
    )


async def test_small_report_is_returned_in_full(client: httpx.AsyncClient) -> None:
    report = (
        await client.post("/api/imports", files=upload((HEADER + "A,A-1,,X,abc,1,1\n").encode()))
    ).json()
    assert (report["issues_truncated"], len(report["issues"]), report["issues_total"]) == (False, 1, 1)


async def test_dry_run_then_apply_uses_the_stored_file(client: httpx.AsyncClient, factory: Factory) -> None:
    data = (HEADER + "Lamp,L-1,,Home,10,5,1\nChair,C-1,,Home,50,2,7\nBad,,,,x,1,1\n").encode()
    dry = (await client.post("/api/imports?dry_run=true", files=upload(data))).json()
    assert dry["can_apply"] is True
    assert dry["file_size"] == len(data)
    assert len(dry["file_sha256"]) == 64
    assert await factory.scalar("SELECT count(*) FROM products") == 0

    applied = (await client.post(f"/api/imports/{dry['run_id']}/apply")).json()
    assert (applied["status"], applied["created"], applied["rows_invalid"]) == ("completed", 2, 1)
    assert applied["parent_run_id"] == dry["run_id"]
    assert applied["file_sha256"] == dry["file_sha256"]
    assert await factory.scalar("SELECT count(*) FROM products") == 2

    again = await client.post(f"/api/imports/{dry['run_id']}/apply")
    assert again.status_code == 409
    assert again.json()["type"].endswith("/import-not-applicable")
    detail = (await client.get(f"/api/imports/{dry['run_id']}")).json()
    assert (detail["applied_run_id"], detail["can_apply"]) == (applied["run_id"], False)
    assert (await client.post(f"/api/imports/{applied['run_id']}/apply")).status_code == 409
    missing = await client.post("/api/imports/00000000-0000-0000-0000-000000000000/apply")
    assert missing.status_code == 404


async def test_apply_is_refused_when_the_stored_file_expired(
    client: httpx.AsyncClient, factory: Factory
) -> None:
    dry = (
        await client.post(
            "/api/imports?dry_run=true", files=upload((HEADER + "Lamp,L-1,,Home,10,5,1\n").encode())
        )
    ).json()
    key = await factory.scalar("SELECT stored_key FROM import_runs WHERE id = :id", id=dry["run_id"])
    from tests.conftest import STORAGE

    (STORAGE.root / key).unlink()
    response = await client.post(f"/api/imports/{dry['run_id']}/apply")
    assert response.status_code == 409
    assert "upload it again" in response.json()["detail"]


async def test_failed_apply_can_be_retried(
    client: httpx.AsyncClient, factory: Factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    data = (HEADER + "Lamp,L-1,,Home,10,5,1\n").encode()
    dry = (await client.post("/api/imports?dry_run=true", files=upload(data))).json()
    original = ImportService._apply_batch

    async def broken(self: ImportService, *args: object, **kwargs: object) -> None:
        raise ConnectionError("database connection lost")

    monkeypatch.setattr(ImportService, "_apply_batch", broken)
    failed = await client.post(f"/api/imports/{dry['run_id']}/apply")
    assert failed.json()["status"] == "failed"
    monkeypatch.setattr(ImportService, "_apply_batch", original)
    retried = (await client.post(f"/api/imports/{dry['run_id']}/apply")).json()
    assert (retried["status"], retried["created"]) == ("completed", 1)


async def test_upload_over_the_limit_is_rejected_before_the_body_is_read(client: httpx.AsyncClient) -> None:
    from app.main import MULTIPART_OVERHEAD_BYTES

    declared = 200 * 1024 * 1024 + MULTIPART_OVERHEAD_BYTES + 1
    response = await client.post(
        "/api/imports",
        content=b"x",
        headers={"content-length": str(declared), "content-type": "multipart/form-data; boundary=x"},
    )
    assert response.status_code == 413
    assert response.headers["content-type"] == "application/problem+json"
    assert response.json()["type"].endswith("/payload-too-large")


async def test_streamed_upload_without_length_is_cut_off_at_the_limit(
    settings: Settings, container: Container
) -> None:
    from app.main import create_app

    small = settings.model_copy(update={"import_max_bytes": 1024})
    app = create_app(small, container)
    app.state.container = container

    async def body() -> AsyncIterator[bytes]:
        yield b'--x\r\nContent-Disposition: form-data; name="file"; filename="big.csv"\r\n'
        yield b"Content-Type: text/csv\r\n\r\n"
        for _ in range(200):
            yield b"a" * 1024

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as http:
        response = await http.post(
            "/api/imports", content=body(), headers={"content-type": "multipart/form-data; boundary=x"}
        )
    assert response.status_code == 413


async def test_one_shot_import_still_works_and_records_its_file(client: httpx.AsyncClient) -> None:
    report = (
        await client.post(
            "/api/imports?dry_run=false", files=upload((HEADER + "Lamp,L-1,,Home,10,5,1\n").encode())
        )
    ).json()
    assert (report["status"], report["created"], report["can_apply"]) == ("completed", 1, False)
    runs = (await client.get("/api/imports")).json()
    assert runs[0]["file_size"] > 0


async def test_official_example_file_end_to_end(client: httpx.AsyncClient, factory: Factory) -> None:
    report = (
        await client.post("/api/imports?dry_run=false", files=upload(OFFICIAL.read_bytes(), "products.csv"))
    ).json()
    assert report["status"] == "completed"
    assert (
        report["rows_total"],
        report["rows_valid"],
        report["rows_invalid"],
        report["duplicates"],
        report["blank_rows"],
    ) == (95, 88, 7, 3, 2)
    assert (report["created"], report["updated"], report["unchanged"]) == (87, 0, 1)
    assert (report["error_count"], report["warning_count"]) == (7, 6)
    errors_by_row = {i["row"] for i in report["issues"] if i["severity"] == "error"}
    warnings_by_row = {i["row"] for i in report["issues"] if i["severity"] == "warning"}
    assert errors_by_row == {7, 16, 20, 25, 36, 41, 56}
    assert warnings_by_row == {47, 50, 52, 89}

    async def value(sql: str) -> object:
        return await factory.scalar(sql)

    assert await value("SELECT count(*) FROM products") == 87
    assert (
        await value("SELECT name FROM products WHERE sku = 'SQL-001'") == "Robert'); DROP TABLE products;--"
    )
    assert await value("SELECT count(*) FROM products WHERE sku = 'XS-001'") == 0
    assert await value("SELECT price::text FROM products WHERE sku = 'WM-042'") == "29.99"
    assert await value("SELECT name FROM products WHERE sku = 'QI-001'") == 'Quote "Inside" Name'
    assert await value("SELECT name FROM products WHERE sku = 'CI-001'") == "Comma, In Product Name"
    assert await value("SELECT price::text FROM products WHERE sku = 'RS-001'") == "89.99"
    assert await value("SELECT stock FROM products WHERE sku = 'GC-025'") == 99999
    assert await value("SELECT weight_kg FROM products WHERE sku = 'GK-088'") is None
    assert await value("SELECT stock FROM products WHERE sku = 'VC-001'") == 0
    assert (await client.get("/api/admin/invariants")).json()["passed"]
