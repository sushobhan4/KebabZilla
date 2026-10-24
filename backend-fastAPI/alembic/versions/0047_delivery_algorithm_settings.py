"""Add delivery algorithm parameters to restaurant_settings.

Revision ID: 0047_delivery_algorithm_settings
Revises: 0046_drop_prices_and_custom_ids
Create Date: 2026-10-16 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "0047_delivery_algorithm_settings"
down_revision = "0046_drop_prices_and_custom_ids"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    cols = {c["name"] for c in inspector.get_columns("restaurant_settings")}

    if "average_delivery_speed_kmh" not in cols:
        op.add_column("restaurant_settings", sa.Column("average_delivery_speed_kmh", sa.Float(), server_default="30.0", nullable=True))
    if "customer_sla_minutes" not in cols:
        op.add_column("restaurant_settings", sa.Column("customer_sla_minutes", sa.Float(), server_default="36.0", nullable=True))
    if "alns_max_iterations_mode" not in cols:
        op.add_column("restaurant_settings", sa.Column("alns_max_iterations_mode", sa.String(10), server_default="AUTO", nullable=True))
    if "alns_max_iterations" not in cols:
        op.add_column("restaurant_settings", sa.Column("alns_max_iterations", sa.Integer(), server_default="220", nullable=True))
    if "max_orders_per_driver" not in cols:
        op.add_column("restaurant_settings", sa.Column("max_orders_per_driver", sa.Integer(), server_default="5", nullable=True))
    if "charge_from_zero_beyond_free_radius" not in cols:
        op.add_column("restaurant_settings", sa.Column("charge_from_zero_beyond_free_radius", sa.Boolean(), server_default="0", nullable=True))

    order_cols = {c["name"] for c in inspector.get_columns("orders")}
    if "delivery_started_at" not in order_cols:
        op.add_column("orders", sa.Column("delivery_started_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    pass
