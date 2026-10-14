"""Unified menu items, 2FA challenges, delivery OTP attempts, and surrogate PK fixes.

Revision ID: 0042_unified_menu_items_2fa_and_fixes
Revises: 0041_unified_menu_id_sequence
Create Date: 2026-10-13 01:05:00.000000

"""
import json
from alembic import op
import sqlalchemy as sa


revision = "0042_unified_menu_items_2fa_and_fixes"
down_revision = "0041_unified_menu_id_sequence"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = insp.get_table_names()

    is_sqlite = bind.dialect.name == "sqlite"
    if is_sqlite:
        bind.execute(sa.text("PRAGMA foreign_keys = OFF"))

    # 1. Accounts phone index
    accounts_cols = [c["name"] for c in insp.get_columns("accounts")]
    if "phone" in accounts_cols:
        existing_indices = [idx["name"] for idx in insp.get_indexes("accounts")]
        if "ix_accounts_phone" not in existing_indices:
            op.create_index("ix_accounts_phone", "accounts", ["phone"], unique=False)

    # 2. Two factor challenges table
    if "two_factor_challenges" not in tables:
        op.create_table(
            "two_factor_challenges",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("account_id", sa.Integer(), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("token_hash", sa.String(64), nullable=False, unique=True, index=True),
            sa.Column("code_hash", sa.String(64), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False, index=True),
            sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("is_verified", sa.Boolean(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )

    # 3. Orders: delivery_otp_attempts
    orders_cols = [c["name"] for c in insp.get_columns("orders")]
    if "delivery_otp_attempts" not in orders_cols:
        op.add_column("orders", sa.Column("delivery_otp_attempts", sa.Integer(), nullable=False, server_default="0"))

    # 4. Menu Items: add is_customizable, base_price_paise, paused_until
    menu_cols = [c["name"] for c in insp.get_columns("menu_items")]
    if "is_customizable" not in menu_cols:
        op.add_column("menu_items", sa.Column("is_customizable", sa.Boolean(), nullable=False, server_default="0"))
    if "base_price_paise" not in menu_cols:
        op.add_column("menu_items", sa.Column("base_price_paise", sa.Integer(), nullable=True))
    if "paused_until" not in menu_cols:
        op.add_column("menu_items", sa.Column("paused_until", sa.DateTime(timezone=True), nullable=True))

    # 5. Menu Sections table
    if "menu_sections" not in tables:
        op.create_table(
            "menu_sections",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("menu_item_id", sa.Integer(), sa.ForeignKey("menu_items.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("section_type", sa.String(20), nullable=False, server_default="CUSTOM"),
            sa.Column("name", sa.String(120), nullable=False),
            sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("required", sa.Boolean(), nullable=False, server_default="1"),
            sa.Column("options", sa.JSON(), nullable=False),
        )

    # 6. Migrate custom_menu_items -> menu_items
    if "custom_menu_items" in tables:
        custom_rows = bind.execute(sa.text(
            "SELECT id, name, description, category_id, base_price_paise, image_urls, is_vegetarian, "
            "is_available, is_featured, created_at, paused_by_id FROM custom_menu_items"
        )).fetchall()
        for row in custom_rows:
            exists = bind.execute(sa.text("SELECT id FROM menu_items WHERE id = :id"), {"id": row[0]}).scalar()
            if not exists:
                bind.execute(
                    sa.text(
                        "INSERT INTO menu_items (id, name, description, category_id, price_paise, base_price_paise, "
                        "image_urls, is_vegetarian, is_available, is_featured, is_customizable, variations, created_at, paused_by_id) "
                        "VALUES (:id, :name, :description, :category_id, :price_paise, :base_price_paise, "
                        ":image_urls, :is_vegetarian, :is_available, :is_featured, 1, '[]', :created_at, :paused_by_id)"
                    ),
                    {
                        "id": row[0],
                        "name": row[1],
                        "description": row[2] or "",
                        "category_id": row[3],
                        "price_paise": row[4],
                        "base_price_paise": row[4],
                        "image_urls": row[5] or "[]",
                        "is_vegetarian": row[6],
                        "is_available": row[7],
                        "is_featured": row[8],
                        "created_at": row[9],
                        "paused_by_id": row[10],
                    },
                )

    # 7. Migrate custom_menu_sections -> menu_sections
    if "custom_menu_sections" in tables:
        section_rows = bind.execute(sa.text(
            "SELECT id, item_id, name, position, required, options FROM custom_menu_sections"
        )).fetchall()
        for row in section_rows:
            exists = bind.execute(sa.text("SELECT id FROM menu_sections WHERE id = :id"), {"id": row[0]}).scalar()
            if not exists:
                bind.execute(
                    sa.text(
                        "INSERT INTO menu_sections (id, menu_item_id, section_type, name, position, required, options) "
                        "VALUES (:id, :menu_item_id, 'CUSTOM', :name, :position, :required, :options)"
                    ),
                    {
                        "id": row[0],
                        "menu_item_id": row[1],
                        "name": row[2],
                        "position": row[3],
                        "required": row[4],
                        "options": row[5] if isinstance(row[5], str) else json.dumps(row[5]),
                    },
                )

    # 8. Migrate regular menu variations -> menu_sections
    regular_items_with_vars = bind.execute(sa.text(
        "SELECT id, variations FROM menu_items WHERE variations IS NOT NULL AND variations != '[]' AND variations != ''"
    )).fetchall()
    for item_id, vars_json in regular_items_with_vars:
        try:
            vars_list = json.loads(vars_json) if isinstance(vars_json, str) else vars_json
        except Exception:
            vars_list = []
        if vars_list and isinstance(vars_list, list) and len(vars_list) > 0:
            already_has_section = bind.execute(sa.text(
                "SELECT id FROM menu_sections WHERE menu_item_id = :item_id AND section_type = 'VARIATION'"
            ), {"item_id": item_id}).scalar()
            if not already_has_section:
                bind.execute(
                    sa.text(
                        "INSERT INTO menu_sections (menu_item_id, section_type, name, position, required, options) "
                        "VALUES (:menu_item_id, 'VARIATION', 'Portion / Size', 0, 1, :options)"
                    ),
                    {
                        "menu_item_id": item_id,
                        "options": json.dumps(vars_list),
                    },
                )

    # 9. Update order_items menu_item_id from custom_menu_item_id
    if "order_items" in tables:
        bind.execute(sa.text(
            "UPDATE order_items SET menu_item_id = custom_menu_item_id WHERE menu_item_id IS NULL AND custom_menu_item_id IS NOT NULL"
        ))

    # 10. Recreate menu_discount_items with surrogate autoincrement PK (fixes d2)
    if "menu_discount_items" in tables:
        discount_cols = [c["name"] for c in insp.get_columns("menu_discount_items")]
        if "id" not in discount_cols:
            if is_sqlite:
                op.create_table(
                    "menu_discount_items_new",
                    sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
                    sa.Column("discount_id", sa.Integer(), sa.ForeignKey("menu_discounts.id", ondelete="CASCADE"), nullable=False, index=True),
                    sa.Column("menu_item_id", sa.Integer(), sa.ForeignKey("menu_items.id", ondelete="CASCADE"), nullable=True, index=True),
                    sa.Column("custom_menu_item_id", sa.Integer(), sa.ForeignKey("menu_items.id", ondelete="CASCADE"), nullable=True, index=True),
                )
                bind.execute(sa.text(
                    "INSERT INTO menu_discount_items_new (discount_id, menu_item_id, custom_menu_item_id) "
                    "SELECT discount_id, menu_item_id, custom_menu_item_id FROM menu_discount_items"
                ))
                op.drop_table("menu_discount_items")
                op.rename_table("menu_discount_items_new", "menu_discount_items")
            else:
                op.add_column("menu_discount_items", sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True))

    if is_sqlite:
        bind.execute(sa.text("PRAGMA foreign_keys = ON"))


def downgrade() -> None:
    pass
