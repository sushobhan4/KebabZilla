"""Remove tax and legacy discount fields from menu items."""

import sqlalchemy as sa
from alembic import op

revision = "0020_remove_menu_tax_and_legacy_discounts"
down_revision = "0019_password_reset_codes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("menu_items") as batch:
        batch.drop_column("tax_percent")
        batch.drop_column("discounted_price_paise")
        batch.drop_column("discount_percent")


def downgrade() -> None:
    with op.batch_alter_table("menu_items") as batch:
        batch.add_column(sa.Column("discount_percent", sa.Integer(), nullable=False, server_default="0"))
        batch.add_column(sa.Column("discounted_price_paise", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("tax_percent", sa.Integer(), nullable=False, server_default="18"))
