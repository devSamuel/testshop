import argparse
import asyncio
import json
import random
import sys
from decimal import Decimal
from pathlib import Path

from sqlalchemy import func, select

from app.bootstrap import Container, build_container
from app.catalog.models import Product
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.importing.service import ImportReport, ImportStatus

ADJECTIVES = [
    "Wireless",
    "Ergonomic",
    "Compact",
    "Premium",
    "Rugged",
    "Smart",
    "Portable",
    "Classic",
    "Ultra",
    "Eco",
]
NOUNS = [
    "Headphones",
    "Keyboard",
    "Mouse",
    "Backpack",
    "Lamp",
    "Speaker",
    "Monitor",
    "Charger",
    "Bottle",
    "Chair",
    "Notebook",
    "Jacket",
    "Sneakers",
    "Blender",
    "Kettle",
    "Drill",
    "Tent",
    "Watch",
    "Camera",
    "Router",
]
CATEGORIES = ["Electronics", "Home", "Office", "Outdoors", "Apparel", "Kitchen", "Tools", "Sports"]


def _summary(report: ImportReport) -> dict[str, object]:
    return {
        "run_id": str(report.run_id),
        "status": report.status.value,
        "dry_run": report.dry_run,
        "rows_total": report.rows_total,
        "rows_invalid": report.rows_invalid,
        "created": report.created,
        "updated": report.updated,
        "unchanged": report.unchanged,
        "errors": report.error_count,
        "warnings": report.warning_count,
        "duplicates": report.duplicates,
        "duration_ms": report.duration_ms,
        "failure": report.failure,
    }


async def import_file(container: Container, path: Path, dry_run: bool) -> int:
    with path.open("rb") as source:
        stored = await container.importer.store_upload(source, path.name)
    report = await container.importer.run(stored, dry_run=dry_run, source="cli")
    print(json.dumps(_summary(report), indent=2))
    for issue in report.preview[:20]:
        print(f"  row {issue.row}: [{issue.severity}] {issue.field or '-'}: {issue.message}")
    if report.issues_total > 20:
        print(
            f"  ... {report.issues_total - 20} more issue(s); see GET /api/imports/{report.run_id}/issues.csv"
        )
    return 1 if report.status in {ImportStatus.rejected, ImportStatus.failed} else 0


async def seed_if_empty(container: Container) -> int:
    async with container.db.sessions() as session:
        count = await session.scalar(select(func.count()).select_from(Product)) or 0
    if count:
        print(f"seed skipped: catalog already has {count} product(s)")
        return 0
    seed_file = container.settings.seed_file
    if not seed_file.is_file():
        print(f"seed skipped: {seed_file} not found")
        return 0
    print(f"seeding catalog from {seed_file}")
    return await import_file(container, seed_file, dry_run=False)


async def seed_large(container: Container, count: int, seed: int) -> int:
    rng = random.Random(seed)
    lines = ["sku,name,description,category,price,stock,weight_kg"]
    for index in range(count):
        adjective, noun = rng.choice(ADJECTIVES), rng.choice(NOUNS)
        lines.append(
            ",".join(
                [
                    f"BENCH-{index:07d}",
                    f"{adjective} {noun} {index}",
                    f"{adjective} {noun.lower()} for everyday use model {rng.randint(100, 999)}",
                    rng.choice(CATEGORIES),
                    str(Decimal(rng.randint(199, 99999)) / 100),
                    str(rng.randint(0, 500)),
                    str(Decimal(rng.randint(50, 20000)) / 1000),
                ]
            )
        )
    data = ("\n".join(lines) + "\n").encode()
    report = await container.importer.import_bytes(
        f"seed-large-{count}.csv", data, dry_run=False, source="cli"
    )
    print(json.dumps(_summary(report), indent=2))
    return 0 if report.status is ImportStatus.completed else 1


async def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    commands = parser.add_subparsers(dest="command", required=True)
    importer = commands.add_parser("import", help="Import a products CSV")
    importer.add_argument("path", type=Path)
    importer.add_argument("--dry-run", action="store_true")
    commands.add_parser("seed-if-empty", help="Import the seed CSV when the catalog is empty")
    large = commands.add_parser("seed-large", help="Generate and import a large synthetic catalog")
    large.add_argument("--count", type=int, default=100_000)
    large.add_argument("--seed", type=int, default=42)
    args = parser.parse_args(argv)

    settings = get_settings()
    configure_logging("WARNING")
    container = build_container(settings)
    try:
        if args.command == "import":
            return await import_file(container, args.path, args.dry_run)
        if args.command == "seed-if-empty":
            if not settings.seed_on_startup:
                print("seed skipped: SEED_ON_STARTUP is false")
                return 0
            return await seed_if_empty(container)
        return await seed_large(container, args.count, args.seed)
    finally:
        await container.db.dispose()


if __name__ == "__main__":
    sys.exit(asyncio.run(main(sys.argv[1:])))
