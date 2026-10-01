"""Group menu discounts into campaigns.

Revision ID: 0013_discount_campaigns
Revises: 0012_scheduled_menu_discounts
"""
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision = "0013_discount_campaigns"
down_revision = "0012_scheduled_menu_discounts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    inspector = sa.inspect(connection)
    columns = {column["name"]: column for column in inspector.get_columns("menu_discounts")}
    added_campaign_column = "campaign_id" not in columns
    if added_campaign_column:
        op.add_column(
            "menu_discounts",
            sa.Column("campaign_id", sa.String(length=36), nullable=True),
        )
    discount_ids = connection.execute(
        sa.text("SELECT id FROM menu_discounts WHERE campaign_id IS NULL")
    ).scalars().all()
    for discount_id in discount_ids:
        connection.execute(
            sa.text("UPDATE menu_discounts SET campaign_id = :campaign_id WHERE id = :id"),
            {"campaign_id": str(uuid4()), "id": discount_id},
        )
    if added_campaign_column or columns["campaign_id"]["nullable"]:
        with op.batch_alter_table("menu_discounts") as batch_op:
            batch_op.alter_column(
                "campaign_id",
                existing_type=sa.String(length=36),
                nullable=False,
            )
    index_names = {index["name"] for index in inspector.get_indexes("menu_discounts")}
    if "ix_menu_discounts_campaign_id" not in index_names:
        op.create_index(
            "ix_menu_discounts_campaign_id", "menu_discounts", ["campaign_id"]
        )


def downgrade() -> None:
    op.drop_index("ix_menu_discounts_campaign_id", table_name="menu_discounts")
    with op.batch_alter_table("menu_discounts") as batch_op:
        batch_op.drop_column("campaign_id")
