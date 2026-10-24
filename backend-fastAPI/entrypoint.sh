#!/bin/sh
set -e

echo "==> Running database migrations (Alembic)..."
python -m alembic upgrade head || {
    echo "Warning: Alembic migration encountered an error or was already at head."
}

if [ -n "$SEED_ADMIN_PASSWORD" ]; then
    echo "==> Checking initial admin user and default settings..."
    python -m app.seed_admin || {
        echo "Warning: Seed admin script encountered an issue or admin already exists."
    }
fi

echo "==> Starting KebabZilla API server on port ${PORT:-8080}..."
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8080}" --proxy-headers --forwarded-allow-ips "*"
