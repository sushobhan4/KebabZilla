"""Store walk-in contact snapshots on orders rather than user accounts.

Revision ID: 0004_walkin_orders_without_accounts
Revises: 0003_delivery_otp_ciphertext
"""
from alembic import op
import sqlalchemy as sa


revision = "0004_walkin_orders_without_accounts"
down_revision = "0003_delivery_otp_ciphertext"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"]: column for column in sa.inspect(bind).get_columns("orders")}
    if "customer_name" not in columns:
        op.add_column("orders", sa.Column("customer_name", sa.String(length=120), nullable=True))
    if "customer_email" not in columns:
        op.add_column("orders", sa.Column("customer_email", sa.String(length=255), nullable=True))
    if "customer_phone" not in columns:
        op.add_column("orders", sa.Column("customer_phone", sa.String(length=32), nullable=True))

    bind.execute(sa.text("""
        UPDATE orders SET
            customer_name = COALESCE(customer_name, (SELECT name FROM accounts WHERE accounts.id = orders.customer_id)),
            customer_email = COALESCE(customer_email, (SELECT email FROM accounts WHERE accounts.id = orders.customer_id)),
            customer_phone = COALESCE(customer_phone, (SELECT phone FROM accounts WHERE accounts.id = orders.customer_id))
        WHERE customer_id IS NOT NULL
    """))

    if not columns.get("customer_id", {}).get("nullable", False):
        with op.batch_alter_table("orders") as batch_op:
            batch_op.alter_column("customer_id", existing_type=sa.Integer(), existing_nullable=False, nullable=True)

    guest_ids = bind.execute(sa.text(
        "SELECT id FROM accounts WHERE role = 'USER' AND email LIKE 'walkin-%@guest.kebabzilla.local'"
    )).all()
    if guest_ids:
        bind.execute(sa.text("""
            UPDATE orders SET customer_id = NULL
            WHERE customer_id IN (SELECT id FROM accounts WHERE role = 'USER' AND email LIKE 'walkin-%@guest.kebabzilla.local')
        """))
        bind.execute(sa.text(
            "DELETE FROM accounts WHERE role = 'USER' AND email LIKE 'walkin-%@guest.kebabzilla.local'"
        ))


def downgrade() -> None:
    op.drop_column("orders", "customer_phone")
    op.drop_column("orders", "customer_email")
    op.drop_column("orders", "customer_name")
