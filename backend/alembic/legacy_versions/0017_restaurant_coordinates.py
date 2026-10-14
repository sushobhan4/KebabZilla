"""Store a precise restaurant map location."""

import sqlalchemy as sa
from alembic import op

revision = "0017_restaurant_coordinates"
down_revision = "0016_offer_log_details"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("restaurant_settings", sa.Column("latitude", sa.Float(), nullable=True))
    op.add_column("restaurant_settings", sa.Column("longitude", sa.Float(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("restaurant_settings") as batch_op:
        batch_op.drop_column("longitude")
        batch_op.drop_column("latitude")
