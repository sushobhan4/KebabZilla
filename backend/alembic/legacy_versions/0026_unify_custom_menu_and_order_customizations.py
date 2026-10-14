"""Unify custom menu items into menu_items and add customization fields to order_items.

Revision ID: 0026_unify_custom_menu_and_order_customizations
Revises: 0025_custom_menu_items
"""

import json
from alembic import op
import sqlalchemy as sa


revision = "0026_unify_custom_menu_and_order_customizations"
down_revision = "0025_custom_menu_items"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add columns to menu_items
    with op.batch_alter_table("menu_items") as batch:
        batch.add_column(sa.Column("is_custom", sa.Boolean(), nullable=False, server_default="0"))
        batch.add_column(sa.Column("custom_sections", sa.JSON(), nullable=False, server_default="[]"))

    # 2. Add columns to order_items
    with op.batch_alter_table("order_items") as batch:
        batch.add_column(sa.Column("customizations", sa.JSON(), nullable=False, server_default="[]"))
        batch.add_column(sa.Column("unit_price_paise", sa.Integer(), nullable=True))

    # 3. Migrate any existing rows from custom_menu_items into menu_items
    bind = op.get_bind()
    custom_items = bind.execute(sa.text("SELECT * FROM custom_menu_items")).mappings().all()
    for c_item in custom_items:
        sections_rows = bind.execute(
            sa.text("SELECT * FROM custom_menu_sections WHERE item_id = :item_id ORDER BY position"),
            {"item_id": c_item["id"]}
        ).mappings().all()
        sections_data = []
        for s in sections_rows:
            opts = s["options"]
            if isinstance(opts, str):
                try:
                    opts = json.loads(opts)
                except Exception:
                    opts = []
            sections_data.append({
                "name": s["name"],
                "position": s["position"],
                "options": opts,
            })

        img_urls = c_item["image_urls"]
        if isinstance(img_urls, str):
            try:
                img_urls = json.loads(img_urls)
            except Exception:
                img_urls = []

        bind.execute(
            sa.text("""
                INSERT INTO menu_items
                (name, description, category_id, price_paise, image_urls, is_vegetarian,
                 is_available, is_featured, created_at, is_custom, custom_sections)
                VALUES
                (:name, :description, :category_id, :price_paise, :image_urls, :is_vegetarian,
                 :is_available, :is_featured, :created_at, :is_custom, :custom_sections)
            """),
            {
                "name": c_item["name"],
                "description": c_item["description"],
                "category_id": c_item["category_id"],
                "price_paise": c_item["base_price_paise"],
                "image_urls": json.dumps(img_urls),
                "is_vegetarian": c_item["is_vegetarian"],
                "is_available": c_item["is_available"],
                "is_featured": c_item["is_featured"],
                "created_at": c_item["created_at"],
                "is_custom": 1,
                "custom_sections": json.dumps(sections_data),
            }
        )


def downgrade() -> None:
    with op.batch_alter_table("order_items") as batch:
        batch.drop_column("unit_price_paise")
        batch.drop_column("customizations")

    with op.batch_alter_table("menu_items") as batch:
        batch.drop_column("custom_sections")
        batch.drop_column("is_custom")
