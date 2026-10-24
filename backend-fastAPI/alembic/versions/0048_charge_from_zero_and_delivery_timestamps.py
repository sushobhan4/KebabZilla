"""Add charge_from_zero_beyond_free_radius and delivery_started_at columns.

Revision ID: 0048_charge_from_zero_and_delivery_timestamps
Revises: 0047_delivery_algorithm_settings
Create Date: 2026-10-16 03:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "0048_charge_from_zero_and_delivery_timestamps"
down_revision = "0047_delivery_algorithm_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    cols = {c["name"] for c in inspector.get_columns("restaurant_settings")}

    if "charge_from_zero_beyond_free_radius" not in cols:
        op.add_column(
            "restaurant_settings",
            sa.Column(
                "charge_from_zero_beyond_free_radius",
                sa.Boolean(),
                server_default=sa.text("false"),
                nullable=True,
            ),
        )

    order_cols = {c["name"] for c in inspector.get_columns("orders")}
    if "delivery_started_at" not in order_cols:
        op.add_column(
            "orders",
            sa.Column("delivery_started_at", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    pass
