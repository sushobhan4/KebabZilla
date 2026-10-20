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


def convert_to_webp(file_bytes: bytes, quality: int = 82, max_dim: int = 1920) -> bytes:
    """Convert arbitrary image bytes (JPEG, PNG, etc.) to optimized WebP bytes."""
    from PIL import Image, ImageOps
    import io

    im = Image.open(io.BytesIO(file_bytes))
    try:
        im = ImageOps.exif_transpose(im)
    except Exception:
        pass

    if max(im.width, im.height) > max_dim:
        im.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)

    if im.mode not in ("RGB", "RGBA"):
        im = im.convert("RGBA" if "transparency" in im.info or im.mode in ("P", "LA") else "RGB")

    out_buf = io.BytesIO()
    im.save(out_buf, format="WEBP", quality=quality, method=4)
    return out_buf.getvalue()


def upload_menu_image(
    file_bytes: bytes,
    filename: str,
    content_type: str = "image/jpeg",
) -> dict:
    """Upload a menu image file into the configured GCS bucket under menuImages/.

    Automatically converts the incoming image to high-efficiency WebP format before saving.
    Returns a dict with the backend URL, GCS URI, and filename.
    Generates a completely random filename (32-character hex + .webp).
    """
    client = get_storage_client()
    bucket = client.bucket(settings.gcs_bucket_name)

    # Convert to WebP for modern web performance, faster delivery, and bandwidth savings
    try:
        webp_bytes = convert_to_webp(file_bytes, quality=82)
        file_bytes = webp_bytes
        content_type = "image/webp"
        clean_ext = "webp"
    except Exception as exc:
        logger.warning("WebP conversion failed for '%s', keeping original format: %s", filename, exc)
        _, ext = os.path.splitext(filename or "")
        clean_ext = re.sub(r"[^a-zA-Z0-9]", "", ext).lower() or "jpg"

    # Complete random name: 32 random hex characters + extension
    unique_name = f"{uuid.uuid4().hex}.{clean_ext}"

    folder = (settings.gcs_menu_images_folder or "menuImages").strip("/").strip("\\")
    blob_path = f"{folder}/{unique_name}" if folder else unique_name

    blob = bucket.blob(blob_path)
    blob.cache_control = "public, max-age=31536000, immutable"
    blob.upload_from_string(file_bytes, content_type=content_type)

    logger.info("Successfully uploaded menu image to gs://%s/%s (format: %s)", settings.gcs_bucket_name, blob_path, clean_ext)

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
    folder = (settings.gcs_menu_images_folder or "menuImages").strip("/").strip("\\")
    blob_path = f"{folder}/{clean_file}" if folder else clean_file

    blob = bucket.blob(blob_path)
    if not blob.exists():
        # Transparent fallback: if a .jpg was requested but converted to .webp, serve the .webp blob
        base_name, _ = os.path.splitext(clean_file)
        webp_file = f"{base_name}.webp"
        webp_path = f"{folder}/{webp_file}" if folder else webp_file
        webp_blob = bucket.blob(webp_path)
        if webp_blob.exists():
            return webp_blob.download_as_bytes(), "image/webp"
        raise FileNotFoundError(f"Image '{clean_file}' does not exist in bucket '{settings.gcs_bucket_name}'.")

    blob_bytes = blob.download_as_bytes()
    content_type = blob.content_type or ("image/webp" if clean_file.endswith(".webp") else "image/jpeg")
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


def upload_email_image(
    file_bytes: bytes,
    filename: str,
    content_type: str = "image/jpeg",
) -> dict:
    """Upload an email image file into the configured GCS bucket under emailImages/.

    Returns a dict with backend proxy URL, public GCS URL, GCS URI, and filename.
    Includes local disk fallback if GCS credentials are not configured in local environment.
    """
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

    unique_name = f"{uuid.uuid4().hex}.{clean_ext}"
    folder = (settings.gcs_email_images_folder or "emailImages").strip("/\\")
    blob_path = f"{folder}/{unique_name}" if folder else unique_name

    gcs_uploaded = False
    try:
        client = get_storage_client()
        bucket = client.bucket(settings.gcs_bucket_name)
        blob = bucket.blob(blob_path)
        blob.cache_control = "public, max-age=31536000, immutable"
        blob.upload_from_string(file_bytes, content_type=content_type)
        gcs_uploaded = True
        logger.info("Successfully uploaded email image to gs://%s/%s", settings.gcs_bucket_name, blob_path)
    except Exception as exc:
        logger.warning("GCS email image upload failed (will use local cache fallback): %s", exc)

    # Local disk fallback cache so image is always servable even in dev
    local_dir = os.path.join(os.path.dirname(__file__), "..", "uploads", "emailImages")
    try:
        os.makedirs(local_dir, exist_ok=True)
        local_path = os.path.join(local_dir, unique_name)
        with open(local_path, "wb") as f:
            f.write(file_bytes)
    except Exception as exc:
        logger.warning("Local email image caching failed: %s", exc)

    # The GCS bucket kebabzilla_cloud_storage has uniform bucket-level access and is not public anonymous.
    # Therefore, public web & email access is reliably served through KebabZilla's authenticated proxy endpoint.
    relative_url = f"/api/v1/public/email-images/{unique_name}"
    base_url = (getattr(settings, "public_backend_url", None) or "https://api.kebabzilla.in").rstrip("/")
    public_url = f"{base_url}{relative_url}"
    return {
        "url": relative_url,
        "public_url": public_url,
        "gcs_uri": f"gs://{settings.gcs_bucket_name}/{blob_path}",
        "filename": unique_name,
        "content_type": content_type,
        "size_bytes": len(file_bytes),
    }


def list_email_images() -> list[dict]:
    """List all email images currently stored in GCS emailImages/ folder and local fallback."""
    folder = (settings.gcs_email_images_folder or "emailImages").strip("/\\")
    prefix = f"{folder}/" if folder else ""
    base_url = (getattr(settings, "public_backend_url", None) or "https://api.kebabzilla.in").rstrip("/")

    images_by_filename: dict[str, dict] = {}

    try:
        client = get_storage_client()
        bucket = client.bucket(settings.gcs_bucket_name)
        blobs = bucket.list_blobs(prefix=prefix)
        for blob in blobs:
            fname = os.path.basename(blob.name)
            if not fname or (blob.size is not None and blob.size < 100) or fname.startswith("kebabzilla-email-logo"):
                continue
            relative_url = f"/api/v1/public/email-images/{fname}"
            images_by_filename[fname] = {
                "filename": fname,
                "url": relative_url,
                "public_url": f"{base_url}{relative_url}",
                "size_bytes": blob.size or 0,
                "created_at": blob.time_created.isoformat() if blob.time_created else None,
            }
    except Exception as exc:
        logger.warning("Could not list email images from GCS: %s", exc)

    local_dir = os.path.join(os.path.dirname(__file__), "..", "uploads", "emailImages")
    if os.path.isdir(local_dir):
        for fname in os.listdir(local_dir):
            if fname not in images_by_filename and not fname.startswith(".") and not fname.startswith("kebabzilla-email-logo"):
                fpath = os.path.join(local_dir, fname)
                if os.path.isfile(fpath):
                    fsize = os.path.getsize(fpath)
                    if fsize < 100:
                        continue
                    relative_url = f"/api/v1/public/email-images/{fname}"
                    images_by_filename[fname] = {
                        "filename": fname,
                        "url": relative_url,
                        "public_url": f"{base_url}{relative_url}",
                        "size_bytes": fsize,
                        "created_at": None,
                    }

    return sorted(images_by_filename.values(), key=lambda x: x.get("created_at") or "", reverse=True)


def get_email_image_blob(filename: str) -> tuple[bytes, str]:
    """Retrieve the bytes and content type of an image in the emailImages/ folder."""
    clean_file = os.path.basename(filename)
    folder = (settings.gcs_email_images_folder or "emailImages").strip("/\\")
    blob_path = f"{folder}/{clean_file}" if folder else clean_file

    try:
        client = get_storage_client()
        bucket = client.bucket(settings.gcs_bucket_name)
        blob = bucket.blob(blob_path)
        if blob.exists():
            return blob.download_as_bytes(), blob.content_type or "image/jpeg"
    except Exception as exc:
        logger.info("GCS fetch for email image failed: %s. Checking local fallback...", exc)

    # Check local fallback directory
    local_dir = os.path.join(os.path.dirname(__file__), "..", "uploads", "emailImages")
    local_path = os.path.join(local_dir, clean_file)
    if os.path.isfile(local_path):
        with open(local_path, "rb") as f:
            data = f.read()
        _, ext = os.path.splitext(clean_file)
        mime_map = {
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".webp": "image/webp",
            ".gif": "image/gif",
        }
        return data, mime_map.get(ext.lower(), "image/jpeg")

    raise FileNotFoundError(f"Email image '{clean_file}' not found.")


def delete_email_image(filename: str) -> bool:
    """Delete an email image from storage."""
    deleted = False
    clean_file = os.path.basename(filename)
    folder = (settings.gcs_email_images_folder or "emailImages").strip("/\\")
    blob_path = f"{folder}/{clean_file}" if folder else clean_file

    try:
        client = get_storage_client()
        bucket = client.bucket(settings.gcs_bucket_name)
        blob = bucket.blob(blob_path)
        if blob.exists():
            blob.delete()
            deleted = True
    except Exception as exc:
        logger.warning("Error deleting email image from GCS: %s", exc)

    local_dir = os.path.join(os.path.dirname(__file__), "..", "uploads", "emailImages")
    local_path = os.path.join(local_dir, clean_file)
    if os.path.isfile(local_path):
        try:
            os.remove(local_path)
            deleted = True
        except Exception:
            pass

    return deleted


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
