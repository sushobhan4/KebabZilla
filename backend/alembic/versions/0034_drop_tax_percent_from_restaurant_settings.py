"""Drop tax_percent column from restaurant_settings table.

Revision ID: 0034_drop_tax_percent_from_restaurant_settings
Revises: 0033_discount_custom_menu_items
Create Date: 2026-10-10 03:15:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "0034_drop_tax_percent_from_restaurant_settings"
down_revision = "0033_discount_custom_menu_items"
branch_labels = None
depends_on = None

def upgrade() -> None:
    bind = op.get_bind()
    cols = [x[1] for x in bind.execute(sa.text("PRAGMA table_info(restaurant_settings)")).fetchall()]
    if "tax_percent" in cols:
        with op.batch_alter_table("restaurant_settings") as batch:
            batch.drop_column("tax_percent")

def downgrade() -> None:
    with op.batch_alter_table("restaurant_settings") as batch:
        batch.add_column(
            sa.Column("tax_percent", sa.Integer(), nullable=False, server_default="18")
        )
