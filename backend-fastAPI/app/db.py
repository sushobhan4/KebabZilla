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
                if "free_delivery_threshold_paise" not in cols:
                    cursor.execute("ALTER TABLE restaurant_settings ADD COLUMN free_delivery_threshold_paise INTEGER DEFAULT 0")
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
                if "previous_token_hash" not in session_cols:
                    cursor.execute("ALTER TABLE user_sessions ADD COLUMN previous_token_hash VARCHAR(64)")
                if "grace_period_until" not in session_cols:
                    cursor.execute("ALTER TABLE user_sessions ADD COLUMN grace_period_until DATETIME")

            cursor.execute("PRAGMA table_info(account_addresses)")
            addr_cols = {row[1] for row in cursor.fetchall()}
            if addr_cols and "distance_meters" not in addr_cols:
                cursor.execute("ALTER TABLE account_addresses ADD COLUMN distance_meters INTEGER")

            cursor.execute("PRAGMA table_info(staff_info)")
            staff_cols = {row[1] for row in cursor.fetchall()}
            if staff_cols:
                if "role" not in staff_cols:
                    cursor.execute("ALTER TABLE staff_info ADD COLUMN role VARCHAR(16)")
                cursor.execute("DELETE FROM staff_info WHERE account_id IN (SELECT id FROM accounts WHERE role = 'USER')")
                cursor.execute("""
                    INSERT INTO staff_info (account_id, role, is_accepting_deliveries, must_change_password, updated_at)
                    SELECT id, role, 0, 0, CURRENT_TIMESTAMP
                    FROM accounts
                    WHERE role != 'USER' AND id NOT IN (SELECT account_id FROM staff_info)
                """)
                cursor.execute("""
                    UPDATE staff_info
                    SET role = (SELECT role FROM accounts WHERE accounts.id = staff_info.account_id)
                    WHERE role IS NULL OR role != (SELECT role FROM accounts WHERE accounts.id = staff_info.account_id)
                """)
                cursor.execute("""
                    UPDATE staff_info
                    SET is_accepting_deliveries = 0
                    WHERE is_accepting_deliveries = 1
                    AND account_id IN (SELECT id FROM accounts WHERE role NOT IN ('DELIVERY', 'ADMIN'))
                """)

            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='all_otp'")
            if not cursor.fetchall():
                cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='two_factor_challenges'")
                if cursor.fetchall():
                    cursor.execute("ALTER TABLE two_factor_challenges RENAME TO all_otp")
                else:
                    cursor.execute("""
                        CREATE TABLE IF NOT EXISTS all_otp (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            purpose VARCHAR(32) DEFAULT '2fa',
                            otp_code VARCHAR(255),
                            token_hash VARCHAR(64) UNIQUE,
                            account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
                            email VARCHAR(255),
                            order_id VARCHAR(20) REFERENCES orders(order_id) ON DELETE CASCADE,
                            attempts INTEGER DEFAULT 0,
                            expires_at DATETIME,
                            created_at DATETIME
                        )
                    """)

            cursor.execute("PRAGMA table_info(all_otp)")
            all_otp_cols = {row[1] for row in cursor.fetchall()}
            if all_otp_cols:
                if "purpose" not in all_otp_cols:
                    cursor.execute("ALTER TABLE all_otp ADD COLUMN purpose VARCHAR(32) DEFAULT '2fa'")
                if "otp_code" not in all_otp_cols:
                    cursor.execute("ALTER TABLE all_otp ADD COLUMN otp_code VARCHAR(255)")
                if "email" not in all_otp_cols:
                    cursor.execute("ALTER TABLE all_otp ADD COLUMN email VARCHAR(255)")
                if "order_id" not in all_otp_cols:
                    cursor.execute("ALTER TABLE all_otp ADD COLUMN order_id VARCHAR(20)")
                if "code_hash" in all_otp_cols:
                    cursor.execute("UPDATE all_otp SET otp_code = code_hash WHERE otp_code IS NULL AND code_hash IS NOT NULL")
                cursor.execute("UPDATE all_otp SET purpose = '2fa' WHERE purpose IS NULL")

            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='email_verification_codes'")
            if cursor.fetchall():
                try:
                    cursor.execute("""
                        INSERT INTO all_otp (email, account_id, otp_code, purpose, expires_at, attempts, created_at)
                        SELECT email, account_id, otp_hash, COALESCE(purpose, 'register'), expires_at, attempts, created_at
                        FROM email_verification_codes
                        WHERE expires_at > CURRENT_TIMESTAMP
                    """)
                except Exception:
                    pass
                cursor.execute("DROP TABLE IF EXISTS email_verification_codes")

            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='password_reset_codes'")
            if cursor.fetchall():
                try:
                    cursor.execute("""
                        INSERT INTO all_otp (email, account_id, otp_code, purpose, expires_at, attempts, created_at)
                        SELECT accounts.email, prc.account_id, prc.otp_hash, 'forgot_password', prc.expires_at, prc.attempts, prc.created_at
                        FROM password_reset_codes prc
                        JOIN accounts ON accounts.id = prc.account_id
                        WHERE prc.expires_at > CURRENT_TIMESTAMP
                    """)
                except Exception:
                    pass
                cursor.execute("DROP TABLE IF EXISTS password_reset_codes")

            cursor.execute("DELETE FROM all_otp WHERE expires_at <= CURRENT_TIMESTAMP")
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
                        ALTER TABLE restaurant_settings ADD COLUMN IF NOT EXISTS free_delivery_threshold_paise INTEGER DEFAULT 0;
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
                        ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS previous_token_hash VARCHAR(64);
                        ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS grace_period_until TIMESTAMPTZ;
                        CREATE INDEX IF NOT EXISTS ix_user_sessions_previous_token_hash ON user_sessions(previous_token_hash);
                        ALTER TABLE account_addresses ADD COLUMN IF NOT EXISTS distance_meters INTEGER;
                        ALTER TABLE staff_info ADD COLUMN IF NOT EXISTS role VARCHAR(16);
                        DELETE FROM staff_info WHERE account_id IN (SELECT id FROM accounts WHERE role = 'USER');
                        INSERT INTO staff_info (account_id, role, is_accepting_deliveries, must_change_password, updated_at)
                        SELECT id, role, false, false, NOW()
                        FROM accounts
                        WHERE role != 'USER' AND id NOT IN (SELECT account_id FROM staff_info);
                        UPDATE staff_info
                        SET role = (SELECT role FROM accounts WHERE accounts.id = staff_info.account_id)
                        WHERE role IS NULL OR role != (SELECT role FROM accounts WHERE accounts.id = staff_info.account_id);
                        UPDATE staff_info
                        SET is_accepting_deliveries = false
                        WHERE is_accepting_deliveries = true
                        AND account_id IN (SELECT id FROM accounts WHERE role NOT IN ('DELIVERY', 'ADMIN'));
                        DO $$
                        BEGIN
                            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'two_factor_challenges')
                               AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'all_otp') THEN
                                ALTER TABLE two_factor_challenges RENAME TO all_otp;
                                IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'two_factor_challenges_id_seq') THEN
                                    ALTER SEQUENCE two_factor_challenges_id_seq RENAME TO all_otp_id_seq;
                                END IF;
                            END IF;
                        END $$;
                        CREATE TABLE IF NOT EXISTS all_otp (
                            id SERIAL PRIMARY KEY,
                            purpose VARCHAR(32) DEFAULT '2fa',
                            otp_code VARCHAR(255),
                            token_hash VARCHAR(64) UNIQUE,
                            account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
                            email VARCHAR(255),
                            order_id VARCHAR(20) REFERENCES orders(order_id) ON DELETE CASCADE,
                            attempts INTEGER DEFAULT 0,
                            expires_at TIMESTAMPTZ,
                            created_at TIMESTAMPTZ DEFAULT NOW()
                        );
                        ALTER TABLE all_otp ADD COLUMN IF NOT EXISTS purpose VARCHAR(32) DEFAULT '2fa';
                        ALTER TABLE all_otp ADD COLUMN IF NOT EXISTS otp_code VARCHAR(255);
                        ALTER TABLE all_otp ADD COLUMN IF NOT EXISTS email VARCHAR(255);
                        ALTER TABLE all_otp ADD COLUMN IF NOT EXISTS order_id VARCHAR(20) REFERENCES orders(order_id) ON DELETE CASCADE;
                        ALTER TABLE all_otp ALTER COLUMN account_id DROP NOT NULL;
                        ALTER TABLE all_otp ALTER COLUMN token_hash DROP NOT NULL;
                        DO $$
                        BEGIN
                            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'all_otp' AND column_name = 'code_hash') THEN
                                UPDATE all_otp SET otp_code = code_hash WHERE otp_code IS NULL AND code_hash IS NOT NULL;
                                ALTER TABLE all_otp DROP COLUMN code_hash;
                            END IF;
                            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'all_otp' AND column_name = 'is_verified') THEN
                                ALTER TABLE all_otp DROP COLUMN is_verified;
                            END IF;
                        END $$;
                        UPDATE all_otp SET purpose = '2fa' WHERE purpose IS NULL;
                        DO $$
                        BEGIN
                            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'email_verification_codes') THEN
                                INSERT INTO all_otp (email, account_id, otp_code, purpose, expires_at, attempts, created_at)
                                SELECT email, account_id, otp_hash, COALESCE(purpose, 'register'), expires_at, attempts, created_at
                                FROM email_verification_codes
                                WHERE expires_at > NOW();
                                DROP TABLE email_verification_codes CASCADE;
                            END IF;
                            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'password_reset_codes') THEN
                                INSERT INTO all_otp (email, account_id, otp_code, purpose, expires_at, attempts, created_at)
                                SELECT accounts.email, prc.account_id, prc.otp_hash, 'forgot_password', prc.expires_at, prc.attempts, prc.created_at
                                FROM password_reset_codes prc
                                JOIN accounts ON accounts.id = prc.account_id
                                WHERE prc.expires_at > NOW();
                                DROP TABLE password_reset_codes CASCADE;
                            END IF;
                        END $$;
                        CREATE INDEX IF NOT EXISTS ix_all_otp_purpose ON all_otp(purpose);
                        CREATE INDEX IF NOT EXISTS ix_all_otp_email ON all_otp(email);
                        CREATE INDEX IF NOT EXISTS ix_all_otp_order_id ON all_otp(order_id);
                        CREATE INDEX IF NOT EXISTS ix_all_otp_token_hash ON all_otp(token_hash);
                        CREATE INDEX IF NOT EXISTS ix_all_otp_expires_at ON all_otp(expires_at);
                        DELETE FROM all_otp WHERE expires_at <= NOW();
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

