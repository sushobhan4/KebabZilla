"""Remove the legacy opening-hours field in favour of the weekly schedule.

Revision ID: 0011_remove_legacy_opening_hours
Revises: 0010_saved_customer_carts
"""
import sqlalchemy as sa
from alembic import op

revision = "0011_remove_legacy_opening_hours"
down_revision = "0010_saved_customer_carts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("restaurant_settings") as batch:
        batch.drop_column("opening_hours")


def downgrade() -> None:
    with op.batch_alter_table("restaurant_settings") as batch:
        batch.add_column(sa.Column("opening_hours", sa.String(length=120), nullable=False, server_default=""))
