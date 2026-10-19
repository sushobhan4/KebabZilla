from collections.abc import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings


class Base(DeclarativeBase):
    pass


is_sqlite = settings.database_url.startswith("sqlite")
connect_args = {"check_same_thread": False} if is_sqlite else {
    "prepare_threshold": None,
    "keepalives": 1,
    "keepalives_idle": 30,
    "keepalives_interval": 10,
    "keepalives_count": 5,
}
pool_kwargs = {}
if not is_sqlite:
    pool_kwargs = {
        "pool_size": 10,
        "max_overflow": 10,
        "pool_recycle": 300,
        "pool_timeout": 20,
    }

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    connect_args=connect_args,
    **pool_kwargs,
)

if settings.database_url.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.execute("PRAGMA foreign_keys=ON")
        try:
            cursor.execute("PRAGMA table_info(restaurant_settings)")
            cols = {row[1] for row in cursor.fetchall()}
            if cols:
                if "average_delivery_speed_kmh" not in cols:
                    cursor.execute("ALTER TABLE restaurant_settings ADD COLUMN average_delivery_speed_kmh FLOAT DEFAULT 30.0")
                if "customer_sla_minutes" not in cols:
                    cursor.execute("ALTER TABLE restaurant_settings ADD COLUMN customer_sla_minutes FLOAT DEFAULT 36.0")
                if "alns_max_iterations_mode" not in cols:
                    cursor.execute("ALTER TABLE restaurant_settings ADD COLUMN alns_max_iterations_mode VARCHAR(10) DEFAULT 'AUTO'")
                if "alns_max_iterations" not in cols:
                    cursor.execute("ALTER TABLE restaurant_settings ADD COLUMN alns_max_iterations INTEGER DEFAULT 220")
                if "max_orders_per_driver" not in cols:
                    cursor.execute("ALTER TABLE restaurant_settings ADD COLUMN max_orders_per_driver INTEGER DEFAULT 5")
                if "charge_from_zero_beyond_free_radius" not in cols:
                    cursor.execute("ALTER TABLE restaurant_settings ADD COLUMN charge_from_zero_beyond_free_radius BOOLEAN DEFAULT 0")
                if "is_delivery_open" not in cols:
                    cursor.execute("ALTER TABLE restaurant_settings ADD COLUMN is_delivery_open BOOLEAN DEFAULT 1")
                if "order_cutoff_minutes_before_closing" not in cols:
                    cursor.execute("ALTER TABLE restaurant_settings ADD COLUMN order_cutoff_minutes_before_closing INTEGER DEFAULT 30")
                if "delivery_paused_until" not in cols:
                    cursor.execute("ALTER TABLE restaurant_settings ADD COLUMN delivery_paused_until DATETIME")
                if "email" not in cols:
                    cursor.execute("ALTER TABLE restaurant_settings ADD COLUMN email VARCHAR(255) DEFAULT 'support@kebabzilla.in'")
                if "distance_calculation_mode" in cols:
                    try:
                        cursor.execute("ALTER TABLE restaurant_settings DROP COLUMN distance_calculation_mode")
                    except Exception:
                        pass

            cursor.execute("PRAGMA table_info(orders)")
            order_cols = {row[1] for row in cursor.fetchall()}
            if order_cols and "delivery_started_at" not in order_cols:
                cursor.execute("ALTER TABLE orders ADD COLUMN delivery_started_at DATETIME")

            cursor.execute("PRAGMA table_info(accounts)")
            account_cols = {row[1] for row in cursor.fetchall()}
            if account_cols and "promotional_consent" not in account_cols:
                cursor.execute("ALTER TABLE accounts ADD COLUMN promotional_consent BOOLEAN DEFAULT 1")

            cursor.execute("PRAGMA table_info(user_sessions)")
            session_cols = {row[1] for row in cursor.fetchall()}
            if session_cols:
                if "device_name" not in session_cols:
                    cursor.execute("ALTER TABLE user_sessions ADD COLUMN device_name VARCHAR(128) DEFAULT ''")
                if "country" not in session_cols:
                    cursor.execute("ALTER TABLE user_sessions ADD COLUMN country VARCHAR(64) DEFAULT ''")
                if "region" not in session_cols:
                    cursor.execute("ALTER TABLE user_sessions ADD COLUMN region VARCHAR(64) DEFAULT ''")
                if "city" not in session_cols:
                    cursor.execute("ALTER TABLE user_sessions ADD COLUMN city VARCHAR(64) DEFAULT ''")

            cursor.execute("PRAGMA table_info(account_addresses)")
            addr_cols = {row[1] for row in cursor.fetchall()}
            if addr_cols and "distance_meters" not in addr_cols:
                cursor.execute("ALTER TABLE account_addresses ADD COLUMN distance_meters INTEGER")

            cursor.execute("""
                CREATE TABLE IF NOT EXISTS email_verification_codes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    email VARCHAR(255),
                    otp_hash VARCHAR(255),
                    purpose VARCHAR(32) DEFAULT 'register',
                    expires_at DATETIME,
                    attempts INTEGER DEFAULT 0,
                    used_at DATETIME,
                    created_at DATETIME
                )
            """)
        except Exception:
            pass
        cursor.close()
else:
    def ensure_postgres_schema():
        try:
            with engine.connect() as conn:
                with conn.begin():
                    conn.exec_driver_sql("""
                        ALTER TABLE restaurant_settings ADD COLUMN IF NOT EXISTS average_delivery_speed_kmh FLOAT DEFAULT 30.0;
                        ALTER TABLE restaurant_settings ADD COLUMN IF NOT EXISTS customer_sla_minutes FLOAT DEFAULT 36.0;
                        ALTER TABLE restaurant_settings ADD COLUMN IF NOT EXISTS alns_max_iterations_mode VARCHAR(10) DEFAULT 'AUTO';
                        ALTER TABLE restaurant_settings ADD COLUMN IF NOT EXISTS alns_max_iterations INTEGER DEFAULT 220;
                        ALTER TABLE restaurant_settings ADD COLUMN IF NOT EXISTS max_orders_per_driver INTEGER DEFAULT 5;
                        ALTER TABLE restaurant_settings ADD COLUMN IF NOT EXISTS charge_from_zero_beyond_free_radius BOOLEAN DEFAULT FALSE;
                        ALTER TABLE restaurant_settings ADD COLUMN IF NOT EXISTS is_delivery_open BOOLEAN DEFAULT TRUE;
                        ALTER TABLE restaurant_settings ADD COLUMN IF NOT EXISTS order_cutoff_minutes_before_closing INTEGER DEFAULT 30;
                        ALTER TABLE restaurant_settings ADD COLUMN IF NOT EXISTS delivery_paused_until TIMESTAMPTZ;
                        ALTER TABLE restaurant_settings ADD COLUMN IF NOT EXISTS email VARCHAR(255) DEFAULT 'support@kebabzilla.in';
                        ALTER TABLE restaurant_settings ADD COLUMN IF NOT EXISTS enforce_driver_geofence BOOLEAN DEFAULT FALSE;
                        ALTER TABLE restaurant_settings ADD COLUMN IF NOT EXISTS driver_geofence_meters INTEGER DEFAULT 500;
                        ALTER TABLE restaurant_settings ADD COLUMN IF NOT EXISTS haversine_routing_factor FLOAT DEFAULT 1.3627;
                        ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_started_at TIMESTAMPTZ;
                        ALTER TABLE accounts ADD COLUMN IF NOT EXISTS promotional_consent BOOLEAN DEFAULT TRUE;
                        ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS device_name VARCHAR(128) DEFAULT '';
                        ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS country VARCHAR(64) DEFAULT '';
                        ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS region VARCHAR(64) DEFAULT '';
                        ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS city VARCHAR(64) DEFAULT '';
                        ALTER TABLE account_addresses ADD COLUMN IF NOT EXISTS distance_meters INTEGER;
                        CREATE TABLE IF NOT EXISTS email_verification_codes (
                            id SERIAL PRIMARY KEY,
                            email VARCHAR(255),
                            otp_hash VARCHAR(255),
                            purpose VARCHAR(32) DEFAULT 'register',
                            expires_at TIMESTAMPTZ,
                            attempts INTEGER DEFAULT 0,
                            used_at TIMESTAMPTZ,
                            created_at TIMESTAMPTZ DEFAULT NOW()
                        );
                        ALTER TABLE restaurant_settings DROP COLUMN IF EXISTS admin_override_open;
                        ALTER TABLE restaurant_settings DROP COLUMN IF EXISTS distance_calculation_mode;
                        DO $$
                        BEGIN
                            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'menu_items' AND column_name = 'category_id') THEN
                                IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'menu_item_categories') THEN
                                    INSERT INTO menu_item_categories (menu_item_id, category_id)
                                    SELECT id, category_id FROM menu_items WHERE category_id IS NOT NULL
                                    ON CONFLICT DO NOTHING;
                                END IF;
                                ALTER TABLE menu_items DROP COLUMN category_id;
                            END IF;
                        END $$;
                        ALTER TABLE offer_logs DROP COLUMN IF EXISTS recipient_count;
                        ALTER TABLE offer_logs DROP COLUMN IF EXISTS sent_count;
                        DROP TABLE IF EXISTS custom_menu_sections CASCADE;
                        DROP TABLE IF EXISTS custom_menu_items CASCADE;
                    """)
        except Exception:
            pass

    ensure_postgres_schema()

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

