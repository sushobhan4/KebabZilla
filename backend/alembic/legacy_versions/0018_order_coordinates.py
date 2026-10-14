"""Store delivery coordinates with each order."""

import sqlalchemy as sa
from alembic import op

revision = "0018_order_coordinates"
down_revision = "0017_restaurant_coordinates"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("latitude", sa.Float(), nullable=True))
    op.add_column("orders", sa.Column("longitude", sa.Float(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("orders") as batch_op:
        batch_op.drop_column("longitude")
        batch_op.drop_column("latitude")
