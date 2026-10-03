from datetime import UTC, datetime
from decimal import Decimal
from typing import Annotated, Self

from pydantic import BaseModel, BeforeValidator, EmailStr, Field, model_validator

from app.orders.models import Order, OrderItem
from app.payments.provider import luhn_valid


def _digits_only(value: object) -> object:
    if isinstance(value, str):
        return value.replace(" ", "").replace("-", "")
    return value


class CardIn(BaseModel):
    number: Annotated[str, BeforeValidator(_digits_only), Field(pattern=r"^\d{12,19}$")]
    exp_month: int = Field(ge=1, le=12)
    exp_year: int = Field(ge=2000, le=2100)
    cvc: str = Field(pattern=r"^\d{3,4}$")

    @model_validator(mode="after")
    def check_card(self) -> Self:
        if not luhn_valid(self.number):
            raise ValueError("Card number is invalid")
        now = datetime.now(UTC)
        if (self.exp_year, self.exp_month) < (now.year, now.month):
            raise ValueError("Card is expired")
        return self


class CheckoutItemIn(BaseModel):
    product_id: int = Field(ge=1)
    quantity: int = Field(ge=1, le=100)


class CheckoutIn(BaseModel):
    email: EmailStr
    items: list[CheckoutItemIn] = Field(min_length=1, max_length=50)
    card: CardIn


class OrderItemOut(BaseModel):
    product_id: int
    sku: str
    name: str
    unit_price: Decimal
    quantity: int
    line_total: Decimal

    @classmethod
    def of(cls, item: OrderItem) -> "OrderItemOut":
        return cls(
            product_id=item.product_id,
            sku=item.sku,
            name=item.name,
            unit_price=item.unit_price,
            quantity=item.quantity,
            line_total=item.line_total,
        )


class OrderOut(BaseModel):
    id: int
    status: str
    email: str
    total: Decimal
    currency: str
    items: list[OrderItemOut]
    card_brand: str
    card_last4: str
    payment_ref: str | None
    decline_reason: str | None
    reservation_expires_at: datetime
    created_at: datetime
    updated_at: datetime
    paid_at: datetime | None

    @classmethod
    def of(cls, order: Order) -> "OrderOut":
        return cls(
            id=order.id,
            status=order.status,
            email=order.customer_email,
            total=order.total,
            currency=order.currency,
            items=[OrderItemOut.of(i) for i in order.items],
            card_brand=order.card_brand,
            card_last4=order.card_last4,
            payment_ref=order.payment_ref,
            decline_reason=order.decline_reason,
            reservation_expires_at=order.reservation_expires_at,
            created_at=order.created_at,
            updated_at=order.updated_at,
            paid_at=order.paid_at,
        )


class OrderPage(BaseModel):
    items: list[OrderOut]
    total: int
    page: int
    page_size: int
