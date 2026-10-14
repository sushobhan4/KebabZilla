"""Remove blank work addresses and ensure default address.

Revision ID: 0043_remove_blank_work_addresses
Revises: 0042_unified_menu_items_2fa_and_fixes
Create Date: 2026-10-14 01:53:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "0043_remove_blank_work_addresses"
down_revision = "0042_unified_menu_items_2fa_and_fixes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = insp.get_table_names()

    if "account_addresses" in tables:
        # Delete all blank work addresses
        bind.execute(
            sa.text("""
                DELETE FROM account_addresses
                WHERE (address_id = 'work' OR LOWER(label) = 'work')
                  AND (house_number IS NULL OR TRIM(house_number) = '')
                  AND (road IS NULL OR TRIM(road) = '')
                  AND (area IS NULL OR TRIM(area) = '')
                  AND (city IS NULL OR TRIM(city) = '')
                  AND (pincode IS NULL OR TRIM(pincode) = '')
                  AND (landmark IS NULL OR TRIM(landmark) = '')
                  AND latitude IS NULL
                  AND longitude IS NULL
            """)
        )

        # Ensure every account that has addresses has at least one default address
        bind.execute(
            sa.text("""
                UPDATE account_addresses
                SET is_default = 1
                WHERE id IN (
                    SELECT MIN(id)
                    FROM account_addresses
                    GROUP BY account_id
                    HAVING MAX(CASE WHEN is_default = 1 THEN 1 ELSE 0 END) = 0
                )
            """)
        )


def downgrade() -> None:
    pass
