"""Consolidate all OTPs into all_otp table and rename two_factor_challenges.

Revision ID: 0057_create_all_otp_table_and_migrate
Revises: 0056_add_role_to_staff_info_and_sync
Create Date: 2026-10-23 07:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "0057_create_all_otp_table_and_migrate"
down_revision = "0056_add_role_to_staff_info_and_sync"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    # 1. Rename two_factor_challenges -> all_otp or create all_otp
    if "two_factor_challenges" in tables and "all_otp" not in tables:
        op.rename_table("two_factor_challenges", "all_otp")
        # Refresh tables list
        tables = [t for t in tables if t != "two_factor_challenges"] + ["all_otp"]
    elif "all_otp" not in tables:
        op.create_table(
            "all_otp",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("purpose", sa.String(32), nullable=False, server_default="2fa"),
            sa.Column("otp_code", sa.String(255), nullable=False),
            sa.Column("token_hash", sa.String(64), nullable=True, unique=True),
            sa.Column("account_id", sa.Integer(), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=True),
            sa.Column("email", sa.String(255), nullable=True),
            sa.Column("order_id", sa.String(20), sa.ForeignKey("orders.order_id", ondelete="CASCADE"), nullable=True),
            sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        )
        tables.append("all_otp")

    # 2. Ensure all columns exist on all_otp
    if "all_otp" in tables:
        inspector = sa.inspect(conn)
        cols = {c["name"] for c in inspector.get_columns("all_otp")}
        with op.batch_alter_table("all_otp") as batch_op:
            if "purpose" not in cols:
                batch_op.add_column(sa.Column("purpose", sa.String(32), nullable=False, server_default="2fa"))
            if "otp_code" not in cols:
                batch_op.add_column(sa.Column("otp_code", sa.String(255), nullable=True))
            if "email" not in cols:
                batch_op.add_column(sa.Column("email", sa.String(255), nullable=True))
            if "order_id" not in cols:
                batch_op.add_column(sa.Column("order_id", sa.String(20), nullable=True))
            # Relax nullability if originally from two_factor_challenges
            if "account_id" in cols:
                batch_op.alter_column("account_id", nullable=True)
            if "token_hash" in cols:
                batch_op.alter_column("token_hash", nullable=True)

        # Migrate code_hash -> otp_code if present
        if "code_hash" in cols:
            op.execute("UPDATE all_otp SET otp_code = code_hash WHERE otp_code IS NULL AND code_hash IS NOT NULL")
            with op.batch_alter_table("all_otp") as batch_op:
                batch_op.drop_column("code_hash")
        if "is_verified" in cols:
            with op.batch_alter_table("all_otp") as batch_op:
                batch_op.drop_column("is_verified")
        op.execute("UPDATE all_otp SET purpose = '2fa' WHERE purpose IS NULL")

        # Create indexes
        indexes = {idx["name"] for idx in inspector.get_indexes("all_otp")}
        if "ix_all_otp_purpose" not in indexes:
            try:
                op.create_index("ix_all_otp_purpose", "all_otp", ["purpose"])
            except Exception:
                pass
        if "ix_all_otp_email" not in indexes:
            try:
                op.create_index("ix_all_otp_email", "all_otp", ["email"])
            except Exception:
                pass
        if "ix_all_otp_order_id" not in indexes:
            try:
                op.create_index("ix_all_otp_order_id", "all_otp", ["order_id"])
            except Exception:
                pass
        if "ix_all_otp_expires_at" not in indexes:
            try:
                op.create_index("ix_all_otp_expires_at", "all_otp", ["expires_at"])
            except Exception:
                pass

    # 3. Migrate active rows from email_verification_codes
    if "email_verification_codes" in tables:
        try:
            op.execute("""
                INSERT INTO all_otp (email, account_id, otp_code, purpose, expires_at, attempts, created_at)
                SELECT email, account_id, otp_hash, COALESCE(purpose, 'register'), expires_at, attempts, created_at
                FROM email_verification_codes
                WHERE expires_at > CURRENT_TIMESTAMP
            """)
        except Exception:
            pass
        op.drop_table("email_verification_codes")

    # 4. Migrate active rows from password_reset_codes (if any lingering)
    if "password_reset_codes" in tables:
        try:
            op.execute("""
                INSERT INTO all_otp (email, account_id, otp_code, purpose, expires_at, attempts, created_at)
                SELECT accounts.email, prc.account_id, prc.otp_hash, 'forgot_password', prc.expires_at, prc.attempts, prc.created_at
                FROM password_reset_codes prc
                JOIN accounts ON accounts.id = prc.account_id
                WHERE prc.expires_at > CURRENT_TIMESTAMP
            """)
        except Exception:
            pass
        op.drop_table("password_reset_codes")

    # 5. Prune any expired rows immediately
    try:
        op.execute("DELETE FROM all_otp WHERE expires_at <= CURRENT_TIMESTAMP")
    except Exception:
        pass


def downgrade() -> None:
    pass
