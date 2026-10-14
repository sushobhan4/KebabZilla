"""Add custom menu items with addon sections."""

from alembic import op
import sqlalchemy as sa

revision = "0025_custom_menu_items"
down_revision = "0024_remove_account_active_and_flat_delivery_fee"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "custom_menu_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False, index=True),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("category_id", sa.Integer(), sa.ForeignKey("menu_categories.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("base_price_paise", sa.Integer(), nullable=False),
        sa.Column("image_urls", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("is_vegetarian", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("is_available", sa.Boolean(), nullable=False, server_default="1", index=True),
        sa.Column("is_featured", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "custom_menu_sections",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("item_id", sa.Integer(), sa.ForeignKey("custom_menu_items.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("options", sa.JSON(), nullable=False, server_default="[]"),
    )


def downgrade() -> None:
    op.drop_table("custom_menu_sections")
    op.drop_table("custom_menu_items")
