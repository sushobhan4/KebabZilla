"""Add multiple categories support for menu items and custom menu items.

Revision ID: 0040_menu_item_multiple_categories
Revises: 0039_rename_delivery_duty_to_staff_info
Create Date: 2026-10-12 04:38:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "0040_menu_item_multiple_categories"
down_revision = "0039_rename_delivery_duty_to_staff_info"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = insp.get_table_names()

    if "menu_item_categories" not in tables:
        op.create_table(
            "menu_item_categories",
            sa.Column("menu_item_id", sa.Integer(), sa.ForeignKey("menu_items.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("category_id", sa.Integer(), sa.ForeignKey("menu_categories.id", ondelete="CASCADE"), primary_key=True),
        )
        menu_items_tbl = sa.Table("menu_items", sa.MetaData(), autoload_with=bind)
        menu_item_cats_tbl = sa.Table("menu_item_categories", sa.MetaData(), autoload_with=bind)
        existing_items = bind.execute(sa.select(menu_items_tbl.c.id, menu_items_tbl.c.category_id).where(menu_items_tbl.c.category_id.isnot(None))).all()
        for row in existing_items:
            bind.execute(menu_item_cats_tbl.insert().values(menu_item_id=row[0], category_id=row[1]))

    if "custom_menu_item_categories" not in tables:
        op.create_table(
            "custom_menu_item_categories",
            sa.Column("custom_item_id", sa.Integer(), sa.ForeignKey("custom_menu_items.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("category_id", sa.Integer(), sa.ForeignKey("menu_categories.id", ondelete="CASCADE"), primary_key=True),
        )
        custom_tbl = sa.Table("custom_menu_items", sa.MetaData(), autoload_with=bind)
        custom_cats_tbl = sa.Table("custom_menu_item_categories", sa.MetaData(), autoload_with=bind)
        existing_custom = bind.execute(sa.select(custom_tbl.c.id, custom_tbl.c.category_id).where(custom_tbl.c.category_id.isnot(None))).all()
        for row in existing_custom:
            bind.execute(custom_cats_tbl.insert().values(custom_item_id=row[0], category_id=row[1]))


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = insp.get_table_names()

    if "custom_menu_item_categories" in tables:
        op.drop_table("custom_menu_item_categories")
    if "menu_item_categories" in tables:
        op.drop_table("menu_item_categories")
