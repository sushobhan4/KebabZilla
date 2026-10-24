"""Store restaurant delivery radius in kilometers.

Revision ID: 0007_delivery_radius_km
Revises: 0006_customer_profiles_and_addresses
"""
import sqlalchemy as sa
from alembic import op

revision = "0007_delivery_radius_km"
down_revision = "0006_customer_profiles_and_addresses"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("restaurant_settings")}
    if "delivery_radius_km" not in columns:
        op.add_column(
            "restaurant_settings",
            sa.Column("delivery_radius_km", sa.Float(), server_default="10", nullable=False),
        )


def downgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("restaurant_settings")}
    if "delivery_radius_km" in columns:
        op.drop_column("restaurant_settings", "delivery_radius_km")
