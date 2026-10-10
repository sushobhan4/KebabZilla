"""Add distance calculation modes, driver geofencing, and driver duty status.

Revision ID: 0028_distance_modes_and_driver_dispatch
Revises: 0027_user_sessions
"""

import sqlalchemy as sa
from alembic import op

revision = "0028_distance_modes_and_driver_dispatch"
down_revision = "0027_user_sessions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("restaurant_settings") as batch_op:
        batch_op.add_column(sa.Column("distance_calculation_mode", sa.String(length=20), nullable=False, server_default="AUTO"))
        batch_op.add_column(sa.Column("enforce_driver_geofence", sa.Boolean(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("driver_geofence_meters", sa.Integer(), nullable=False, server_default="500"))

    with op.batch_alter_table("accounts") as batch_op:
        batch_op.add_column(sa.Column("is_accepting_deliveries", sa.Boolean(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("last_driver_latitude", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("last_driver_longitude", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("driver_status_updated_at", sa.DateTime(timezone=True), nullable=True))

    with op.batch_alter_table("orders") as batch_op:
        batch_op.add_column(sa.Column("delivery_address", sa.String(length=300), nullable=True))
        batch_op.add_column(sa.Column("latitude", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("longitude", sa.Float(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("orders") as batch_op:
        batch_op.drop_column("longitude")
        batch_op.drop_column("latitude")
        batch_op.drop_column("delivery_address")

    with op.batch_alter_table("accounts") as batch_op:
        batch_op.drop_column("driver_status_updated_at")
        batch_op.drop_column("last_driver_longitude")
        batch_op.drop_column("last_driver_latitude")
        batch_op.drop_column("is_accepting_deliveries")

    with op.batch_alter_table("restaurant_settings") as batch_op:
        batch_op.drop_column("driver_geofence_meters")
        batch_op.drop_column("enforce_driver_geofence")
        batch_op.drop_column("distance_calculation_mode")
