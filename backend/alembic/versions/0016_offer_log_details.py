"""Store offer subjects and channel delivery totals."""

import sqlalchemy as sa
from alembic import op

revision = "0016_offer_log_details"
down_revision = "0015_require_provisioned_password_change"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("offer_logs", sa.Column("subject", sa.String(length=160), nullable=False, server_default="A little something from KebabZilla"))
    op.add_column("offer_logs", sa.Column("delivery_counts", sa.JSON(), nullable=False, server_default=sa.text("'{}'")))


def downgrade() -> None:
    with op.batch_alter_table("offer_logs") as batch_op:
        batch_op.drop_column("delivery_counts")
        batch_op.drop_column("subject")
