"""Initial KebabZilla schema.

Revision ID: 0001_initial
Revises:
"""
from alembic import op

from app import models  # noqa: F401 - import registers all tables
from app.db import Base

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    Base.metadata.create_all(bind=op.get_bind())


def downgrade() -> None:
    Base.metadata.drop_all(bind=op.get_bind())
