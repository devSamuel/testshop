from datetime import datetime
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, TimestampMixin


class OrderStatus(StrEnum):
    pending_payment = "pending_payment"
    paid = "paid"
    payment_failed = "payment_failed"
    expired = "expired"


TRANSITIONS: dict[OrderStatus, frozenset[OrderStatus]] = {
    OrderStatus.pending_payment: frozenset(
        {OrderStatus.paid, OrderStatus.payment_failed, OrderStatus.expired}
    ),
    OrderStatus.paid: frozenset(),
    OrderStatus.payment_failed: frozenset(),
    OrderStatus.expired: frozenset(),
}


def sources_for(target: OrderStatus) -> list[OrderStatus]:
    return [source for source, targets in TRANSITIONS.items() if target in targets]


class Order(TimestampMixin, Base):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    idempotency_key: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=OrderStatus.pending_payment)
    customer_email: Mapped[str] = mapped_column(String(320), nullable=False)
    total: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    reservation_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    card_last4: Mapped[str] = mapped_column(String(4), nullable=False)
    card_brand: Mapped[str] = mapped_column(String(20), nullable=False)
    payment_ref: Mapped[str | None] = mapped_column(String(64))
    decline_reason: Mapped[str | None] = mapped_column(String(64))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    items: Mapped[list["OrderItem"]] = relationship(
        lazy="selectin", order_by="OrderItem.id", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint(
            "status IN ('pending_payment', 'paid', 'payment_failed', 'expired')", name="status_valid"
        ),
        CheckConstraint("total >= 0", name="total_non_negative"),
        Index("ix_orders_pending", "created_at", postgresql_where=text("status = 'pending_payment'")),
        Index("ix_orders_created_at", "created_at"),
    )


class OrderItem(Base):
    __tablename__ = "order_items"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), nullable=False)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    sku: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    line_total: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)

    __table_args__ = (
        CheckConstraint("quantity > 0", name="quantity_positive"),
        UniqueConstraint("order_id", "product_id"),
    )


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    recipient: Mapped[str] = mapped_column(String(320), nullable=False)
    subject: Mapped[str] = mapped_column(String(200), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (UniqueConstraint("order_id", "kind"),)
