from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import Annotated

from pydantic import AfterValidator, BaseModel, Field

from app.catalog.models import Product
from app.catalog.normalize import collapse_whitespace, contains_markup, is_valid_sku, normalize_sku


def _sku(value: str) -> str:
    normalized = normalize_sku(value)
    if not is_valid_sku(normalized):
        raise ValueError("SKU must be 1-64 characters: letters, digits, '.', '_', '/', '-'")
    return normalized


def _text(value: str) -> str:
    return collapse_whitespace(value)


def _plain(value: str) -> str:
    if contains_markup(value):
        raise ValueError("Must be plain text; HTML markup is not allowed")
    return value


Sku = Annotated[str, AfterValidator(_sku)]
Name = Annotated[str, AfterValidator(_text), AfterValidator(_plain), Field(min_length=1, max_length=255)]
CategoryName = Annotated[str, AfterValidator(_text), AfterValidator(_plain), Field(max_length=100)]
Description = Annotated[str, AfterValidator(_plain), Field(max_length=5000)]
Price = Annotated[Decimal, Field(ge=0, max_digits=12, decimal_places=2)]
Weight = Annotated[Decimal, Field(ge=0, max_digits=10, decimal_places=3)]
Stock = Annotated[int, Field(ge=0, le=10_000_000)]


class ProductCreate(BaseModel):
    sku: Sku
    name: Name
    description: Description = ""
    category: CategoryName = ""
    price: Price
    stock: Stock = 0
    weight_kg: Weight | None = None


class ProductUpdate(BaseModel):
    version: int = Field(ge=1)
    expected_stock: int | None = Field(default=None, ge=0)
    sku: Sku | None = None
    name: Name | None = None
    description: Description | None = None
    category: CategoryName | None = None
    price: Price | None = None
    stock: Stock | None = None
    weight_kg: Weight | None = None


class ProductOut(BaseModel):
    id: int
    sku: str
    name: str
    description: str
    category: str
    price: Decimal
    stock: int
    weight_kg: Decimal | None
    version: int
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, product: Product) -> "ProductOut":
        return cls(
            id=product.id,
            sku=product.sku,
            name=product.name,
            description=product.description,
            category=product.category.name,
            price=product.price,
            stock=product.stock,
            weight_kg=product.weight_kg,
            version=product.version,
            created_at=product.created_at,
            updated_at=product.updated_at,
        )


class ProductPage(BaseModel):
    items: list[ProductOut]
    total: int
    page: int
    page_size: int
    fuzzy: bool = False


class CategoryOut(BaseModel):
    id: int
    name: str
    product_count: int


class SortOrder(StrEnum):
    relevance = "relevance"
    name = "name"
    price_asc = "price_asc"
    price_desc = "price_desc"
    newest = "newest"


class SearchParams(BaseModel):
    q: str | None = Field(default=None, max_length=200)
    category: str | None = None
    min_price: Decimal | None = Field(default=None, ge=0)
    max_price: Decimal | None = Field(default=None, ge=0)
    in_stock: bool = False
    sort: SortOrder | None = None
    page: int = Field(default=1, ge=1, le=10_000)
    page_size: int = Field(default=20, ge=1, le=100)
