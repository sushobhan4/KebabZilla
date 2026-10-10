"""Add custom_menu_item_id to menu_discount_items.

Revision ID: 0033_discount_custom_menu_items
Revises: 0032_expand_restaurant_phone
Create Date: 2026-10-10 03:05:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "0033_discount_custom_menu_items"
down_revision = "0032_expand_restaurant_phone"
branch_labels = None
depends_on = None

def upgrade() -> None:
    bind = op.get_bind()
    cols = [x[1] for x in bind.execute(sa.text("PRAGMA table_info(menu_discount_items)")).fetchall()]
    if "custom_menu_item_id" not in cols:
        with op.batch_alter_table("menu_discount_items") as batch:
            batch.add_column(
                sa.Column("custom_menu_item_id", sa.Integer(), nullable=True)
            )
            batch.alter_column("menu_item_id", existing_type=sa.Integer(), nullable=True)
            batch.create_foreign_key(
                "fk_menu_discount_items_custom_menu_item_id",
                "custom_menu_items",
                ["custom_menu_item_id"],
                ["id"],
                ondelete="CASCADE",
            )
            batch.create_index(
                "ix_menu_discount_items_custom_menu_item_id",
                ["custom_menu_item_id"],
            )

def downgrade() -> None:
    with op.batch_alter_table("menu_discount_items") as batch:
        batch.drop_index("ix_menu_discount_items_custom_menu_item_id")
        batch.drop_constraint("fk_menu_discount_items_custom_menu_item_id", type_="foreignkey")
        batch.drop_column("custom_menu_item_id")
        batch.alter_column("menu_item_id", existing_type=sa.Integer(), nullable=False)
