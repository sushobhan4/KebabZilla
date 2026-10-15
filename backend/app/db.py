from collections.abc import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings


class Base(DeclarativeBase):
    pass


is_sqlite = settings.database_url.startswith("sqlite")
connect_args = {"check_same_thread": False} if is_sqlite else {}
pool_kwargs = {}
if not is_sqlite:
    pool_kwargs = {
        "pool_size": 10,
        "max_overflow": 5,
        "pool_recycle": 1800,
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

            cursor.execute("PRAGMA table_info(orders)")
            order_cols = {row[1] for row in cursor.fetchall()}
            if order_cols and "delivery_started_at" not in order_cols:
                cursor.execute("ALTER TABLE orders ADD COLUMN delivery_started_at DATETIME")
        except Exception:
            pass
        cursor.close()

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

