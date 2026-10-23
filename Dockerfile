# Dockerfile for repository root deployments to Cloud Run
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client gzip && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/alembic.ini ./
COPY backend/alembic ./alembic
COPY backend/app ./app
COPY backend/entrypoint.sh ./

RUN chmod +x /app/entrypoint.sh

EXPOSE 8080

CMD ["/bin/sh", "/app/entrypoint.sh"]
