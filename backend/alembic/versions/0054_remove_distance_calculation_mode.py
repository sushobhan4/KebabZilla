"""Remove distance_calculation_mode from restaurant_settings.

Revision ID: 0054_remove_distance_calculation_mode
Revises: 0053_add_delivery_paused_until
Create Date: 2026-10-18 17:05:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "0054_remove_distance_calculation_mode"
down_revision = "0053_add_delivery_paused_until"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    if "restaurant_settings" in inspector.get_table_names():
        cols = {c["name"] for c in inspector.get_columns("restaurant_settings")}
        with op.batch_alter_table("restaurant_settings") as batch_op:
            if "distance_calculation_mode" in cols:
                batch_op.drop_column("distance_calculation_mode")


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    if "restaurant_settings" in inspector.get_table_names():
        cols = {c["name"] for c in inspector.get_columns("restaurant_settings")}
        with op.batch_alter_table("restaurant_settings") as batch_op:
            if "distance_calculation_mode" not in cols:
                batch_op.add_column(
                    sa.Column(
                        "distance_calculation_mode",
                        sa.String(length=20),
                        nullable=False,
                        server_default="AUTO",
                    )
                )
