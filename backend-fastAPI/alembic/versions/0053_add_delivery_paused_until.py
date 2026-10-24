"""Add delivery_paused_until to restaurant_settings.

Revision ID: 0053_add_delivery_paused_until
Revises: 0052_add_email_to_restaurant_settings
Create Date: 2026-10-18 16:45:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "0053_add_delivery_paused_until"
down_revision = "0052_add_email_to_restaurant_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    if "restaurant_settings" in inspector.get_table_names():
        cols = {c["name"] for c in inspector.get_columns("restaurant_settings")}
        with op.batch_alter_table("restaurant_settings") as batch_op:
            if "delivery_paused_until" not in cols:
                batch_op.add_column(
                    sa.Column(
                        "delivery_paused_until",
                        sa.DateTime(timezone=True),
                        nullable=True,
                    )
                )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    if "restaurant_settings" in inspector.get_table_names():
        cols = {c["name"] for c in inspector.get_columns("restaurant_settings")}
        with op.batch_alter_table("restaurant_settings") as batch_op:
            if "delivery_paused_until" in cols:
                batch_op.drop_column("delivery_paused_until")
