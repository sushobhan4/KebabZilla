"""Separate custom menus into custom_menu_items and custom_menu_sections, drop is_custom and custom_sections from menu_items, and add variations.

Revision ID: 0031_separate_custom_menus_and_add_variations
Revises: 0030_cleanup_columns
"""

import json
from alembic import op
import sqlalchemy as sa


revision = "0031_separate_custom_menus_and_add_variations"
down_revision = "0030_cleanup_columns"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    # 1. Add required column to custom_menu_sections if not present
    section_cols = [x[1] for x in bind.execute(sa.text("PRAGMA table_info(custom_menu_sections)")).fetchall()]
    if "required" not in section_cols:
        with op.batch_alter_table("custom_menu_sections") as batch:
            batch.add_column(sa.Column("required", sa.Boolean(), nullable=False, server_default="1"))

    # 2. Migrate any custom items currently in menu_items into custom_menu_items and custom_menu_sections
    menu_cols = [x[1] for x in bind.execute(sa.text("PRAGMA table_info(menu_items)")).fetchall()]
    if "is_custom" in menu_cols:
        custom_rows = bind.execute(
            sa.text("SELECT * FROM menu_items WHERE is_custom = 1")
        ).mappings().all()

        for item in custom_rows:
            img_urls = item["image_urls"]
            if isinstance(img_urls, str):
                try:
                    img_urls = json.loads(img_urls)
                except Exception:
                    img_urls = []

            res = bind.execute(
                sa.text("""
                    INSERT INTO custom_menu_items
                    (name, description, category_id, base_price_paise, image_urls, is_vegetarian, is_available, is_featured, created_at)
                    VALUES
                    (:name, :description, :category_id, :base_price_paise, :image_urls, :is_vegetarian, :is_available, :is_featured, :created_at)
                """),
                {
                    "name": item["name"],
                    "description": item["description"] or "",
                    "category_id": item["category_id"],
                    "base_price_paise": item["price_paise"],
                    "image_urls": json.dumps(img_urls),
                    "is_vegetarian": item["is_vegetarian"],
                    "is_available": item["is_available"],
                    "is_featured": item["is_featured"],
                    "created_at": item["created_at"],
                }
            )
            custom_item_id = res.lastrowid

            sections_raw = item["custom_sections"]
            if isinstance(sections_raw, str):
                try:
                    sections_raw = json.loads(sections_raw)
                except Exception:
                    sections_raw = []

            for idx, sec in enumerate(sections_raw or []):
                opts = sec.get("options", [])
                bind.execute(
                    sa.text("""
                        INSERT INTO custom_menu_sections
                        (item_id, name, position, required, options)
                        VALUES
                        (:item_id, :name, :position, :required, :options)
                    """),
                    {
                        "item_id": custom_item_id,
                        "name": sec.get("name", ""),
                        "position": sec.get("position", idx),
                        "required": 1 if sec.get("required", True) else 0,
                        "options": json.dumps(opts),
                    }
                )

        # 3. Delete custom items from menu_items
        bind.execute(sa.text("DELETE FROM menu_items WHERE is_custom = 1"))

        # 4. Alter menu_items: drop is_custom and custom_sections, add variations
        with op.batch_alter_table("menu_items") as batch:
            batch.drop_column("is_custom")
            batch.drop_column("custom_sections")
            if "variations" not in menu_cols:
                batch.add_column(sa.Column("variations", sa.JSON(), nullable=False, server_default="[]"))

    # 5. Add custom_menu_item_id and variation_name to order_items
    order_item_cols = [x[1] for x in bind.execute(sa.text("PRAGMA table_info(order_items)")).fetchall()]
    with op.batch_alter_table("order_items") as batch:
        if "custom_menu_item_id" not in order_item_cols:
            batch.add_column(sa.Column("custom_menu_item_id", sa.Integer(), nullable=True))
        if "variation_name" not in order_item_cols:
            batch.add_column(sa.Column("variation_name", sa.String(60), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("order_items") as batch:
        batch.drop_column("variation_name")
        batch.drop_column("custom_menu_item_id")

    with op.batch_alter_table("menu_items") as batch:
        batch.drop_column("variations")
        batch.add_column(sa.Column("is_custom", sa.Boolean(), nullable=False, server_default="0"))
        batch.add_column(sa.Column("custom_sections", sa.JSON(), nullable=False, server_default="[]"))

    with op.batch_alter_table("custom_menu_sections") as batch:
        batch.drop_column("required")
