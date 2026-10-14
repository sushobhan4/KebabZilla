"""Add saved customer carts.

Revision ID: 0010_saved_customer_carts
Revises: 0009_operations_features
"""
import sqlalchemy as sa
from alembic import op

revision = "0010_saved_customer_carts"
down_revision = "0009_operations_features"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "cart_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("customer_id", sa.Integer(), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("menu_item_id", sa.Integer(), sa.ForeignKey("menu_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("customer_id", "menu_item_id"),
    )
    op.create_index("ix_cart_items_customer_id", "cart_items", ["customer_id"])
    op.create_index("ix_cart_items_menu_item_id", "cart_items", ["menu_item_id"])


def downgrade() -> None:
    op.drop_index("ix_cart_items_menu_item_id", table_name="cart_items")
    op.drop_index("ix_cart_items_customer_id", table_name="cart_items")
    op.drop_table("cart_items")
