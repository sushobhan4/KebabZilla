"""Add user_sessions table for 30-day rolling inactivity device sessions.

Revision ID: 0027_user_sessions
Revises: 0026_unify_custom_menu_and_order_customizations
"""

import sqlalchemy as sa
from alembic import op

revision = "0027_user_sessions"
down_revision = "0026_unify_custom_menu_and_order_customizations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_sessions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("user_agent", sa.String(length=512), nullable=False, server_default=""),
        sa.Column("ip_address", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("device_fingerprint", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_active_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_revoked", sa.Boolean(), nullable=False, server_default="0"),
    )
    op.create_index("ix_user_sessions_account_id", "user_sessions", ["account_id"])
    op.create_index("ix_user_sessions_token_hash", "user_sessions", ["token_hash"], unique=True)
    op.create_index("ix_user_sessions_last_active_at", "user_sessions", ["last_active_at"])
    op.create_index("ix_user_sessions_expires_at", "user_sessions", ["expires_at"])
    op.create_index("ix_user_sessions_is_revoked", "user_sessions", ["is_revoked"])


def downgrade() -> None:
    op.drop_index("ix_user_sessions_is_revoked", table_name="user_sessions")
    op.drop_index("ix_user_sessions_expires_at", table_name="user_sessions")
    op.drop_index("ix_user_sessions_last_active_at", table_name="user_sessions")
    op.drop_index("ix_user_sessions_token_hash", table_name="user_sessions")
    op.drop_index("ix_user_sessions_account_id", table_name="user_sessions")
    op.drop_table("user_sessions")
