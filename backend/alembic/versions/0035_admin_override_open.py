"""Add admin_override_open to restaurant_settings.

Revision ID: 0035_admin_override_open
Revises: 0034_drop_tax_percent_from_restaurant_settings
Create Date: 2026-10-10 06:30:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "0035_admin_override_open"
down_revision = "0034_drop_tax_percent_from_restaurant_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    cols = [x[1] for x in bind.execute(sa.text("PRAGMA table_info(restaurant_settings)")).fetchall()]
    if "admin_override_open" not in cols:
        with op.batch_alter_table("restaurant_settings") as batch:
            batch.add_column(
                sa.Column("admin_override_open", sa.Boolean(), nullable=False, server_default="0")
            )


def downgrade() -> None:
    with op.batch_alter_table("restaurant_settings") as batch:
        batch.drop_column("admin_override_open")
