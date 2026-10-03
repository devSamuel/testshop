"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-10-02 16:14:25.942451
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


APPEND_ONLY_FUNCTION = """
CREATE OR REPLACE FUNCTION forbid_ledger_rewrite() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'stock_movements is an append-only ledger; % is not allowed', TG_OP
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql
"""

APPEND_ONLY_TRIGGER = """
CREATE TRIGGER stock_movements_append_only
BEFORE UPDATE OR DELETE ON stock_movements
FOR EACH ROW EXECUTE FUNCTION forbid_ledger_rewrite()
"""


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.create_table(
        "categories",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("name_key", sa.String(length=100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_categories")),
        sa.UniqueConstraint("name_key", name=op.f("uq_categories_name_key")),
    )
    op.create_table(
        "import_runs",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("dry_run", sa.Boolean(), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("rows_total", sa.Integer(), nullable=False),
        sa.Column("rows_valid", sa.Integer(), nullable=False),
        sa.Column("rows_invalid", sa.Integer(), nullable=False),
        sa.Column("created", sa.Integer(), nullable=False),
        sa.Column("updated", sa.Integer(), nullable=False),
        sa.Column("unchanged", sa.Integer(), nullable=False),
        sa.Column("error_count", sa.Integer(), nullable=False),
        sa.Column("warning_count", sa.Integer(), nullable=False),
        sa.Column("issues", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("failure", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_import_runs")),
    )
    op.create_table(
        "orders",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("idempotency_key", sa.String(length=100), nullable=False),
        sa.Column("request_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("customer_email", sa.String(length=320), nullable=False),
        sa.Column("total", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("reservation_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("card_last4", sa.String(length=4), nullable=False),
        sa.Column("card_brand", sa.String(length=20), nullable=False),
        sa.Column("payment_ref", sa.String(length=64), nullable=True),
        sa.Column("decline_reason", sa.String(length=64), nullable=True),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "status IN ('pending_payment', 'paid', 'payment_failed', 'expired')",
            name=op.f("ck_orders_status_valid"),
        ),
        sa.CheckConstraint("total >= 0", name=op.f("ck_orders_total_non_negative")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_orders")),
        sa.UniqueConstraint("idempotency_key", name=op.f("uq_orders_idempotency_key")),
    )
    op.create_index("ix_orders_created_at", "orders", ["created_at"], unique=False)
    op.create_index(
        "ix_orders_pending",
        "orders",
        ["created_at"],
        unique=False,
        postgresql_where=sa.text("status = 'pending_payment'"),
    )
    op.create_table(
        "outbox_events",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("aggregate_type", sa.String(length=50), nullable=False),
        sa.Column("aggregate_id", sa.String(length=64), nullable=False),
        sa.Column("event_type", sa.String(length=100), nullable=False),
        sa.Column("event_version", sa.Integer(), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("correlation_id", sa.String(length=64), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "next_attempt_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("failed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_outbox_events")),
    )
    op.create_index(
        "ix_outbox_events_aggregate", "outbox_events", ["aggregate_type", "aggregate_id"], unique=False
    )
    op.create_index(
        "ix_outbox_events_pending",
        "outbox_events",
        ["next_attempt_at", "occurred_at"],
        unique=False,
        postgresql_where=sa.text("published_at IS NULL AND failed_at IS NULL"),
    )
    op.create_table(
        "payment_sim_charges",
        sa.Column("idempotency_key", sa.String(length=100), nullable=False),
        sa.Column("reference", sa.String(length=64), nullable=False),
        sa.Column("amount", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("decline_reason", sa.String(length=64), nullable=True),
        sa.Column("card_last4", sa.String(length=4), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("idempotency_key", name=op.f("pk_payment_sim_charges")),
    )
    op.create_table(
        "processed_events",
        sa.Column("handler", sa.String(length=150), nullable=False),
        sa.Column("event_id", sa.UUID(), nullable=False),
        sa.Column(
            "processed_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.PrimaryKeyConstraint("handler", "event_id", name=op.f("pk_processed_events")),
    )
    op.create_table(
        "notifications",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("order_id", sa.BigInteger(), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("recipient", sa.String(length=320), nullable=False),
        sa.Column("subject", sa.String(length=200), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], name=op.f("fk_notifications_order_id_orders")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_notifications")),
        sa.UniqueConstraint("order_id", "kind", name=op.f("uq_notifications_order_id_kind")),
    )
    op.create_table(
        "products",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("sku", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), server_default="", nullable=False),
        sa.Column("category_id", sa.BigInteger(), nullable=False),
        sa.Column("price", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("stock", sa.Integer(), server_default="0", nullable=False),
        sa.Column("weight_kg", sa.Numeric(precision=10, scale=3), nullable=True),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "search_vector",
            postgresql.TSVECTOR(),
            sa.Computed(
                "setweight(to_tsvector('english', coalesce(name, '')), 'A') || setweight(to_tsvector('simple', coalesce(sku, '')), 'B') || setweight(to_tsvector('english', coalesce(description, '')), 'C')",
                persisted=True,
            ),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("price >= 0", name=op.f("ck_products_price_non_negative")),
        sa.CheckConstraint("stock >= 0", name=op.f("ck_products_stock_non_negative")),
        sa.CheckConstraint(
            "weight_kg IS NULL OR weight_kg >= 0", name=op.f("ck_products_weight_non_negative")
        ),
        sa.ForeignKeyConstraint(
            ["category_id"], ["categories.id"], name=op.f("fk_products_category_id_categories")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_products")),
    )
    op.create_index(
        "ix_products_category_active",
        "products",
        ["category_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "ix_products_name_trgm",
        "products",
        ["name"],
        unique=False,
        postgresql_using="gin",
        postgresql_ops={"name": "gin_trgm_ops"},
    )
    op.create_index(
        "ix_products_price_active",
        "products",
        ["price"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "ix_products_search_vector", "products", ["search_vector"], unique=False, postgresql_using="gin"
    )
    op.create_index(
        "ix_products_sku_trgm",
        "products",
        ["sku"],
        unique=False,
        postgresql_using="gin",
        postgresql_ops={"sku": "gin_trgm_ops"},
    )
    op.create_index(
        "uq_products_sku_active",
        "products",
        ["sku"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_table(
        "order_items",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("order_id", sa.BigInteger(), nullable=False),
        sa.Column("product_id", sa.BigInteger(), nullable=False),
        sa.Column("sku", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("unit_price", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("line_total", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.CheckConstraint("quantity > 0", name=op.f("ck_order_items_quantity_positive")),
        sa.ForeignKeyConstraint(
            ["order_id"], ["orders.id"], name=op.f("fk_order_items_order_id_orders"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["product_id"], ["products.id"], name=op.f("fk_order_items_product_id_products")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_order_items")),
        sa.UniqueConstraint("order_id", "product_id", name=op.f("uq_order_items_order_id_product_id")),
    )
    op.create_table(
        "stock_alerts",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("product_id", sa.BigInteger(), nullable=False),
        sa.Column("sku", sa.String(length=64), nullable=False),
        sa.Column("level", sa.String(length=16), nullable=False),
        sa.Column("stock_at_alert", sa.Integer(), nullable=False),
        sa.Column("threshold", sa.Integer(), nullable=False),
        sa.Column("source_event_id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["product_id"], ["products.id"], name=op.f("fk_stock_alerts_product_id_products")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_stock_alerts")),
    )
    op.create_index(
        "uq_stock_alerts_open",
        "stock_alerts",
        ["product_id"],
        unique=True,
        postgresql_where=sa.text("resolved_at IS NULL"),
    )
    op.create_table(
        "stock_movements",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("product_id", sa.BigInteger(), nullable=False),
        sa.Column("delta", sa.Integer(), nullable=False),
        sa.Column("balance_after", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(length=32), nullable=False),
        sa.Column("reference_type", sa.String(length=32), nullable=True),
        sa.Column("reference_id", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("balance_after >= 0", name=op.f("ck_stock_movements_balance_non_negative")),
        sa.CheckConstraint("delta <> 0", name=op.f("ck_stock_movements_delta_non_zero")),
        sa.ForeignKeyConstraint(
            ["product_id"], ["products.id"], name=op.f("fk_stock_movements_product_id_products")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_stock_movements")),
    )
    op.create_index("ix_stock_movements_product_id_id", "stock_movements", ["product_id", "id"], unique=False)
    op.create_index(
        "ix_stock_movements_reference", "stock_movements", ["reference_type", "reference_id"], unique=False
    )
    op.create_table(
        "stock_reservations",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("order_id", sa.BigInteger(), nullable=False),
        sa.Column("product_id", sa.BigInteger(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("quantity > 0", name=op.f("ck_stock_reservations_quantity_positive")),
        sa.ForeignKeyConstraint(
            ["product_id"], ["products.id"], name=op.f("fk_stock_reservations_product_id_products")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_stock_reservations")),
        sa.UniqueConstraint("order_id", "product_id", name=op.f("uq_stock_reservations_order_id_product_id")),
    )
    op.create_index(
        "ix_stock_reservations_active_product",
        "stock_reservations",
        ["product_id"],
        unique=False,
        postgresql_where=sa.text("status = 'active'"),
    )
    op.execute(APPEND_ONLY_FUNCTION)
    op.execute(APPEND_ONLY_TRIGGER)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS stock_movements_append_only ON stock_movements")
    op.execute("DROP FUNCTION IF EXISTS forbid_ledger_rewrite()")
    op.drop_index(
        "ix_stock_reservations_active_product",
        table_name="stock_reservations",
        postgresql_where=sa.text("status = 'active'"),
    )
    op.drop_table("stock_reservations")
    op.drop_index("ix_stock_movements_reference", table_name="stock_movements")
    op.drop_index("ix_stock_movements_product_id_id", table_name="stock_movements")
    op.drop_table("stock_movements")
    op.drop_index(
        "uq_stock_alerts_open", table_name="stock_alerts", postgresql_where=sa.text("resolved_at IS NULL")
    )
    op.drop_table("stock_alerts")
    op.drop_table("order_items")
    op.drop_index(
        "uq_products_sku_active", table_name="products", postgresql_where=sa.text("deleted_at IS NULL")
    )
    op.drop_index(
        "ix_products_sku_trgm",
        table_name="products",
        postgresql_using="gin",
        postgresql_ops={"sku": "gin_trgm_ops"},
    )
    op.drop_index("ix_products_search_vector", table_name="products", postgresql_using="gin")
    op.drop_index(
        "ix_products_price_active", table_name="products", postgresql_where=sa.text("deleted_at IS NULL")
    )
    op.drop_index(
        "ix_products_name_trgm",
        table_name="products",
        postgresql_using="gin",
        postgresql_ops={"name": "gin_trgm_ops"},
    )
    op.drop_index(
        "ix_products_category_active", table_name="products", postgresql_where=sa.text("deleted_at IS NULL")
    )
    op.drop_table("products")
    op.drop_table("notifications")
    op.drop_table("processed_events")
    op.drop_table("payment_sim_charges")
    op.drop_index(
        "ix_outbox_events_pending",
        table_name="outbox_events",
        postgresql_where=sa.text("published_at IS NULL AND failed_at IS NULL"),
    )
    op.drop_index("ix_outbox_events_aggregate", table_name="outbox_events")
    op.drop_table("outbox_events")
    op.drop_index(
        "ix_orders_pending", table_name="orders", postgresql_where=sa.text("status = 'pending_payment'")
    )
    op.drop_index("ix_orders_created_at", table_name="orders")
    op.drop_table("orders")
    op.drop_table("import_runs")
    op.drop_table("categories")
