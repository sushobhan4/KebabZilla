"""Require provisioned staff to change their first password."""

import sqlalchemy as sa
from alembic import op


revision = "0015_require_provisioned_password_change"
down_revision = "0014_discount_campaign_names"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "accounts",
        sa.Column("must_change_password", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    with op.batch_alter_table("accounts") as batch_op:
        batch_op.drop_column("must_change_password")
