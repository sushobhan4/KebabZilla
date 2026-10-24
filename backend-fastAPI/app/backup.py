from datetime import datetime
import gzip
import logging
import os
import re
import shutil
import subprocess
import tempfile
import time
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

from app.config import settings
from app.storage import get_storage_client

logger = logging.getLogger(__name__)


def _sanitize_pg_url(url: str) -> str:
    """Normalize SQLAlchemy postgresql connection URL into standard postgresql:// for pg_dump."""
    # Convert postgresql+psycopg2:// or postgresql+asyncpg:// to postgresql://
    return re.sub(r"^postgresql\+[a-zA-Z0-9_]+://", "postgresql://", url)


def perform_database_backup() -> Dict[str, Any]:
    """Execute a database backup (PostgreSQL or SQLite), compress it, and upload to Google Cloud Storage.

    Returns:
        dict: Metadata detailing backup file name, GCS URI, size, and duration.
    """
    start_time = time.time()
    ist = ZoneInfo("Asia/Kolkata")
    now_ist = datetime.now(ist)
    timestamp_str = now_ist.strftime("%Y-%m-%d_%H%M%S")
    filename = f"supabase_backup_{timestamp_str}.sql.gz"
    gcs_blob_path = f"backups/{filename}"

    db_url = settings.database_url
    temp_dir = tempfile.gettempdir()
    temp_file_path = os.path.join(temp_dir, filename)

    logger.info("Starting database backup for %s...", filename)

    try:
        if db_url.startswith("sqlite"):
            # Local / fallback SQLite backup
            import sqlite3
            sqlite_path = db_url.replace("sqlite:///", "").replace("sqlite://", "")
            if not os.path.exists(sqlite_path):
                raise FileNotFoundError(f"SQLite database file not found at '{sqlite_path}'")

            with gzip.open(temp_file_path, "wt", encoding="utf-8", compresslevel=6) as gz_out:
                con = sqlite3.connect(sqlite_path)
                for line in con.iterdump():
                    gz_out.write(f"{line}\n")
                con.close()
        else:
            # PostgreSQL backup via pg_dump
            pg_dump_cmd = shutil.which("pg_dump") or "pg_dump"
            clean_url = _sanitize_pg_url(db_url)

            # Mask credentials in logs
            masked_url = re.sub(r"://([^:]+):([^@]+)@", r"://\1:****@", clean_url)
            logger.info("Running pg_dump against %s", masked_url)

            dump_args = [
                pg_dump_cmd,
                "--clean",
                "--if-exists",
                "--no-owner",
                "--no-privileges",
                "--dbname",
                clean_url,
            ]

            process = subprocess.Popen(
                dump_args,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )

            with open(temp_file_path, "wb") as f_out:
                with gzip.GzipFile(fileobj=f_out, mode="wb", compresslevel=6) as gz_out:
                    shutil.copyfileobj(process.stdout, gz_out)

            stderr_data = process.stderr.read().decode("utf-8", errors="replace")
            ret_code = process.wait()

            if ret_code != 0:
                logger.error("pg_dump failed with return code %d: %s", ret_code, stderr_data)
                raise RuntimeError(f"pg_dump execution failed (exit code {ret_code}): {stderr_data.strip()}")

        file_size_bytes = os.path.getsize(temp_file_path)
        logger.info("Backup compressed locally. Size: %d bytes (%.2f MB). Uploading to GCS...",
                    file_size_bytes, file_size_bytes / (1024 * 1024))

        # Upload to Google Cloud Storage
        client = get_storage_client()
        bucket = client.bucket(settings.gcs_bucket_name)
        blob = bucket.blob(gcs_blob_path)
        blob.upload_from_filename(temp_file_path, content_type="application/gzip")

        duration_seconds = round(time.time() - start_time, 2)
        logger.info(
            "Successfully completed database backup and uploaded to gs://%s/%s in %.2fs",
            settings.gcs_bucket_name,
            gcs_blob_path,
            duration_seconds,
        )

        return {
            "status": "success",
            "filename": filename,
            "gcs_uri": f"gs://{settings.gcs_bucket_name}/{gcs_blob_path}",
            "size_bytes": file_size_bytes,
            "size_mb": round(file_size_bytes / (1024 * 1024), 2),
            "duration_seconds": duration_seconds,
            "created_at_ist": now_ist.isoformat(),
        }

    finally:
        if os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
            except Exception as e:
                logger.warning("Could not delete temporary backup file %s: %s", temp_file_path, e)


def list_database_backups() -> List[Dict[str, Any]]:
    """List existing database backups in Google Cloud Storage."""
    client = get_storage_client()
    bucket = client.bucket(settings.gcs_bucket_name)
    blobs = bucket.list_blobs(prefix="backups/")

    results: List[Dict[str, Any]] = []
    for blob in blobs:
        # Ignore directory placeholder
        if blob.name == "backups/" or blob.name.endswith("/"):
            continue

        filename = blob.name.split("/")[-1]
        size_bytes = blob.size or 0
        results.append({
            "filename": filename,
            "gcs_uri": f"gs://{settings.gcs_bucket_name}/{blob.name}",
            "size_bytes": size_bytes,
            "size_mb": round(size_bytes / (1024 * 1024), 2),
            "created_at": blob.time_created.isoformat() if blob.time_created else None,
            "updated_at": blob.updated.isoformat() if blob.updated else None,
        })

    # Sort newest first
    results.sort(key=lambda x: x.get("created_at") or "", reverse=True)
    return results
