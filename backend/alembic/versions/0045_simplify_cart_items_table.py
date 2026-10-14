"""Simplify cart_items table to only keep menu_id, variation_name, customizations.

Revision ID: 0045_simplify_cart_items_table
Revises: 0044_cart_customizations_and_variations
Create Date: 2026-10-14 03:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "0045_simplify_cart_items_table"
down_revision = "0044_cart_customizations_and_variations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    # Recreate cart_items with only customer_id, menu_id, variation_name, quantity, unit_price_paise, customizations, updated_at
    op.create_table(
        "cart_items_new",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("customer_id", sa.Integer(), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("menu_id", sa.Integer(), sa.ForeignKey("menu_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("variation_name", sa.String(length=60), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("unit_price_paise", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("customizations", sa.JSON(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )

    bind.execute(
        sa.text("""
            INSERT INTO cart_items_new (id, customer_id, menu_id, variation_name, quantity, unit_price_paise, customizations, updated_at)
            SELECT 
                ci.id,
                ci.customer_id,
                COALESCE(ci.menu_item_id, ci.custom_menu_item_id),
                ci.variation_name,
                ci.quantity,
                ci.unit_price_paise,
                ci.customizations,
                ci.updated_at
            FROM cart_items ci
            WHERE ci.menu_item_id IS NOT NULL OR ci.custom_menu_item_id IS NOT NULL
        """)
    )

    op.drop_table("cart_items")
    op.rename_table("cart_items_new", "cart_items")
    op.create_index("ix_cart_items_customer_id", "cart_items", ["customer_id"])
    op.create_index("ix_cart_items_menu_id", "cart_items", ["menu_id"])


def downgrade() -> None:
    bind = op.get_bind()

    op.create_table(
        "cart_items_old",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("customer_id", sa.Integer(), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("menu_item_id", sa.Integer(), sa.ForeignKey("menu_items.id", ondelete="CASCADE"), nullable=True),
        sa.Column("custom_menu_item_id", sa.Integer(), sa.ForeignKey("menu_items.id", ondelete="CASCADE"), nullable=True),
        sa.Column("variation_name", sa.String(length=60), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("unit_price_paise", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("customizations", sa.JSON(), nullable=True),
        sa.Column("line_key", sa.String(length=255), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )

    bind.execute(
        sa.text("""
            INSERT INTO cart_items_old (id, customer_id, menu_item_id, custom_menu_item_id, variation_name, quantity, unit_price_paise, customizations, line_key, updated_at)
            SELECT id, customer_id, menu_id, NULL, variation_name, quantity, unit_price_paise, customizations, CAST(menu_id AS TEXT), updated_at
            FROM cart_items
        """)
    )

    op.drop_table("cart_items")
    op.rename_table("cart_items_old", "cart_items")
    op.create_index("ix_cart_items_customer_id", "cart_items", ["customer_id"])
    op.create_index("ix_cart_items_menu_item_id", "cart_items", ["menu_item_id"])
    op.create_index("ix_cart_items_custom_menu_item_id", "cart_items", ["custom_menu_item_id"])
    op.create_index("ix_cart_items_line_key", "cart_items", ["line_key"])
