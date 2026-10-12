import logging
import os
import re
import shutil
import subprocess
import time
import uuid
from typing import Optional

from google.cloud import storage
from google.oauth2.credentials import Credentials

from app.config import settings

logger = logging.getLogger(__name__)

_storage_client: Optional[storage.Client] = None
_client_created_at: float = 0.0
_TOKEN_TTL_SECONDS = 3000  # Google OAuth access tokens typically last 3600 seconds (1 hour)


def _find_gcloud_executable() -> Optional[str]:
    """Locate the gcloud executable on the host system."""
    for candidate in ["gcloud", "gcloud.cmd"]:
        found = shutil.which(candidate)
        if found:
            return found

    known_paths = [
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"),
        os.path.expanduser(r"~\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"),
        r"C:\Program Files\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd",
        r"C:\Program Files (x86)\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd",
    ]
    for p in known_paths:
        if os.path.isfile(p):
            return p
    return None


def get_storage_client() -> storage.Client:
    """Return an authenticated Google Cloud Storage client.

    First tries standard Application Default Credentials (e.g. Cloud Run, GKE, or ADC file).
    Falls back to acquiring a token from the local gcloud CLI if logged in on the system.
    """
    global _storage_client, _client_created_at

    now = time.time()
    if _storage_client is not None and (now - _client_created_at) < _TOKEN_TTL_SECONDS:
        return _storage_client

    # In Google Cloud environments (Cloud Run, GKE, etc.) or when explicit credentials are set:
    if os.environ.get("GOOGLE_APPLICATION_CREDENTIALS") or os.environ.get("K_SERVICE"):
        import google.auth
        try:
            credentials, project = google.auth.default()
            client = storage.Client(credentials=credentials, project=project or settings.gcs_project_id)
            _storage_client = client
            _client_created_at = now
            logger.info("Initialized GCS client using environment credentials.")
            return client
        except Exception as exc:
            logger.warning("Failed to initialize ADC in cloud environment: %s", exc)

    # In local development: check local gcloud CLI first to avoid slow metadata server timeouts
    gcloud_path = _find_gcloud_executable()
    if gcloud_path:
        try:
            token = subprocess.check_output(
                [gcloud_path, "auth", "print-access-token"],
                text=True,
                timeout=10,
            ).strip()
            if token:
                creds = Credentials(token=token)
                client = storage.Client(credentials=creds, project=settings.gcs_project_id)
                _storage_client = client
                _client_created_at = now
                logger.info("Initialized GCS client using local gcloud CLI token.")
                return client
        except Exception as exc:
            logger.warning("gcloud token acquisition failed: %s", exc)

    # Fallback to standard google.auth.default()
    import google.auth
    credentials, project = google.auth.default()
    client = storage.Client(credentials=credentials, project=project or settings.gcs_project_id)
    _storage_client = client
    _client_created_at = now
    return client


def _clean_filename(filename: str) -> str:
    """Sanitize filename to prevent directory traversal and invalid characters."""
    base = os.path.basename(filename)
    name, ext = os.path.splitext(base)
    clean_name = re.sub(r"[^a-zA-Z0-9_\-]", "_", name).strip("_")
    clean_ext = re.sub(r"[^a-zA-Z0-9]", "", ext).lower()
    if not clean_name:
        clean_name = "image"
    if not clean_ext:
        clean_ext = "jpg"
    return f"{clean_name}.{clean_ext}"


def upload_menu_image(
    file_bytes: bytes,
    filename: str,
    content_type: str = "image/jpeg",
) -> dict:
    """Upload a menu image file into the configured GCS bucket under menuImages/.

    Returns a dict with the backend URL, GCS URI, and filename.
    Generates a completely random filename (32-character hex + extension).
    """
    client = get_storage_client()
    bucket = client.bucket(settings.gcs_bucket_name)

    # Determine file extension from filename or content_type
    _, ext = os.path.splitext(filename or "")
    clean_ext = re.sub(r"[^a-zA-Z0-9]", "", ext).lower()
    if not clean_ext:
        ext_map = {
            "image/jpeg": "jpg",
            "image/jpg": "jpg",
            "image/png": "png",
            "image/webp": "webp",
            "image/gif": "gif",
            "image/avif": "avif",
        }
        clean_ext = ext_map.get((content_type or "").lower(), "jpg")

    # Complete random name: 32 random hex characters + extension
    unique_name = f"{uuid.uuid4().hex}.{clean_ext}"

    folder = (settings.gcs_menu_images_folder or "menuImages").strip("/\\")
    blob_path = f"{folder}/{unique_name}" if folder else unique_name

    blob = bucket.blob(blob_path)
    blob.cache_control = "public, max-age=31536000, immutable"
    blob.upload_from_string(file_bytes, content_type=content_type)

    logger.info("Successfully uploaded menu image to gs://%s/%s", settings.gcs_bucket_name, blob_path)

    return {
        "url": f"/menu/images/gcs/{unique_name}",
        "gcs_uri": f"gs://{settings.gcs_bucket_name}/{blob_path}",
        "filename": unique_name,
        "content_type": content_type,
        "size_bytes": len(file_bytes),
    }


def get_menu_image_blob(filename: str) -> tuple[bytes, str]:
    """Retrieve the bytes and content type of an image in the menuImages/ folder of the GCS bucket."""
    client = get_storage_client()
    bucket = client.bucket(settings.gcs_bucket_name)

    clean_file = os.path.basename(filename)
    folder = (settings.gcs_menu_images_folder or "menuImages").strip("/\\")
    blob_path = f"{folder}/{clean_file}" if folder else clean_file

    blob = bucket.blob(blob_path)
    if not blob.exists():
        raise FileNotFoundError(f"Image '{clean_file}' does not exist in bucket '{settings.gcs_bucket_name}'.")

    blob_bytes = blob.download_as_bytes()
    content_type = blob.content_type or "image/jpeg"
    return blob_bytes, content_type


def delete_menu_image(filename: str) -> bool:
    """Delete a menu image from the GCS bucket if it exists."""
    try:
        client = get_storage_client()
        bucket = client.bucket(settings.gcs_bucket_name)

        clean_file = os.path.basename(filename)
        folder = (settings.gcs_menu_images_folder or "menuImages").strip("/\\")
        blob_path = f"{folder}/{clean_file}" if folder else clean_file

        blob = bucket.blob(blob_path)
        if blob.exists():
            blob.delete()
            logger.info("Deleted menu image gs://%s/%s", settings.gcs_bucket_name, blob_path)
            return True
        return False
    except Exception as exc:
        logger.warning("Error deleting menu image '%s': %s", filename, exc)
        return False


def extract_gcs_filename(url: str) -> Optional[str]:
    """Extract the filename from a GCS proxy URL, GCS URI, or direct path."""
    if not url:
        return None
    trimmed = url.strip()
    prefix = "/menu/images/gcs/"
    if trimmed.startswith(prefix):
        return os.path.basename(trimmed[len(prefix):])

    if trimmed.startswith("gs://"):
        return os.path.basename(trimmed)

    if "/menuImages/" in trimmed:
        return os.path.basename(trimmed)

    return None


def is_gcs_image_referenced(
    db,
    filename: str,
    exclude_menu_item_id: Optional[int] = None,
    exclude_custom_menu_item_id: Optional[int] = None,
) -> bool:
    """Check if any MenuItem or CustomMenuItem in the database references this GCS image filename."""
    from app.models import CustomMenuItem, MenuItem
    from sqlalchemy import select

    clean_file = os.path.basename(filename)
    if not clean_file:
        return False

    # Check MenuItem
    menu_items = db.scalars(select(MenuItem)).all()
    for item in menu_items:
        if exclude_menu_item_id is not None and item.id == exclude_menu_item_id:
            continue
        if item.image_urls:
            for u in item.image_urls:
                if u and clean_file in u:
                    return True

    # Check CustomMenuItem
    custom_items = db.scalars(select(CustomMenuItem)).all()
    for item in custom_items:
        if exclude_custom_menu_item_id is not None and item.id == exclude_custom_menu_item_id:
            continue
        if item.image_urls:
            for u in item.image_urls:
                if u and clean_file in u:
                    return True

    return False


def cleanup_unreferenced_gcs_images(
    db,
    removed_urls: list[str],
    exclude_menu_item_id: Optional[int] = None,
    exclude_custom_menu_item_id: Optional[int] = None,
) -> list[str]:
    """Delete GCS images from storage if they are no longer referenced by any menu item in the database."""
    deleted_files: list[str] = []
    for url in removed_urls:
        filename = extract_gcs_filename(url)
        if not filename:
            continue
        if not is_gcs_image_referenced(
            db,
            filename,
            exclude_menu_item_id=exclude_menu_item_id,
            exclude_custom_menu_item_id=exclude_custom_menu_item_id,
        ):
            if delete_menu_image(filename):
                deleted_files.append(filename)
                logger.info("Cleaned up unreferenced menu image from GCS: %s", filename)
    return deleted_files
