"""Database schema baseline for KebabZilla API.

Revision ID: 0046_drop_prices_and_custom_ids
Revises:
Create Date: 2026-10-15 00:00:00.000000

"""
from alembic import op
from app.db import Base
from app import models  # noqa: F401 - registers all model metadata

revision = "0046_drop_prices_and_custom_ids"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    Base.metadata.create_all(bind=op.get_bind())


def downgrade() -> None:
    Base.metadata.drop_all(bind=op.get_bind())
