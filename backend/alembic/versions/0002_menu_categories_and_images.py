"""Add editable menu categories and ordered menu images.

Revision ID: 0002_menu_categories_and_images
Revises: 0001_initial
"""
import json

from alembic import op
import sqlalchemy as sa


revision = "0002_menu_categories_and_images"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "image_urls" not in {column["name"] for column in inspector.get_columns("menu_items")}:
        op.add_column("menu_items", sa.Column("image_urls", sa.JSON(), nullable=False, server_default="[]"))
    if "menu_categories" not in inspector.get_table_names():
        op.create_table(
            "menu_categories",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("name", sa.String(length=80), nullable=False, unique=True),
        )
        op.create_index("ix_menu_categories_name", "menu_categories", ["name"], unique=True)
    connection = op.get_bind()
    categories = connection.execute(sa.text("SELECT DISTINCT category FROM menu_items WHERE category != ''")).all()
    for (name,) in categories:
        connection.execute(sa.text("INSERT INTO menu_categories (name) VALUES (:name)"), {"name": name})
    rows = connection.execute(sa.text("SELECT id, image_url FROM menu_items WHERE image_url IS NOT NULL AND image_url != ''")).all()
    for item_id, image_url in rows:
        connection.execute(sa.text("UPDATE menu_items SET image_urls = :images WHERE id = :id"), {"images": json.dumps([image_url]), "id": item_id})


def downgrade() -> None:
    op.drop_index("ix_menu_categories_name", table_name="menu_categories")
    op.drop_table("menu_categories")
    op.drop_column("menu_items", "image_urls")
