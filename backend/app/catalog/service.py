import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import ColumnElement, case, func, literal, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.catalog.models import Category, Product
from app.catalog.normalize import UNCATEGORIZED, category_display, category_key
from app.catalog.schemas import CategoryOut, SearchParams, SortOrder
from app.core.errors import DuplicateSkuError, NotFoundError, StaleVersionError

_TOKEN = re.compile(r"[\w]+", re.UNICODE)
WORD_SIMILARITY_THRESHOLD = 0.45
FUZZY_FALLBACK_THRESHOLD = 0.3


@dataclass(frozen=True, slots=True)
class ProductFields:
    sku: str
    name: str
    description: str
    category: str
    price: Decimal
    weight_kg: Decimal | None


async def ensure_categories(session: AsyncSession, names: Iterable[str]) -> dict[str, int]:
    displays: dict[str, str] = {}
    for raw in names:
        display = category_display(raw) if raw else UNCATEGORIZED
        displays.setdefault(category_key(display), display)
    if not displays:
        return {}
    await session.execute(
        pg_insert(Category)
        .values([{"name": name, "name_key": key} for key, name in displays.items()])
        .on_conflict_do_nothing(index_elements=[Category.name_key])
    )
    rows = await session.execute(
        select(Category.name_key, Category.id).where(Category.name_key.in_(list(displays)))
    )
    return {key: category_id for key, category_id in rows.all()}


async def ensure_category(session: AsyncSession, name: str) -> int:
    ids = await ensure_categories(session, [name])
    return next(iter(ids.values()))


async def get_product(session: AsyncSession, product_id: int, *, for_update: bool = False) -> Product:
    stmt = (
        select(Product)
        .where(Product.id == product_id, Product.deleted_at.is_(None))
        .execution_options(populate_existing=True)
    )
    if for_update:
        stmt = stmt.with_for_update(of=Product)
    product = await session.scalar(stmt)
    if product is None:
        raise NotFoundError(f"Product {product_id} does not exist", product_id=product_id)
    return product


async def create_product(session: AsyncSession, fields: ProductFields) -> Product:
    category_id = await ensure_category(session, fields.category)
    product = Product(
        sku=fields.sku,
        name=fields.name,
        description=fields.description,
        category_id=category_id,
        price=fields.price,
        weight_kg=fields.weight_kg,
        stock=0,
    )
    try:
        async with session.begin_nested():
            session.add(product)
            await session.flush()
    except IntegrityError as exc:
        if "uq_products_sku_active" in str(exc.orig):
            raise DuplicateSkuError(f"SKU {fields.sku} already exists", sku=fields.sku) from exc
        raise
    await session.refresh(product, attribute_names=["category"])
    return product


async def update_product(
    session: AsyncSession, product_id: int, expected_version: int, changes: dict[str, Any]
) -> Product:
    product = await get_product(session, product_id, for_update=True)
    if product.version != expected_version:
        raise StaleVersionError(
            "Product was changed since you loaded it; reload and retry",
            current_version=product.version,
            your_version=expected_version,
        )
    if "category" in changes:
        product.category_id = await ensure_category(session, changes.pop("category"))
    for field, value in changes.items():
        setattr(product, field, value)
    product.version += 1
    try:
        async with session.begin_nested():
            await session.flush()
    except IntegrityError as exc:
        if "uq_products_sku_active" in str(exc.orig):
            raise DuplicateSkuError(
                f"SKU {changes.get('sku')} already exists", sku=changes.get("sku")
            ) from exc
        raise
    await session.refresh(product, attribute_names=["category"])
    return product


async def soft_delete_product(session: AsyncSession, product_id: int, expected_version: int) -> None:
    product = await get_product(session, product_id, for_update=True)
    if product.version != expected_version:
        raise StaleVersionError(
            "Product was changed since you loaded it; reload and retry",
            current_version=product.version,
            your_version=expected_version,
        )
    product.deleted_at = datetime.now(UTC)
    product.version += 1
    await session.flush()


def _prefix_tsquery(q: str) -> str | None:
    tokens = [t.lower() for t in _TOKEN.findall(q)][:8]
    if not tokens:
        return None
    return " & ".join(f"{token}:*" for token in tokens)


@dataclass(frozen=True, slots=True)
class SearchResult:
    items: list[Product]
    total: int
    fuzzy: bool


async def search_products(session: AsyncSession, params: SearchParams) -> SearchResult:
    items, total = await _search(session, params, WORD_SIMILARITY_THRESHOLD)
    if total == 0 and (params.q or "").strip():
        items, total = await _search(session, params, FUZZY_FALLBACK_THRESHOLD)
        return SearchResult(items, total, fuzzy=total > 0)
    return SearchResult(items, total, fuzzy=False)


async def _search(session: AsyncSession, params: SearchParams, threshold: float) -> tuple[list[Product], int]:
    conditions: list[ColumnElement[bool]] = [Product.deleted_at.is_(None)]
    score: ColumnElement[Any] = literal(0)
    q = (params.q or "").strip()

    if q:
        await session.execute(
            select(func.set_config("pg_trgm.word_similarity_threshold", str(threshold), True))
        )
        tsquery_text = _prefix_tsquery(q)
        matchers: list[ColumnElement[bool]] = [
            Product.sku.ilike(f"{_escape_like(q)}%"),
            literal(q).op("<%")(Product.name),
        ]
        rank: ColumnElement[Any] = literal(0)
        if tsquery_text:
            tsquery = func.to_tsquery("english", tsquery_text)
            matchers.append(Product.search_vector.op("@@")(tsquery))
            rank = func.ts_rank_cd(Product.search_vector, tsquery)
        conditions.append(or_(*matchers))
        score = (
            case((func.upper(Product.sku) == q.upper(), 100), else_=0)
            + rank * 10
            + func.word_similarity(q, Product.name) * 5
        )

    if params.category:
        conditions.append(Category.name_key == category_key(params.category))
    if params.min_price is not None:
        conditions.append(Product.price >= params.min_price)
    if params.max_price is not None:
        conditions.append(Product.price <= params.max_price)
    if params.in_stock:
        conditions.append(Product.stock > 0)

    sort = params.sort or (SortOrder.relevance if q else SortOrder.name)
    order_by: Sequence[ColumnElement[Any]] = {
        SortOrder.relevance: [score.desc(), Product.name.asc()],
        SortOrder.name: [Product.name.asc()],
        SortOrder.price_asc: [Product.price.asc()],
        SortOrder.price_desc: [Product.price.desc()],
        SortOrder.newest: [Product.created_at.desc()],
    }[sort]

    stmt = (
        select(Product, func.count().over().label("total"))
        .join(Product.category)
        .where(*conditions)
        .order_by(*order_by, Product.id.asc())
        .limit(params.page_size)
        .offset((params.page - 1) * params.page_size)
    )
    rows = (await session.execute(stmt)).unique().all()
    if not rows and params.page > 1:
        count_stmt = select(func.count()).select_from(Product).join(Product.category).where(*conditions)
        return [], int(await session.scalar(count_stmt) or 0)
    total = int(rows[0].total) if rows else 0
    return [row.Product for row in rows], total


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def list_categories(session: AsyncSession) -> list[CategoryOut]:
    count = func.count(Product.id).filter(Product.deleted_at.is_(None))
    stmt = (
        select(Category.id, Category.name, count.label("product_count"))
        .outerjoin(Product, Product.category_id == Category.id)
        .group_by(Category.id)
        .order_by(Category.name)
    )
    rows = await session.execute(stmt)
    return [CategoryOut(id=r.id, name=r.name, product_count=r.product_count) for r in rows]
