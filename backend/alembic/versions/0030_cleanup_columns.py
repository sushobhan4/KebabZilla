"""Remove obsolete columns from accounts, orders, and order_items.

Revision ID: 0030_cleanup_columns
Revises: 0029_haversine_routing_factor
"""

import sqlalchemy as sa
from alembic import op

revision = "0030_cleanup_columns"
down_revision = "0029_haversine_routing_factor"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("accounts") as batch_op:
        batch_op.drop_column("driver_status_updated_at")
        batch_op.drop_column("last_driver_longitude")
        batch_op.drop_column("last_driver_latitude")

    with op.batch_alter_table("orders") as batch_op:
        batch_op.drop_column("longitude")
        batch_op.drop_column("latitude")
        batch_op.drop_column("delivery_address")

    with op.batch_alter_table("order_items") as batch_op:
        batch_op.drop_column("unit_price_paise")


def downgrade() -> None:
    with op.batch_alter_table("order_items") as batch_op:
        batch_op.add_column(sa.Column("unit_price_paise", sa.Integer(), nullable=True))

    with op.batch_alter_table("orders") as batch_op:
        batch_op.add_column(sa.Column("delivery_address", sa.String(length=300), nullable=True))
        batch_op.add_column(sa.Column("latitude", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("longitude", sa.Float(), nullable=True))

    with op.batch_alter_table("accounts") as batch_op:
        batch_op.add_column(sa.Column("last_driver_latitude", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("last_driver_longitude", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("driver_status_updated_at", sa.DateTime(timezone=True), nullable=True))
