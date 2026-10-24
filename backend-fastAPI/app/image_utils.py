"""Image utility functions for email notifications and marketing campaigns.

Provides server-side Gaussian blur and URL transforms so email clients like Gmail,
Outlook, and mobile mail apps (which strip CSS backdrop-filter and filter properties)
reliably render ambient background blur.
"""

import io
import urllib.parse

try:
    from PIL import Image, ImageFilter
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

from app.config import settings

_BLUR_CACHE: dict[tuple[int, int], tuple[bytes, str]] = {}
_MAX_CACHE_SIZE = 64


def blur_image_bytes(data: bytes, content_type: str = "image/jpeg", blur_radius: int = 20) -> tuple[bytes, str]:
    """Applies Gaussian blur to image bytes, returning (blurred_bytes, mime_type)."""
    if not HAS_PIL or blur_radius <= 0 or not data:
        return data, content_type

    safe_radius = max(1, min(150, int(blur_radius)))
    cache_key = (hash(data), safe_radius)
    if cache_key in _BLUR_CACHE:
        return _BLUR_CACHE[cache_key]

    try:
        im = Image.open(io.BytesIO(data))
        blurred = im.filter(ImageFilter.GaussianBlur(radius=safe_radius))

        out_buf = io.BytesIO()
        is_png = (im.format == "PNG") or ("png" in content_type.lower())
        has_alpha = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)

        if is_png and has_alpha:
            blurred.save(out_buf, format="PNG", optimize=True)
            res_bytes = out_buf.getvalue()
            res_ctype = "image/png"
        else:
            if blurred.mode != "RGB":
                blurred = blurred.convert("RGB")
            blurred.save(out_buf, format="JPEG", quality=85, optimize=True)
            res_bytes = out_buf.getvalue()
            res_ctype = "image/jpeg"

        if len(_BLUR_CACHE) >= _MAX_CACHE_SIZE:
            _BLUR_CACHE.clear()
        _BLUR_CACHE[cache_key] = (res_bytes, res_ctype)
        return res_bytes, res_ctype
    except Exception:
        return data, content_type


def get_blurred_image_url(image_url: str | None, blur: int = 20) -> str:
    """Transforms an image URL into a URL that serves the blurred image asset directly.

    - For Unsplash images, appends the native `blur` query parameter for CDN-side blur.
    - For KebabZilla backend email-image assets, appends `blur` query parameter.
    - For other external URLs, routes through the backend blur proxy.
    """
    raw = (image_url or "").strip()
    if not raw or blur <= 0:
        return raw

    safe_blur = max(1, min(150, int(blur)))
    backend_base = (getattr(settings, "public_backend_url", None) or "https://api.kebabzilla.in").rstrip("/")

    # 1. Unsplash images (Imgix powered)
    if "images.unsplash.com" in raw:
        parsed = urllib.parse.urlsplit(raw)
        query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
        query = [(k, v) for k, v in query if k != "blur"]
        query.append(("blur", str(safe_blur)))
        return urllib.parse.urlunsplit(parsed._replace(query=urllib.parse.urlencode(query)))

    # 2. Local/backend email images
    if "email-images/" in raw or "emailImages/" in raw:
        full_url = raw if raw.startswith("http") else f"{backend_base}{raw}"
        parsed = urllib.parse.urlsplit(full_url)
        query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
        query = [(k, v) for k, v in query if k != "blur"]
        query.append(("blur", str(safe_blur)))
        return urllib.parse.urlunsplit(parsed._replace(query=urllib.parse.urlencode(query)))

    # 3. Arbitrary external image (route through proxy)
    if raw.startswith("http://") or raw.startswith("https://"):
        encoded = urllib.parse.quote(raw, safe="")
        return f"{backend_base}/api/v1/public/email-images-proxy?url={encoded}&blur={safe_blur}"

    return raw
