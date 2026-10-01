"""Add shop operations, audit, scheduling, discounts, and delivery contacts.

Revision ID: 0009_operations_features
Revises: 0008_structured_saved_addresses
"""
import sqlalchemy as sa
from alembic import op

revision = "0009_operations_features"
down_revision = "0008_structured_saved_addresses"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("menu_items") as batch:
        batch.add_column(sa.Column("discount_percent", sa.Integer(), nullable=False, server_default="0"))
        batch.add_column(sa.Column("discounted_price_paise", sa.Integer(), nullable=True))
    with op.batch_alter_table("restaurant_settings") as batch:
        batch.add_column(sa.Column("weekly_schedule", sa.JSON(), nullable=False, server_default="{}"))
    with op.batch_alter_table("orders") as batch:
        batch.add_column(sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=True))
    op.create_table(
        "menu_pauses",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("menu_item_id", sa.Integer(), sa.ForeignKey("menu_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("employee_id", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("paused_until", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_menu_pauses_menu_item_id", "menu_pauses", ["menu_item_id"])
    op.create_index("ix_menu_pauses_employee_id", "menu_pauses", ["employee_id"])
    op.create_index("ix_menu_pauses_created_at", "menu_pauses", ["created_at"])
    op.create_table(
        "admin_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("event_type", sa.String(40), nullable=False),
        sa.Column("message", sa.String(500), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("actor_id", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_admin_events_event_type", "admin_events", ["event_type"])
    op.create_index("ix_admin_events_created_at", "admin_events", ["created_at"])
    op.create_table(
        "offer_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("actor_id", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("audience", sa.String(40), nullable=False),
        sa.Column("channels", sa.JSON(), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("recipient_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sent_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(30), nullable=False, server_default="PENDING"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_offer_logs_created_at", "offer_logs", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_offer_logs_created_at", table_name="offer_logs")
    op.drop_table("offer_logs")
    op.drop_index("ix_admin_events_created_at", table_name="admin_events")
    op.drop_index("ix_admin_events_event_type", table_name="admin_events")
    op.drop_table("admin_events")
    op.drop_index("ix_menu_pauses_created_at", table_name="menu_pauses")
    op.drop_index("ix_menu_pauses_employee_id", table_name="menu_pauses")
    op.drop_index("ix_menu_pauses_menu_item_id", table_name="menu_pauses")
    op.drop_table("menu_pauses")
    with op.batch_alter_table("orders") as batch:
        batch.drop_column("scheduled_for")
    with op.batch_alter_table("restaurant_settings") as batch:
        batch.drop_column("weekly_schedule")
    with op.batch_alter_table("menu_items") as batch:
        batch.drop_column("discounted_price_paise")
        batch.drop_column("discount_percent")
