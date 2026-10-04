"""Normalize order identifiers and payment storage.

Revision ID: 0022_order_schema_redesign
Revises: 0021_simplify_menu_storage
"""

from alembic import op
import sqlalchemy as sa


revision = "0022_order_schema_redesign"
down_revision = "0021_simplify_menu_storage"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Foreign keys are disabled only while the old SQLite tables are rebuilt.
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        op.execute(sa.text("PRAGMA foreign_keys=OFF"))

    op.create_table(
        "orders_new",
        sa.Column("order_id", sa.String(20), primary_key=True),
        sa.Column("customer_id", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=True),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=True),
        sa.Column("assigned_delivery_id", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=True),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("order_type", sa.String(16), nullable=False),
        sa.Column("delivery_fee_paise", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.String(500), nullable=False),
        sa.Column("customer_name", sa.String(120), nullable=True),
        sa.Column("customer_phone", sa.String(32), nullable=True),
        sa.Column("delivery_otp_ciphertext", sa.String(500), nullable=True),
        sa.Column("delivery_otp_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.execute(sa.text("""
        INSERT INTO orders_new
        (order_id, customer_id, created_by_id, assigned_delivery_id, status, order_type,
         delivery_fee_paise, scheduled_for, notes, customer_name, customer_phone,
         delivery_otp_ciphertext, delivery_otp_expires_at, delivered_at, created_at, updated_at)
        SELECT public_id, customer_id, created_by_id, assigned_delivery_id, status, order_type,
               delivery_fee_paise, scheduled_for, notes, customer_name, customer_phone,
               delivery_otp_ciphertext, delivery_otp_expires_at, delivered_at, created_at, updated_at
        FROM orders
    """))

    op.create_table(
        "order_items_new",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("order_id", sa.String(20), sa.ForeignKey("orders_new.order_id", ondelete="CASCADE"), nullable=False),
        sa.Column("menu_item_id", sa.Integer(), sa.ForeignKey("menu_items.id", ondelete="SET NULL"), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=False),
    )
    op.execute(sa.text("""
        INSERT INTO order_items_new (id, order_id, menu_item_id, quantity)
        SELECT oi.id, o.public_id, oi.menu_item_id, oi.quantity
        FROM order_items oi JOIN orders o ON o.id = oi.order_id
    """))

    op.create_table(
        "payments_new",
        sa.Column("order_id", sa.String(20), sa.ForeignKey("orders_new.order_id", ondelete="CASCADE"), primary_key=True),
        sa.Column("method", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("amount_paise", sa.Integer(), nullable=False),
        sa.Column("gateway_order_id", sa.String(120), unique=True, nullable=True),
        sa.Column("gateway_payment_id", sa.String(120), unique=True, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.execute(sa.text("""
        INSERT INTO payments_new
        (order_id, method, status, amount_paise, gateway_order_id, gateway_payment_id, created_at, updated_at)
        SELECT o.public_id, p.method, p.status, p.amount_paise, p.gateway_order_id,
               p.gateway_payment_id, p.created_at, p.updated_at
        FROM payments p JOIN orders o ON o.id = p.order_id
    """))

    op.create_table(
        "delivery_batch_orders_new",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("batch_id", sa.Integer(), sa.ForeignKey("delivery_batches.id", ondelete="CASCADE"), nullable=False),
        sa.Column("order_id", sa.String(20), sa.ForeignKey("orders_new.order_id", ondelete="CASCADE"), nullable=False),
        sa.UniqueConstraint("batch_id", "order_id"),
    )
    op.execute(sa.text("""
        INSERT INTO delivery_batch_orders_new (id, batch_id, order_id)
        SELECT dbo.id, dbo.batch_id, o.public_id
        FROM delivery_batch_orders dbo JOIN orders o ON o.id = dbo.order_id
    """))

    op.drop_table("payments")
    op.drop_table("order_items")
    op.drop_table("delivery_batch_orders")
    op.drop_table("orders")
    op.rename_table("orders_new", "orders")
    op.rename_table("order_items_new", "order_items")
    op.rename_table("payments_new", "payments")
    op.rename_table("delivery_batch_orders_new", "delivery_batch_orders")
    op.create_index("ix_orders_customer_id", "orders", ["customer_id"])
    op.create_index("ix_orders_assigned_delivery_id", "orders", ["assigned_delivery_id"])
    op.create_index("ix_orders_status", "orders", ["status"])
    op.create_index("ix_orders_created_at", "orders", ["created_at"])
    op.create_index("ix_order_items_order_id", "order_items", ["order_id"])
    op.create_index("ix_delivery_batch_orders_order_id", "delivery_batch_orders", ["order_id"])

    if bind.dialect.name == "sqlite":
        op.execute(sa.text("PRAGMA foreign_keys=ON"))


def downgrade() -> None:
    raise NotImplementedError("The order identifier redesign is not safely reversible without reintroducing duplicate payment IDs.")
