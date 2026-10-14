"""Retain an encrypted delivery code for the customer order page.

Revision ID: 0003_delivery_otp_ciphertext
Revises: 0002_menu_categories_and_images
"""
from alembic import op
import sqlalchemy as sa


revision = "0003_delivery_otp_ciphertext"
down_revision = "0002_menu_categories_and_images"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("orders")}
    if "delivery_otp_ciphertext" not in columns:
        op.add_column("orders", sa.Column("delivery_otp_ciphertext", sa.String(length=500), nullable=True))


def downgrade() -> None:
    op.drop_column("orders", "delivery_otp_ciphertext")
