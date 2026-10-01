"""Add scheduled menu discounts.

Revision ID: 0012_scheduled_menu_discounts
Revises: 0011_remove_legacy_opening_hours
"""
import sqlalchemy as sa
from alembic import op

revision = "0012_scheduled_menu_discounts"
down_revision = "0011_remove_legacy_opening_hours"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "menu_discounts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("menu_item_id", sa.Integer(), sa.ForeignKey("menu_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("discount_percent", sa.Integer(), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_menu_discounts_menu_item_id", "menu_discounts", ["menu_item_id"])
    op.create_index("ix_menu_discounts_starts_at", "menu_discounts", ["starts_at"])
    op.create_index("ix_menu_discounts_ends_at", "menu_discounts", ["ends_at"])


def downgrade() -> None:
    op.drop_index("ix_menu_discounts_ends_at", table_name="menu_discounts")
    op.drop_index("ix_menu_discounts_starts_at", table_name="menu_discounts")
    op.drop_index("ix_menu_discounts_menu_item_id", table_name="menu_discounts")
    op.drop_table("menu_discounts")
