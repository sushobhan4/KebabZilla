"""Database Migration Tool: Transfer data from local SQLite to Cloud SQL PostgreSQL.

Usage:
    python migrate_to_postgres.py --dest-url "postgresql+psycopg://user:password@host:port/dbname"
    # Or set the environment variable:
    # DEST_DATABASE_URL="postgresql+psycopg://..." python migrate_to_postgres.py
"""

import argparse
import json
import os
import sys
from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.orm import Session

# Add current folder to sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.db import Base
from app import models  # noqa: F401 - register all tables

# Tables in foreign key dependency order
TABLE_ORDER = [
    "accounts",
    "staff_info",
    "account_addresses",
    "user_sessions",
    "two_factor_challenges",
    "password_reset_codes",
    "menu_categories",
    "menu_items",
    "menu_item_categories",
    "menu_sections",
    "menu_discounts",
    "menu_discount_items",
    "restaurant_settings",
    "orders",
    "order_items",
    "payments",
    "cart_items",
    "draft_orders",
    "delivery_batches",
    "delivery_batch_orders",
    "admin_events",
    "offer_logs",
]

# JSON columns by table to properly deserialize from SQLite text before writing to PostgreSQL
JSON_COLUMNS = {
    "menu_items": ["image_urls", "variations"],
    "menu_sections": ["options"],
    "restaurant_settings": ["weekly_schedule"],
    "order_items": ["customizations"],
    "cart_items": ["customizations"],
    "draft_orders": ["payload"],
    "admin_events": ["details"],
    "offer_logs": ["channels", "delivery_counts"],
}


def main():
    parser = argparse.ArgumentParser(description="Migrate KebabZilla SQLite database to PostgreSQL (Cloud SQL)")
    parser.add_argument(
        "--source-url",
        default=os.environ.get("SOURCE_DATABASE_URL", "sqlite:///./kebabzilla.db"),
        help="Source SQLite database URL (default: sqlite:///./kebabzilla.db)",
    )
    parser.add_argument(
        "--dest-url",
        default=os.environ.get("DEST_DATABASE_URL"),
        help="Destination PostgreSQL database URL (e.g. postgresql+psycopg://user:pass@host:5432/dbname)",
    )
    parser.add_argument(
        "--clean",
        action="store_true",
        help="Drop and recreate destination tables before migrating",
    )

    args = parser.parse_args()

    dest_url = args.dest_url
    if not dest_url:
        print("ERROR: Destination database URL is required.")
        print("Provide --dest-url or set the DEST_DATABASE_URL environment variable.")
        sys.exit(1)

    # Normalize PostgreSQL URL
    if dest_url.startswith("postgres://"):
        dest_url = dest_url.replace("postgres://", "postgresql+psycopg://", 1)
    elif dest_url.startswith("postgresql://") and not dest_url.startswith("postgresql+"):
        dest_url = dest_url.replace("postgresql://", "postgresql+psycopg://", 1)

    print(f"[*] Connecting to source SQLite database: {args.source_url}")
    source_engine = create_engine(args.source_url)

    print(f"[*] Connecting to destination PostgreSQL database...")
    dest_engine = create_engine(dest_url, pool_pre_ping=True)

    with dest_engine.connect() as conn:
        res = conn.execute(text("SELECT version();")).scalar()
        print(f"[+] Connected to PostgreSQL: {res}")

    if args.clean:
        print("[!] Dropping all tables in destination database...")
        Base.metadata.drop_all(bind=dest_engine)

    print("[*] Ensuring all schema tables exist in destination...")
    Base.metadata.create_all(bind=dest_engine)

    source_inspector = inspect(source_engine)
    source_tables = set(source_inspector.get_table_names())

    with source_engine.connect() as src_conn, dest_engine.connect() as dest_conn:
        for table_name in TABLE_ORDER:
            if table_name not in source_tables:
                print(f"[-] Table {table_name} does not exist in source. Skipping.")
                continue

            # Check if destination already has rows
            existing_count = dest_conn.execute(text(f'SELECT COUNT(*) FROM "{table_name}"')).scalar()
            if existing_count > 0 and not args.clean:
                print(f"[~] Table {table_name} already contains {existing_count} rows in destination. Skipping (use --clean to overwrite).")
                continue

            # Fetch rows from SQLite
            rows = src_conn.execute(text(f'SELECT * FROM "{table_name}"')).mappings().all()
            if not rows:
                print(f"[.] Table {table_name}: 0 rows to copy.")
                continue

            json_cols = set(JSON_COLUMNS.get(table_name, []))
            cleaned_rows = []
            for r in rows:
                d = dict(r)
                for col in json_cols:
                    val = d.get(col)
                    if isinstance(val, str):
                        try:
                            d[col] = json.loads(val)
                        except Exception:
                            pass
                cleaned_rows.append(d)

            # Insert into PostgreSQL
            table = Base.metadata.tables[table_name]
            dest_conn.execute(table.insert(), cleaned_rows)
            dest_conn.commit()
            print(f"[+] Table {table_name}: successfully migrated {len(cleaned_rows)} rows.")

            # Reset auto-increment sequence if id column exists
            columns = [c["name"] for c in source_inspector.get_columns(table_name)]
            if "id" in columns:
                try:
                    dest_conn.execute(
                        text(f"SELECT setval(pg_get_serial_sequence('{table_name}', 'id'), coalesce(max(id), 1)) FROM \"{table_name}\";")
                    )
                    dest_conn.commit()
                except Exception:
                    pass

        # Stamp Alembic version in destination
        print("[*] Stamping Alembic version table...")
        dest_conn.execute(
            text("""
                CREATE TABLE IF NOT EXISTS alembic_version (
                    version_num VARCHAR(32) NOT NULL PRIMARY KEY
                );
            """)
        )
        dest_conn.execute(text("DELETE FROM alembic_version;"))
        dest_conn.execute(text("INSERT INTO alembic_version (version_num) VALUES ('0046_drop_prices_and_custom_ids');"))
        dest_conn.commit()

    print("\n[SUCCESS] Migration completed successfully!")
    print("Your Cloud SQL PostgreSQL database now has all data, schema, and Alembic version stamp.")


if __name__ == "__main__":
    main()
