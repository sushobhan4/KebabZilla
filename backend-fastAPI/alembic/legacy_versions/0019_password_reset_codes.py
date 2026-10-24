"""Add one-time password reset codes."""

import sqlalchemy as sa
from alembic import op

revision = "0019_password_reset_codes"
down_revision = "0018_order_coordinates"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "password_reset_codes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("otp_hash", sa.String(length=255), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_password_reset_codes_account_id", "password_reset_codes", ["account_id"])
    op.create_index("ix_password_reset_codes_expires_at", "password_reset_codes", ["expires_at"])
    op.create_index("ix_password_reset_codes_created_at", "password_reset_codes", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_password_reset_codes_created_at", table_name="password_reset_codes")
    op.drop_index("ix_password_reset_codes_expires_at", table_name="password_reset_codes")
    op.drop_index("ix_password_reset_codes_account_id", table_name="password_reset_codes")
    op.drop_table("password_reset_codes")
