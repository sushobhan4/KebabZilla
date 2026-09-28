"""Add customer profile and saved address storage.

Revision ID: 0006_customer_profiles_and_addresses
Revises: 0005_per_menu_tax
"""
import json

from alembic import op
import sqlalchemy as sa


revision = "0006_customer_profiles_and_addresses"
down_revision = "0005_per_menu_tax"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("accounts")}
    if "addresses" not in columns:
        op.add_column("accounts", sa.Column("addresses", sa.JSON(), nullable=False, server_default="[]"))
    defaults = json.dumps([
        {"id": "home", "label": "Home", "address": ""},
        {"id": "work", "label": "Work", "address": ""},
    ])
    bind.execute(sa.text("UPDATE accounts SET addresses = :addresses WHERE addresses IS NULL OR addresses = '[]'"), {"addresses": defaults})


def downgrade() -> None:
    op.drop_column("accounts", "addresses")
