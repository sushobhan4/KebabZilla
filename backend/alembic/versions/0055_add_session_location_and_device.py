"""Add location and device columns to user_sessions.

Revision ID: 0055_add_session_location_and_device
Revises: 0054_remove_distance_calculation_mode
Create Date: 2026-10-18 20:30:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "0055_add_session_location_and_device"
down_revision = "0054_remove_distance_calculation_mode"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    if "user_sessions" in inspector.get_table_names():
        cols = {c["name"] for c in inspector.get_columns("user_sessions")}
        with op.batch_alter_table("user_sessions") as batch_op:
            if "device_name" not in cols:
                batch_op.add_column(
                    sa.Column("device_name", sa.String(length=128), nullable=False, server_default="")
                )
            if "country" not in cols:
                batch_op.add_column(
                    sa.Column("country", sa.String(length=64), nullable=False, server_default="")
                )
            if "region" not in cols:
                batch_op.add_column(
                    sa.Column("region", sa.String(length=64), nullable=False, server_default="")
                )
            if "city" not in cols:
                batch_op.add_column(
                    sa.Column("city", sa.String(length=64), nullable=False, server_default="")
                )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    if "user_sessions" in inspector.get_table_names():
        cols = {c["name"] for c in inspector.get_columns("user_sessions")}
        with op.batch_alter_table("user_sessions") as batch_op:
            if "city" in cols:
                batch_op.drop_column("city")
            if "region" in cols:
                batch_op.drop_column("region")
            if "country" in cols:
                batch_op.drop_column("country")
            if "device_name" in cols:
                batch_op.drop_column("device_name")
