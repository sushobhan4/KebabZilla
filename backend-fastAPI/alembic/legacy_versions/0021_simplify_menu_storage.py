"""Simplify OTP, discount, and menu pause storage."""

import json
import sqlalchemy as sa
from alembic import op

revision = "0021_simplify_menu_storage"
down_revision = "0020_remove_menu_tax_and_legacy_discounts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    order_columns = {column["name"] for column in inspector.get_columns("orders")}
    if "delivery_otp_hash" in order_columns:
        with op.batch_alter_table("orders") as batch:
            batch.drop_column("delivery_otp_hash")

    menu_columns = {column["name"] for column in inspector.get_columns("menu_items")}
    if "paused_by_id" not in menu_columns:
        with op.batch_alter_table("menu_items") as batch:
            batch.add_column(sa.Column("paused_by_id", sa.Integer(), nullable=True))
            batch.create_foreign_key("fk_menu_items_paused_by_id", "accounts", ["paused_by_id"], ["id"], ondelete="SET NULL")
            batch.create_index("ix_menu_items_paused_by_id", ["paused_by_id"])

    discount_columns = {column["name"] for column in inspector.get_columns("menu_discounts")}
    if "menu_item_ids" not in discount_columns:
        with op.batch_alter_table("menu_discounts") as batch:
            batch.add_column(sa.Column("menu_item_ids", sa.JSON(), nullable=True))
    rows = bind.execute(sa.text("SELECT id, campaign_id, menu_item_id FROM menu_discounts ORDER BY id")).mappings().all()
    grouped = {}
    for row in rows:
        grouped.setdefault(row["campaign_id"], []).append(row["menu_item_id"])
    for campaign_id, item_ids in grouped.items():
        first_id = bind.execute(sa.text("SELECT id FROM menu_discounts WHERE campaign_id = :campaign_id ORDER BY id LIMIT 1"), {"campaign_id": campaign_id}).scalar_one()
        bind.execute(sa.text("UPDATE menu_discounts SET menu_item_ids = :item_ids WHERE id = :id"), {"item_ids": json.dumps(item_ids), "id": first_id})
        bind.execute(sa.text("DELETE FROM menu_discounts WHERE campaign_id = :campaign_id AND id != :id"), {"campaign_id": campaign_id, "id": first_id})
    op.drop_index("ix_menu_discounts_campaign_id", table_name="menu_discounts")
    op.drop_index("ix_menu_discounts_menu_item_id", table_name="menu_discounts")
    if bind.dialect.name == "sqlite":
        op.execute(sa.text("""
            CREATE TABLE menu_discounts_new (
                id INTEGER NOT NULL PRIMARY KEY,
                campaign_name VARCHAR(80),
                menu_item_ids JSON NOT NULL,
                discount_percent INTEGER NOT NULL,
                starts_at DATETIME NOT NULL,
                ends_at DATETIME NOT NULL,
                created_by_id INTEGER,
                created_at DATETIME NOT NULL,
                FOREIGN KEY(created_by_id) REFERENCES accounts (id) ON DELETE SET NULL
            )
        """))
        op.execute(sa.text("""
            INSERT INTO menu_discounts_new
                (id, campaign_name, menu_item_ids, discount_percent, starts_at, ends_at, created_by_id, created_at)
            SELECT id, campaign_name, menu_item_ids, discount_percent, starts_at, ends_at, created_by_id, created_at
            FROM menu_discounts
        """))
        op.drop_table("menu_discounts")
        op.rename_table("menu_discounts_new", "menu_discounts")
        op.create_index("ix_menu_discounts_starts_at", "menu_discounts", ["starts_at"])
        op.create_index("ix_menu_discounts_ends_at", "menu_discounts", ["ends_at"])
    else:
        with op.batch_alter_table("menu_discounts") as batch:
            batch.drop_column("campaign_id")
            batch.drop_column("menu_item_id")

    if inspector.has_table("menu_pauses"):
        op.drop_table("menu_pauses")


def downgrade() -> None:
    raise NotImplementedError("This storage simplification cannot be downgraded without reconstructing historical discount groups")
