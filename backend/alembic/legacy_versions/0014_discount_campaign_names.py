"""Add optional names to discount campaigns."""
import sqlalchemy as sa
from alembic import op

revision = "0014_discount_campaign_names"
down_revision = "0013_discount_campaigns"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "menu_discounts",
        sa.Column("campaign_name", sa.String(length=80), nullable=True),
    )


def downgrade() -> None:
    with op.batch_alter_table("menu_discounts") as batch_op:
        batch_op.drop_column("campaign_name")
