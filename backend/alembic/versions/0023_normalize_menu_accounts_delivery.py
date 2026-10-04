"""Normalize menu images/categories, discounts, addresses and delivery settings."""

from alembic import op
import sqlalchemy as sa

revision = "0023_normalize_menu_accounts_delivery"
down_revision = "0022_order_schema_redesign"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    if "account_addresses" not in tables:
        op.create_table(
            "account_addresses",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("account_id", sa.Integer(), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
            sa.Column("address_id", sa.String(64), nullable=False),
            sa.Column("label", sa.String(40), nullable=False),
            sa.Column("house_number", sa.String(120), nullable=False, server_default=""),
            sa.Column("area", sa.String(160), nullable=False, server_default=""),
            sa.Column("road", sa.String(160), nullable=False, server_default=""),
            sa.Column("landmark", sa.String(200), nullable=False, server_default=""),
            sa.Column("city", sa.String(120), nullable=False, server_default=""),
            sa.Column("pincode", sa.String(20), nullable=False, server_default=""),
            sa.Column("latitude", sa.Float(), nullable=True),
            sa.Column("longitude", sa.Float(), nullable=True),
            sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
            sa.UniqueConstraint("account_id", "address_id"),
        )
        accounts = sa.Table("accounts", sa.MetaData(), autoload_with=bind)
        addresses = sa.Table("account_addresses", sa.MetaData(), autoload_with=bind)
        for account_id, raw in bind.execute(sa.select(accounts.c.id, accounts.c.addresses)).all():
            for item in (raw or []):
                item = dict(item)
                bind.execute(addresses.insert().values(
                    account_id=account_id, address_id=item.get("id", "home"),
                    label=item.get("label", "Home"), house_number=item.get("house_number", ""),
                    area=item.get("area", ""), road=item.get("road", ""), landmark=item.get("landmark", ""),
                    city=item.get("city", ""), pincode=item.get("pincode", item.get("postal_code", "")),
                    latitude=item.get("latitude"), longitude=item.get("longitude"),
                    is_default=bool(item.get("is_default", False)),
                ))
        with op.batch_alter_table("accounts") as batch:
            batch.drop_column("addresses")

    menu_columns = {column["name"] for column in inspector.get_columns("menu_items")}
    if "category_id" not in menu_columns:
        if "category" in menu_columns:
            op.drop_index("ix_menu_items_category", table_name="menu_items")
        with op.batch_alter_table("menu_items") as batch:
            batch.add_column(sa.Column("category_id", sa.Integer(), nullable=True))
            batch.create_foreign_key("fk_menu_items_category_id", "menu_categories", ["category_id"], ["id"], ondelete="SET NULL")
        # Preserve legacy category names, creating missing category rows first.
        categories = sa.Table("menu_categories", sa.MetaData(), autoload_with=bind)
        items = sa.Table("menu_items", sa.MetaData(), autoload_with=bind)
        for name, in bind.execute(sa.select(items.c.category).where(items.c.category != "").distinct()).all():
            category = bind.execute(sa.select(categories.c.id).where(sa.func.lower(categories.c.name) == name.lower())).scalar()
            if category is None:
                category = bind.execute(categories.insert().values(name=name).returning(categories.c.id)).scalar()
            bind.execute(items.update().where(items.c.category == name).values(category_id=category))
        with op.batch_alter_table("menu_items") as batch:
            batch.drop_column("category")

    menu_columns = {column["name"] for column in sa.inspect(bind).get_columns("menu_items")}
    if "image_url" in menu_columns:
        items = sa.Table("menu_items", sa.MetaData(), autoload_with=bind)
        for item_id, image_url, image_urls in bind.execute(sa.select(items.c.id, items.c.image_url, items.c.image_urls)).all():
            if image_url and not image_urls:
                bind.execute(items.update().where(items.c.id == item_id).values(image_urls=[image_url]))
        with op.batch_alter_table("menu_items") as batch:
            batch.drop_column("image_url")

    if "menu_discount_items" not in sa.inspect(bind).get_table_names():
        op.create_table(
            "menu_discount_items",
            sa.Column("discount_id", sa.Integer(), sa.ForeignKey("menu_discounts.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("menu_item_id", sa.Integer(), sa.ForeignKey("menu_items.id", ondelete="CASCADE"), primary_key=True),
        )
        discounts = sa.Table("menu_discounts", sa.MetaData(), autoload_with=bind)
        links = sa.Table("menu_discount_items", sa.MetaData(), autoload_with=bind)
        for discount_id, raw in bind.execute(sa.select(discounts.c.id, discounts.c.menu_item_ids)).all():
            for item_id in (raw or []):
                bind.execute(links.insert().values(discount_id=discount_id, menu_item_id=int(item_id)))
        with op.batch_alter_table("menu_discounts") as batch:
            batch.drop_column("menu_item_ids")

    settings_columns = {column["name"] for column in sa.inspect(bind).get_columns("restaurant_settings")}
    if "free_delivery_radius_km" not in settings_columns:
        op.add_column("restaurant_settings", sa.Column("free_delivery_radius_km", sa.Float(), nullable=True, server_default="3"))
        op.add_column("restaurant_settings", sa.Column("delivery_fee_per_km_paise", sa.Integer(), nullable=True, server_default="1000"))
        op.execute(sa.text("UPDATE restaurant_settings SET free_delivery_radius_km = 3 WHERE free_delivery_radius_km IS NULL"))
        op.execute(sa.text("UPDATE restaurant_settings SET delivery_fee_per_km_paise = delivery_fee_paise WHERE delivery_fee_per_km_paise IS NULL"))

    if "order_items" in sa.inspect(bind).get_table_names():
        constraints = {c["name"] for c in sa.inspect(bind).get_unique_constraints("order_items")}
        if "uq_order_items_order_menu_item" not in constraints:
            with op.batch_alter_table("order_items") as batch:
                batch.create_unique_constraint("uq_order_items_order_menu_item", ["order_id", "menu_item_id"])


def downgrade() -> None:
    raise NotImplementedError("Normalization migration is intentionally not reversible without restoring legacy JSON values.")
