"""Make tax editable per menu item.

Revision ID: 0005_per_menu_tax
Revises: 0004_walkin_orders_without_accounts
"""
from alembic import op
import sqlalchemy as sa


revision = "0005_per_menu_tax"
down_revision = "0004_walkin_orders_without_accounts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    menu_columns = {column["name"] for column in sa.inspect(bind).get_columns("menu_items")}
    order_columns = {column["name"] for column in sa.inspect(bind).get_columns("order_items")}
    if "tax_percent" not in menu_columns:
        op.add_column("menu_items", sa.Column("tax_percent", sa.Integer(), nullable=False, server_default="18"))
    if "tax_percent" not in order_columns:
        op.add_column("order_items", sa.Column("tax_percent", sa.Integer(), nullable=False, server_default="18"))
    if "restaurant_settings" in sa.inspect(bind).get_table_names():
        legacy_tax = bind.execute(sa.text("SELECT tax_percent FROM restaurant_settings ORDER BY id LIMIT 1")).scalar()
        if legacy_tax is not None:
            bind.execute(sa.text("UPDATE order_items SET tax_percent = :rate"), {"rate": int(legacy_tax)})


def downgrade() -> None:
    op.drop_column("order_items", "tax_percent")
    op.drop_column("menu_items", "tax_percent")
