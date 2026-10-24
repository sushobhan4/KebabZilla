"""Add email to restaurant_settings.

Revision ID: 0052_add_email_to_restaurant_settings
Revises: 0051_add_delivery_toggle_and_cutoff_buffer
Create Date: 2026-10-18 08:20:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "0052_add_email_to_restaurant_settings"
down_revision = "0051_add_delivery_toggle_and_cutoff_buffer"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    if "restaurant_settings" in inspector.get_table_names():
        cols = {c["name"] for c in inspector.get_columns("restaurant_settings")}
        with op.batch_alter_table("restaurant_settings") as batch_op:
            if "email" not in cols:
                batch_op.add_column(
                    sa.Column(
                        "email",
                        sa.String(length=255),
                        nullable=False,
                        server_default="support@kebabzilla.in",
                    )
                )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    if "restaurant_settings" in inspector.get_table_names():
        cols = {c["name"] for c in inspector.get_columns("restaurant_settings")}
        with op.batch_alter_table("restaurant_settings") as batch_op:
            if "email" in cols:
                batch_op.drop_column("email")
