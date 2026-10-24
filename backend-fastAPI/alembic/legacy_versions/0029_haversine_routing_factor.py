"""Add haversine_routing_factor to restaurant_settings.

Revision ID: 0029_haversine_routing_factor
Revises: 0028_distance_modes_and_driver_dispatch
"""

import sqlalchemy as sa
from alembic import op

revision = "0029_haversine_routing_factor"
down_revision = "0028_distance_modes_and_driver_dispatch"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("restaurant_settings") as batch_op:
        batch_op.add_column(
            sa.Column("haversine_routing_factor", sa.Float(), nullable=False, server_default="1.3")
        )


def downgrade() -> None:
    with op.batch_alter_table("restaurant_settings") as batch_op:
        batch_op.drop_column("haversine_routing_factor")
