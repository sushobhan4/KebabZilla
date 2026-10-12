"""Add admin_override_state and admin_override_until to restaurant_settings.

Revision ID: 0037_admin_override_schedule_refresh
Revises: 0036_delivery_duty_table
Create Date: 2026-10-10 15:10:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "0037_admin_override_schedule_refresh"
down_revision = "0036_delivery_duty_table"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    cols = [c["name"] for c in insp.get_columns("restaurant_settings")]
    with op.batch_alter_table("restaurant_settings") as batch:
        if "admin_override_state" not in cols:
            batch.add_column(
                sa.Column("admin_override_state", sa.Boolean(), nullable=True)
            )
        if "admin_override_until" not in cols:
            batch.add_column(
                sa.Column("admin_override_until", sa.DateTime(timezone=True), nullable=True)
            )


def downgrade() -> None:
    with op.batch_alter_table("restaurant_settings") as batch:
        batch.drop_column("admin_override_until")
        batch.drop_column("admin_override_state")
