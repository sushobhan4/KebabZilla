"""Add promotional_consent to accounts table.

Revision ID: 0050_add_promotional_consent_to_accounts
Revises: 0049_remove_redundancy_and_legacy_tables
Create Date: 2026-10-17 03:20:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "0050_add_promotional_consent_to_accounts"
down_revision = "0049_remove_redundancy_and_legacy_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    if "accounts" in inspector.get_table_names():
        cols = {c["name"] for c in inspector.get_columns("accounts")}
        if "promotional_consent" not in cols:
            with op.batch_alter_table("accounts") as batch_op:
                batch_op.add_column(
                    sa.Column(
                        "promotional_consent",
                        sa.Boolean(),
                        nullable=False,
                        server_default=sa.true(),
                    )
                )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    if "accounts" in inspector.get_table_names():
        cols = {c["name"] for c in inspector.get_columns("accounts")}
        if "promotional_consent" in cols:
            with op.batch_alter_table("accounts") as batch_op:
                batch_op.drop_column("promotional_consent")
