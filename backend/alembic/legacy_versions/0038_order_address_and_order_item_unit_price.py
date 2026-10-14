"""Add address and coordinates to orders, and unit_price_paise to order_items.

Revision ID: 0038_order_address_and_order_item_unit_price
Revises: 0037_admin_override_schedule_refresh
Create Date: 2026-10-11 22:55:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "0038_order_address_and_order_item_unit_price"
down_revision = "0037_admin_override_schedule_refresh"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    order_cols = [c["name"] for c in insp.get_columns("orders")]
    with op.batch_alter_table("orders") as batch:
        if "address" not in order_cols:
            batch.add_column(sa.Column("address", sa.Text(), nullable=False, server_default=""))
        if "latitude" not in order_cols:
            batch.add_column(sa.Column("latitude", sa.Float(), nullable=True))
        if "longitude" not in order_cols:
            batch.add_column(sa.Column("longitude", sa.Float(), nullable=True))

    order_item_cols = [c["name"] for c in insp.get_columns("order_items")]
    with op.batch_alter_table("order_items") as batch:
        if "unit_price_paise" not in order_item_cols:
            batch.add_column(sa.Column("unit_price_paise", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    with op.batch_alter_table("order_items") as batch:
        batch.drop_column("unit_price_paise")

    with op.batch_alter_table("orders") as batch:
        batch.drop_column("longitude")
        batch.drop_column("latitude")
        batch.drop_column("address")
