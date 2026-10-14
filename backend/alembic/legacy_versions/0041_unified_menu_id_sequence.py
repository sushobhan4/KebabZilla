"""Unified menu item ID sequence and delete custom_menu_item_categories table.

Revision ID: 0041_unified_menu_id_sequence
Revises: 0040_menu_item_multiple_categories
Create Date: 2026-10-12 06:05:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "0041_unified_menu_id_sequence"
down_revision = "0040_menu_item_multiple_categories"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = insp.get_table_names()

    # 1. Disable FK checks temporarily for table rebuild / ID remapping
    is_sqlite = bind.dialect.name == "sqlite"
    if is_sqlite:
        bind.execute(sa.text("PRAGMA foreign_keys = OFF"))

    # 2. Shift colliding custom_menu_items IDs so they continue after menu_items
    max_menu_id = bind.execute(sa.text("SELECT COALESCE(MAX(id), 0) FROM menu_items")).scalar() or 0
    colliding_custom = bind.execute(
        sa.text("SELECT id FROM custom_menu_items WHERE id <= :max_id ORDER BY id ASC"),
        {"max_id": max_menu_id},
    ).fetchall()

    if colliding_custom:
        curr_next_id = max_menu_id + 1
        for row in colliding_custom:
            old_id = row[0]
            new_id = curr_next_id
            curr_next_id += 1

            # Update child tables referencing custom_menu_items
            bind.execute(
                sa.text("UPDATE custom_menu_sections SET item_id = :new_id WHERE item_id = :old_id"),
                {"new_id": new_id, "old_id": old_id},
            )
            bind.execute(
                sa.text("UPDATE order_items SET custom_menu_item_id = :new_id WHERE custom_menu_item_id = :old_id"),
                {"new_id": new_id, "old_id": old_id},
            )
            if "menu_discount_items" in tables:
                bind.execute(
                    sa.text("UPDATE menu_discount_items SET custom_menu_item_id = :new_id WHERE custom_menu_item_id = :old_id"),
                    {"new_id": new_id, "old_id": old_id},
                )
            if "custom_menu_item_categories" in tables:
                bind.execute(
                    sa.text("UPDATE custom_menu_item_categories SET custom_item_id = :new_id WHERE custom_item_id = :old_id"),
                    {"new_id": new_id, "old_id": old_id},
                )
            bind.execute(
                sa.text("UPDATE custom_menu_items SET id = :new_id WHERE id = :old_id"),
                {"new_id": new_id, "old_id": old_id},
            )

    # 3. Rebuild menu_item_categories without FK on menu_item_id so it accepts both regular & custom item IDs
    if "menu_item_categories" in tables:
        # Create new unconstrained table
        bind.execute(sa.text("""
            CREATE TABLE menu_item_categories_new (
                menu_item_id INTEGER NOT NULL,
                category_id INTEGER NOT NULL REFERENCES menu_categories(id) ON DELETE CASCADE,
                PRIMARY KEY (menu_item_id, category_id)
            )
        """))
        # Copy existing regular menu item categories
        bind.execute(sa.text("""
            INSERT OR IGNORE INTO menu_item_categories_new (menu_item_id, category_id)
            SELECT menu_item_id, category_id FROM menu_item_categories
        """))
        # Copy custom menu item categories if the table exists
        if "custom_menu_item_categories" in tables:
            bind.execute(sa.text("""
                INSERT OR IGNORE INTO menu_item_categories_new (menu_item_id, category_id)
                SELECT custom_item_id, category_id FROM custom_menu_item_categories
            """))

        bind.execute(sa.text("DROP TABLE menu_item_categories"))
        bind.execute(sa.text("ALTER TABLE menu_item_categories_new RENAME TO menu_item_categories"))

    # 4. Drop custom_menu_item_categories table
    if "custom_menu_item_categories" in tables:
        bind.execute(sa.text("DROP TABLE custom_menu_item_categories"))

    if is_sqlite:
        bind.execute(sa.text("PRAGMA foreign_keys = ON"))


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = insp.get_table_names()

    if "custom_menu_item_categories" not in tables:
        op.create_table(
            "custom_menu_item_categories",
            sa.Column("custom_item_id", sa.Integer(), sa.ForeignKey("custom_menu_items.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("category_id", sa.Integer(), sa.ForeignKey("menu_categories.id", ondelete="CASCADE"), primary_key=True),
        )
