"""Remove redundant columns and legacy tables.

Revision ID: 0049_remove_redundancy_and_legacy_tables
Revises: 0048_charge_from_zero_and_delivery_timestamps
Create Date: 2026-10-17 01:30:00.000000

"""
import json
from alembic import op
import sqlalchemy as sa

revision = "0049_remove_redundancy_and_legacy_tables"
down_revision = "0048_charge_from_zero_and_delivery_timestamps"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    is_sqlite = conn.dialect.name == "sqlite"

    # 1. restaurant_settings: drop admin_override_open
    if "restaurant_settings" in inspector.get_table_names():
        rs_cols = {c["name"] for c in inspector.get_columns("restaurant_settings")}
        if "admin_override_open" in rs_cols:
            with op.batch_alter_table("restaurant_settings") as batch_op:
                batch_op.drop_column("admin_override_open")

    # 2. menu_items: copy any category_id into menu_item_categories, then drop category_id
    if "menu_items" in inspector.get_table_names():
        mi_cols = {c["name"] for c in inspector.get_columns("menu_items")}
        if "category_id" in mi_cols:
            if "menu_item_categories" in inspector.get_table_names():
                if is_sqlite:
                    conn.execute(sa.text("""
                        INSERT OR IGNORE INTO menu_item_categories (menu_item_id, category_id)
                        SELECT id, category_id FROM menu_items WHERE category_id IS NOT NULL
                    """))
                else:
                    conn.execute(sa.text("""
                        INSERT INTO menu_item_categories (menu_item_id, category_id)
                        SELECT id, category_id FROM menu_items WHERE category_id IS NOT NULL
                        ON CONFLICT DO NOTHING
                    """))
            mi_indexes = {ix["name"] for ix in inspector.get_indexes("menu_items")}
            with op.batch_alter_table("menu_items") as batch_op:
                if "ix_menu_items_category_id" in mi_indexes:
                    batch_op.drop_index("ix_menu_items_category_id")
                batch_op.drop_column("category_id")

    # 3. offer_logs: ensure delivery_counts has data, then drop recipient_count and sent_count
    if "offer_logs" in inspector.get_table_names():
        ol_cols = {c["name"] for c in inspector.get_columns("offer_logs")}
        if "recipient_count" in ol_cols or "sent_count" in ol_cols:
            rows = conn.execute(sa.text("SELECT id, channels, recipient_count, sent_count, delivery_counts FROM offer_logs")).mappings().all()
            for r in rows:
                counts = r.get("delivery_counts")
                if isinstance(counts, str):
                    try:
                        counts = json.loads(counts)
                    except Exception:
                        counts = None
                if not counts or not isinstance(counts, dict):
                    channels = r.get("channels") or ["EMAIL"]
                    if isinstance(channels, str):
                        try:
                            channels = json.loads(channels)
                        except Exception:
                            channels = [channels]
                    rec_count = r.get("recipient_count") or 0
                    s_count = r.get("sent_count") or 0
                    new_counts = {ch: {"recipient_count": rec_count, "sent_count": s_count} for ch in channels}
                    counts_json = json.dumps(new_counts)
                    conn.execute(sa.text("UPDATE offer_logs SET delivery_counts = :dc WHERE id = :id"), {"dc": counts_json, "id": r["id"]})

            with op.batch_alter_table("offer_logs") as batch_op:
                if "recipient_count" in ol_cols:
                    batch_op.drop_column("recipient_count")
                if "sent_count" in ol_cols:
                    batch_op.drop_column("sent_count")

    # 4. drop legacy tables custom_menu_sections and custom_menu_items
    tables = set(inspector.get_table_names())
    if "custom_menu_sections" in tables:
        op.drop_table("custom_menu_sections")
    if "custom_menu_items" in tables:
        op.drop_table("custom_menu_items")


def downgrade() -> None:
    pass
