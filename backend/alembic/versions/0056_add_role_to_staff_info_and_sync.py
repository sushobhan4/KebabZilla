"""Add role column to staff_info, synchronize staff records, and merge password_reset_codes into email_verification_codes.

Revision ID: 0056_add_role_to_staff_info_and_sync
Revises: 0055_add_session_location_and_device
Create Date: 2026-10-22 22:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "0056_add_role_to_staff_info_and_sync"
down_revision = "0055_add_session_location_and_device"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    # --- Part 1: staff_info role synchronization ---
    if "staff_info" in tables:
        cols = {c["name"] for c in inspector.get_columns("staff_info")}
        with op.batch_alter_table("staff_info") as batch_op:
            if "role" not in cols:
                batch_op.add_column(sa.Column("role", sa.String(16), nullable=True))

        # 1. Clean up non-staff (USER) accounts from staff_info
        op.execute(
            "DELETE FROM staff_info WHERE account_id IN (SELECT id FROM accounts WHERE role = 'USER')"
        )

        # 2. Insert missing staff rows
        op.execute(
            "INSERT INTO staff_info (account_id, role, is_accepting_deliveries, must_change_password, updated_at) "
            "SELECT id, role, 0, 0, CURRENT_TIMESTAMP "
            "FROM accounts "
            "WHERE role != 'USER' AND id NOT IN (SELECT account_id FROM staff_info)"
        )

        # 3. Synchronize roles
        op.execute(
            "UPDATE staff_info "
            "SET role = (SELECT role FROM accounts WHERE accounts.id = staff_info.account_id) "
            "WHERE role IS NULL OR role != (SELECT role FROM accounts WHERE accounts.id = staff_info.account_id)"
        )

        # 4. Reset is_accepting_deliveries for staff who cannot deliver
        op.execute(
            "UPDATE staff_info "
            "SET is_accepting_deliveries = 0 "
            "WHERE is_accepting_deliveries = 1 "
            "AND account_id IN (SELECT id FROM accounts WHERE role NOT IN ('DELIVERY', 'ADMIN'))"
        )

    # --- Part 2: Merge password_reset_codes into email_verification_codes ---
    if "email_verification_codes" in tables:
        ev_cols = {c["name"] for c in inspector.get_columns("email_verification_codes")}
        with op.batch_alter_table("email_verification_codes") as batch_op:
            if "account_id" not in ev_cols:
                batch_op.add_column(sa.Column("account_id", sa.Integer(), nullable=True))

    if "password_reset_codes" in tables:
        try:
            op.execute("""
                INSERT INTO email_verification_codes (email, account_id, otp_hash, purpose, expires_at, attempts, created_at)
                SELECT accounts.email, prc.account_id, prc.otp_hash, 'password_reset', prc.expires_at, prc.attempts, prc.created_at
                FROM password_reset_codes prc
                JOIN accounts ON accounts.id = prc.account_id
                WHERE prc.expires_at > CURRENT_TIMESTAMP
            """)
        except Exception:
            pass
        op.drop_table("password_reset_codes")


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    if "staff_info" in tables:
        cols = {c["name"] for c in inspector.get_columns("staff_info")}
        if "role" in cols:
            with op.batch_alter_table("staff_info") as batch_op:
                batch_op.drop_column("role")

    if "email_verification_codes" in tables:
        ev_cols = {c["name"] for c in inspector.get_columns("email_verification_codes")}
        if "account_id" in ev_cols:
            with op.batch_alter_table("email_verification_codes") as batch_op:
                batch_op.drop_column("account_id")
