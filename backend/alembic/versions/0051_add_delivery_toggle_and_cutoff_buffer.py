"""Add is_delivery_open and order_cutoff_minutes_before_closing to restaurant_settings.

Revision ID: 0051_add_delivery_toggle_and_cutoff_buffer
Revises: 0050_add_promotional_consent_to_accounts
Create Date: 2026-10-17 19:40:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "0051_add_delivery_toggle_and_cutoff_buffer"
down_revision = "0050_add_promotional_consent_to_accounts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    if "restaurant_settings" in inspector.get_table_names():
        cols = {c["name"] for c in inspector.get_columns("restaurant_settings")}
        with op.batch_alter_table("restaurant_settings") as batch_op:
            if "is_delivery_open" not in cols:
                batch_op.add_column(
                    sa.Column(
                        "is_delivery_open",
                        sa.Boolean(),
                        nullable=False,
                        server_default=sa.true(),
                    )
                )
            if "order_cutoff_minutes_before_closing" not in cols:
                batch_op.add_column(
                    sa.Column(
                        "order_cutoff_minutes_before_closing",
                        sa.Integer(),
                        nullable=False,
                        server_default="30",
                    )
                )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    if "restaurant_settings" in inspector.get_table_names():
        cols = {c["name"] for c in inspector.get_columns("restaurant_settings")}
        with op.batch_alter_table("restaurant_settings") as batch_op:
            if "order_cutoff_minutes_before_closing" in cols:
                batch_op.drop_column("order_cutoff_minutes_before_closing")
            if "is_delivery_open" in cols:
                batch_op.drop_column("is_delivery_open")
