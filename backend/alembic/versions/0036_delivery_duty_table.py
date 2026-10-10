"""Create delivery_duty table and move is_accepting_deliveries from accounts.

Revision ID: 0036_delivery_duty_table
Revises: 0035_admin_override_open
Create Date: 2026-10-10 06:40:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "0036_delivery_duty_table"
down_revision = "0035_admin_override_open"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "delivery_duty",
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("is_accepting_deliveries", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    bind = op.get_bind()
    cols = [x[1] for x in bind.execute(sa.text("PRAGMA table_info(accounts)")).fetchall()]
    if "is_accepting_deliveries" in cols:
        op.execute(
            sa.text(
                "INSERT INTO delivery_duty (account_id, is_accepting_deliveries) "
                "SELECT id, is_accepting_deliveries FROM accounts WHERE role IN ('ADMIN', 'DELIVERY')"
            )
        )
        with op.batch_alter_table("accounts") as batch:
            batch.drop_column("is_accepting_deliveries")


def downgrade() -> None:
    with op.batch_alter_table("accounts") as batch:
        batch.add_column(
            sa.Column("is_accepting_deliveries", sa.Boolean(), nullable=False, server_default="0")
        )
    op.execute(
        sa.text(
            "UPDATE accounts SET is_accepting_deliveries = ("
            "SELECT is_accepting_deliveries FROM delivery_duty WHERE delivery_duty.account_id = accounts.id"
            ") WHERE id IN (SELECT account_id FROM delivery_duty)"
        )
    )
    op.drop_table("delivery_duty")
