"""Expand restaurant phone column length for multiple numbers.

Revision ID: 0032_expand_restaurant_phone
Revises: 0031_separate_custom_menus_and_add_variations
Create Date: 2026-10-10 01:53:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "0032_expand_restaurant_phone"
down_revision = "0031_separate_custom_menus_and_add_variations"
branch_labels = None
depends_on = None

def upgrade() -> None:
    with op.batch_alter_table("restaurant_settings") as batch_op:
        batch_op.alter_column(
            "phone",
            existing_type=sa.String(length=32),
            type_=sa.String(length=300),
            existing_nullable=False,
        )

def downgrade() -> None:
    with op.batch_alter_table("restaurant_settings") as batch_op:
        batch_op.alter_column(
            "phone",
            existing_type=sa.String(length=300),
            type_=sa.String(length=32),
            existing_nullable=False,
        )
