"""Remove account activation state and the legacy flat delivery fee."""

from alembic import op
import sqlalchemy as sa


revision = "0024_remove_account_active_and_flat_delivery_fee"
down_revision = "0023_normalize_menu_accounts_delivery"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("accounts") as batch:
        batch.drop_index("ix_accounts_is_active")
        batch.drop_column("is_active")
    with op.batch_alter_table("restaurant_settings") as batch:
        batch.drop_column("delivery_fee_paise")


def downgrade() -> None:
    raise NotImplementedError("This migration intentionally removes obsolete columns.")
