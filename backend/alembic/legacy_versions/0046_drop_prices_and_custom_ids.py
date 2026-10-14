"""Drop unit_price_paise from cart_items, custom_menu_item_id from order_items and menu_discount_items, base_price_paise from menu_items.

Revision ID: 0046_drop_prices_and_custom_ids
Revises: 0045_simplify_cart_items_table
Create Date: 2026-10-14 03:15:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "0046_drop_prices_and_custom_ids"
down_revision = "0045_simplify_cart_items_table"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    # 1. cart_items: remove unit_price_paise
    op.create_table(
        "cart_items_new",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("customer_id", sa.Integer(), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("menu_id", sa.Integer(), sa.ForeignKey("menu_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("variation_name", sa.String(length=60), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("customizations", sa.JSON(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    bind.execute(
        sa.text("""
            INSERT INTO cart_items_new (id, customer_id, menu_id, variation_name, quantity, customizations, updated_at)
            SELECT id, customer_id, menu_id, variation_name, quantity, customizations, updated_at
            FROM cart_items
        """)
    )
    op.drop_table("cart_items")
    op.rename_table("cart_items_new", "cart_items")
    op.create_index("ix_cart_items_customer_id", "cart_items", ["customer_id"])
    op.create_index("ix_cart_items_menu_id", "cart_items", ["menu_id"])

    # 2. order_items: remove custom_menu_item_id
    op.create_table(
        "order_items_new",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("order_id", sa.String(length=32), sa.ForeignKey("orders.order_id", ondelete="CASCADE"), nullable=False),
        sa.Column("menu_item_id", sa.Integer(), sa.ForeignKey("menu_items.id", ondelete="SET NULL"), nullable=True),
        sa.Column("variation_name", sa.String(length=60), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("unit_price_paise", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("customizations", sa.JSON(), nullable=True),
    )
    bind.execute(
        sa.text("""
            INSERT INTO order_items_new (id, order_id, menu_item_id, variation_name, quantity, unit_price_paise, customizations)
            SELECT 
                id, 
                order_id, 
                COALESCE(menu_item_id, custom_menu_item_id), 
                variation_name, 
                quantity, 
                unit_price_paise, 
                customizations
            FROM order_items
        """)
    )
    op.drop_table("order_items")
    op.rename_table("order_items_new", "order_items")
    op.create_index("ix_order_items_order_id", "order_items", ["order_id"])
    op.create_index("ix_order_items_menu_item_id", "order_items", ["menu_item_id"])

    # 3. menu_discount_items: remove custom_menu_item_id
    op.create_table(
        "menu_discount_items_new",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("discount_id", sa.Integer(), sa.ForeignKey("menu_discounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("menu_item_id", sa.Integer(), sa.ForeignKey("menu_items.id", ondelete="CASCADE"), nullable=False),
    )
    bind.execute(
        sa.text("""
            INSERT INTO menu_discount_items_new (id, discount_id, menu_item_id)
            SELECT id, discount_id, COALESCE(menu_item_id, custom_menu_item_id)
            FROM menu_discount_items
            WHERE menu_item_id IS NOT NULL OR custom_menu_item_id IS NOT NULL
        """)
    )
    op.drop_table("menu_discount_items")
    op.rename_table("menu_discount_items_new", "menu_discount_items")
    op.create_index("ix_menu_discount_items_discount_id", "menu_discount_items", ["discount_id"])
    op.create_index("ix_menu_discount_items_menu_item_id", "menu_discount_items", ["menu_item_id"])

    # 4. menu_items: remove base_price_paise
    op.create_table(
        "menu_items_new",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("price_paise", sa.Integer(), nullable=False),
        sa.Column("category_id", sa.Integer(), sa.ForeignKey("menu_categories.id", ondelete="SET NULL"), nullable=True),
        sa.Column("paused_by_id", sa.Integer(), sa.ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("paused_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("image_urls", sa.JSON(), nullable=True),
        sa.Column("is_vegetarian", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("is_available", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("is_featured", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("is_customizable", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("variations", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    bind.execute(
        sa.text("""
            INSERT INTO menu_items_new (id, name, description, price_paise, category_id, paused_by_id, paused_until, image_urls, is_vegetarian, is_available, is_featured, is_customizable, variations, created_at)
            SELECT 
                id, 
                name, 
                description, 
                CASE WHEN price_paise > 0 THEN price_paise ELSE COALESCE(base_price_paise, 0) END, 
                category_id, 
                paused_by_id, 
                paused_until, 
                image_urls, 
                is_vegetarian, 
                is_available, 
                is_featured, 
                is_customizable, 
                variations, 
                created_at
            FROM menu_items
        """)
    )
    op.drop_table("menu_items")
    op.rename_table("menu_items_new", "menu_items")
    op.create_index("ix_menu_items_is_available", "menu_items", ["is_available"])
    op.create_index("ix_menu_items_category_id", "menu_items", ["category_id"])
    op.create_index("ix_menu_items_paused_by_id", "menu_items", ["paused_by_id"])


def downgrade() -> None:
    pass
