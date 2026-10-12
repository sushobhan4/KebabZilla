"""Rename delivery_duty to staff_info, populate all staff, and move must_change_password from accounts.

Revision ID: 0039_rename_delivery_duty_to_staff_info
Revises: 0038_order_address_and_order_item_unit_price
Create Date: 2026-10-11 23:45:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "0039_rename_delivery_duty_to_staff_info"
down_revision = "0038_order_address_and_order_item_unit_price"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = insp.get_table_names()

    # 1. Rename delivery_duty to staff_info if it exists, or create staff_info table
    if "delivery_duty" in tables and "staff_info" not in tables:
        op.rename_table("delivery_duty", "staff_info")
    elif "staff_info" not in tables:
        op.create_table(
            "staff_info",
            sa.Column("account_id", sa.Integer(), sa.ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("is_accepting_deliveries", sa.Boolean(), nullable=False, server_default="0"),
            sa.Column("must_change_password", sa.Boolean(), nullable=False, server_default="0"),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        )

    # 2. Re-inspect staff_info columns
    insp = sa.inspect(bind)
    staff_cols = [c["name"] for c in insp.get_columns("staff_info")]
    if "must_change_password" not in staff_cols:
        with op.batch_alter_table("staff_info") as batch:
            batch.add_column(sa.Column("must_change_password", sa.Boolean(), nullable=False, server_default="0"))

    # 3. Migrate must_change_password from accounts to staff_info for existing staff rows if accounts has the column
    account_cols = [c["name"] for c in insp.get_columns("accounts")]
    if "must_change_password" in account_cols:
        op.execute(
            "UPDATE staff_info SET must_change_password = "
            "(SELECT must_change_password FROM accounts WHERE accounts.id = staff_info.account_id) "
            "WHERE EXISTS (SELECT 1 FROM accounts WHERE accounts.id = staff_info.account_id)"
        )

    # 4. Add all staff (every account where role != 'USER') to staff_info if not already present
    if "must_change_password" in account_cols:
        op.execute(
            "INSERT INTO staff_info (account_id, is_accepting_deliveries, must_change_password, updated_at) "
            "SELECT id, 0, COALESCE(must_change_password, 0), CURRENT_TIMESTAMP "
            "FROM accounts "
            "WHERE role != 'USER' AND id NOT IN (SELECT account_id FROM staff_info)"
        )
    else:
        op.execute(
            "INSERT INTO staff_info (account_id, is_accepting_deliveries, must_change_password, updated_at) "
            "SELECT id, 0, 0, CURRENT_TIMESTAMP "
            "FROM accounts "
            "WHERE role != 'USER' AND id NOT IN (SELECT account_id FROM staff_info)"
        )

    # 5. Remove must_change_password from accounts table
    if "must_change_password" in account_cols:
        with op.batch_alter_table("accounts") as batch:
            batch.drop_column("must_change_password")


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    account_cols = [c["name"] for c in insp.get_columns("accounts")]

    if "must_change_password" not in account_cols:
        with op.batch_alter_table("accounts") as batch:
            batch.add_column(sa.Column("must_change_password", sa.Boolean(), nullable=False, server_default="0"))

    tables = insp.get_table_names()
    if "staff_info" in tables:
        op.execute(
            "UPDATE accounts SET must_change_password = "
            "(SELECT must_change_password FROM staff_info WHERE staff_info.account_id = accounts.id) "
            "WHERE id IN (SELECT account_id FROM staff_info)"
        )
        if "delivery_duty" not in tables:
            op.rename_table("staff_info", "delivery_duty")
            with op.batch_alter_table("delivery_duty") as batch:
                batch.drop_column("must_change_password")
