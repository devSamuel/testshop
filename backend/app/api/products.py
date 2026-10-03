from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Query, Response, status
from pydantic import BaseModel

from app.api.deps import SessionDep
from app.catalog import service as catalog
from app.catalog.schemas import (
    CategoryOut,
    ProductCreate,
    ProductOut,
    ProductPage,
    ProductUpdate,
    SearchParams,
)
from app.inventory import service as inventory
from app.inventory.models import MovementReason

router = APIRouter(prefix="/api", tags=["products"])

NON_NULLABLE = {"sku", "name", "description", "category", "price"}


class StockMovementOut(BaseModel):
    id: int
    delta: int
    balance_after: int
    reason: str
    reference_type: str | None
    reference_id: str | None
    created_at: datetime


@router.get("/products", response_model=ProductPage)
async def search_products(session: SessionDep, params: Annotated[SearchParams, Query()]) -> ProductPage:
    result = await catalog.search_products(session, params)
    return ProductPage(
        items=[ProductOut.of(p) for p in result.items],
        total=result.total,
        page=params.page,
        page_size=params.page_size,
        fuzzy=result.fuzzy,
    )


@router.post("/products", response_model=ProductOut, status_code=status.HTTP_201_CREATED)
async def create_product(body: ProductCreate, session: SessionDep, response: Response) -> ProductOut:
    async with session.begin():
        product = await catalog.create_product(
            session,
            catalog.ProductFields(
                sku=body.sku,
                name=body.name,
                description=body.description,
                category=body.category,
                price=body.price,
                weight_kg=body.weight_kg,
            ),
        )
        if body.stock:
            await inventory.set_stock(
                session,
                product.id,
                body.stock,
                reason=MovementReason.admin_adjustment,
                reference_type="admin",
                reference_id="create",
            )
        product = await catalog.get_product(session, product.id)
    response.headers["Location"] = f"/api/products/{product.id}"
    return ProductOut.of(product)


@router.get("/products/{product_id}", response_model=ProductOut)
async def get_product(product_id: int, session: SessionDep) -> ProductOut:
    return ProductOut.of(await catalog.get_product(session, product_id))


@router.patch("/products/{product_id}", response_model=ProductOut)
async def update_product(product_id: int, body: ProductUpdate, session: SessionDep) -> ProductOut:
    provided = body.model_dump(exclude_unset=True, exclude={"version", "stock", "expected_stock"})
    changes: dict[str, Any] = {k: v for k, v in provided.items() if v is not None or k not in NON_NULLABLE}
    async with session.begin():
        await catalog.update_product(session, product_id, body.version, changes)
        if "stock" in body.model_fields_set and body.stock is not None:
            await inventory.set_stock(
                session,
                product_id,
                body.stock,
                reason=MovementReason.admin_adjustment,
                reference_type="admin",
                reference_id="edit",
                expected_current=body.expected_stock,
            )
        product = await catalog.get_product(session, product_id)
    return ProductOut.of(product)


@router.delete("/products/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_product(
    product_id: int, session: SessionDep, version: Annotated[int, Query(ge=1)]
) -> Response:
    async with session.begin():
        await catalog.soft_delete_product(session, product_id, version)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/products/{product_id}/stock-movements", response_model=list[StockMovementOut])
async def stock_movements(
    product_id: int,
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    before_id: Annotated[int | None, Query(ge=1)] = None,
) -> list[StockMovementOut]:
    await catalog.get_product(session, product_id)
    movements = await inventory.stock_history(session, product_id, limit, before_id)
    return [
        StockMovementOut(
            id=m.id,
            delta=m.delta,
            balance_after=m.balance_after,
            reason=m.reason,
            reference_type=m.reference_type,
            reference_id=m.reference_id,
            created_at=m.created_at,
        )
        for m in movements
    ]


@router.get("/categories", response_model=list[CategoryOut])
async def list_categories(session: SessionDep) -> list[CategoryOut]:
    return await catalog.list_categories(session)
