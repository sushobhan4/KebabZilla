from datetime import datetime, timedelta, timezone
import functools
import hashlib
import ipaddress
import re
import secrets

import httpx
import jwt
from fastapi import Request, Response
from pwdlib import PasswordHash

from app.config import settings

password_hash = PasswordHash.recommended()

SESSION_COOKIE_NAME = settings.session_cookie_name
SESSION_LIFETIME_DAYS = settings.session_lifetime_days


def validate_password_complexity(password: str) -> None:
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters long")
    if not re.search(r"[a-z]", password):
        raise ValueError("Password must contain at least one lowercase letter")
    if not re.search(r"[A-Z]", password):
        raise ValueError("Password must contain at least one uppercase letter")
    if not re.search(r"\d", password):
        raise ValueError("Password must contain at least one number")
    if not re.search(r"[^A-Za-z0-9]", password):
        raise ValueError("Password must contain at least one special character")


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return password_hash.verify(password, hashed)


def generate_session_token() -> str:
    # 256 bits of cryptographically secure entropy
    return secrets.token_urlsafe(32)


def hash_session_token(token: str) -> str:
    # SHA-256 hex digest so raw tokens are never exposed in server storage
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def normalize_user_agent_for_fingerprint(user_agent: str | None) -> str:
    """Normalize User-Agent string to strip volatile minor build/patch digits and transient tags,
    preserving core device platform and major browser family to avoid false-positive session drops
    during silent browser updates or minor environment shifts.
    """
    if not user_agent:
        return "empty"
    ua = user_agent.strip().lower()
    # Normalize minor browser version numbers to major version only:
    # e.g., 'chrome/133.0.6943.53' -> 'chrome/133', 'version/17.4.1' -> 'version/17'
    ua = re.sub(r"([a-z]+)/(\d+)\.[\d\.]+", r"\1/\2", ua)
    # Remove volatile build tags like 'build/xyz' or 'build/12345'
    ua = re.sub(r"build/[\w\.-]+", "", ua)
    # Remove Apple WebKit minor build fractions: 'applewebkit/537.36' -> 'applewebkit/537'
    ua = re.sub(r"applewebkit/(\d+)\.[\d\.]+", r"applewebkit/\1", ua)
    # Remove excess whitespace
    ua = re.sub(r"\s+", " ", ua).strip()
    return ua


def compute_device_fingerprint(user_agent: str | None) -> str:
    # Hash normalized User-Agent to detect and block cross-device/cross-browser session hijacking
    # while tolerating silent browser minor/patch updates
    normalized_ua = normalize_user_agent_for_fingerprint(user_agent)
    return hashlib.sha256(normalized_ua.encode("utf-8")).hexdigest()


def parse_device_info(user_agent: str | None) -> dict[str, str]:
    ua = (user_agent or "").strip()
    device_type = "desktop"
    device_name = "Desktop"

    if not ua:
        return {"device_name": "Unknown device", "device_type": "desktop"}

    if "iPad" in ua:
        device_type = "tablet"
        device_name = "iPad"
    elif "iPhone" in ua:
        device_type = "mobile"
        device_name = "iPhone"
    elif "Android" in ua:
        device_type = "tablet" if ("Tablet" in ua or "tab" in ua.lower()) else "mobile"
        match = re.search(r"Android\s+[\d\.]+;\s*([^;)]+?)(?:\s+Build|\s*;|\))", ua, re.IGNORECASE)
        if match:
            raw_model = match.group(1).strip()
            raw_model = re.sub(r"\s+Build.*$", "", raw_model, flags=re.IGNORECASE).strip()
            if raw_model and raw_model.lower() not in ("k", "wv", "mobile"):
                device_name = raw_model
            else:
                device_name = "Android device"
        else:
            device_name = "Android device"
    elif "Windows" in ua:
        device_type = "desktop"
        device_name = "Windows"
    elif "Macintosh" in ua or "Mac OS" in ua:
        device_type = "desktop"
        device_name = "Mac"
    elif "Linux" in ua:
        device_type = "desktop"
        device_name = "Linux"

    return {"device_name": device_name, "device_type": device_type}


@functools.lru_cache(maxsize=2048)
def resolve_ip_location(ip: str | None) -> dict[str, str]:
    clean_ip = (ip or "").strip()
    if not clean_ip or clean_ip in ("localhost", "testclient"):
        return {"country": "Local", "region": "", "city": "Localhost"}

    try:
        obj = ipaddress.ip_address(clean_ip)
        if obj.is_private or obj.is_loopback or obj.is_reserved or obj.is_link_local:
            return {"country": "Local", "region": "", "city": "Localhost"}
    except ValueError:
        return {"country": "Unknown", "region": "", "city": "Unknown"}

    try:
        resp = httpx.get(
            f"http://ip-api.com/json/{clean_ip}?fields=status,country,regionName,city",
            timeout=2.5,
        )
        if resp.status_code == 200:
            data = resp.json()
            if data.get("status") == "success":
                return {
                    "country": (data.get("country") or "").strip(),
                    "region": (data.get("regionName") or "").strip(),
                    "city": (data.get("city") or "").strip(),
                }
    except Exception:
        pass

    return {"country": "Unknown", "region": "", "city": "Unknown"}


def get_cookie_security_params() -> dict:
    is_production = settings.environment.casefold() == "production"
    secure = settings.session_cookie_secure if settings.session_cookie_secure is not None else is_production
    samesite = settings.session_cookie_samesite.lower()

    if samesite not in ("lax", "strict"):
        samesite = "lax"

    return {
        "httponly": True,
        "secure": secure,
        "samesite": samesite,
        "path": "/",
    }


def set_session_cookie(response: Response, raw_token: str) -> None:
    params = get_cookie_security_params()
    max_age = settings.session_lifetime_days * 86400
    response.set_cookie(
        key=settings.session_cookie_name,
        value=raw_token,
        max_age=max_age,
        expires=max_age,
        **params,
    )


def delete_session_cookie(response: Response) -> None:
    params = get_cookie_security_params()
    response.delete_cookie(
        key=settings.session_cookie_name,
        path=params.get("path", "/"),
        httponly=params.get("httponly", True),
        secure=params.get("secure", False),
        samesite=params.get("samesite", "lax"),
    )


CSRF_COOKIE_NAME = "kz_csrf_token"


def generate_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def set_csrf_cookie(response: Response, token: str) -> None:
    params = get_cookie_security_params()
    max_age = settings.session_lifetime_days * 86400
    response.set_cookie(
        key=CSRF_COOKIE_NAME,
        value=token,
        max_age=max_age,
        expires=max_age,
        path=params.get("path", "/"),
        httponly=False,
        secure=params.get("secure", False),
        samesite=params.get("samesite", "lax"),
    )


def delete_csrf_cookie(response: Response) -> None:
    params = get_cookie_security_params()
    response.delete_cookie(
        key=CSRF_COOKIE_NAME,
        path=params.get("path", "/"),
        httponly=False,
        secure=params.get("secure", False),
        samesite=params.get("samesite", "lax"),
    )


def create_access_token(account_id: int) -> tuple[str, int]:
    expires_in = settings.access_token_minutes * 60
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(account_id),
        "iss": settings.jwt_issuer,
        "iat": now,
        "exp": now + timedelta(seconds=expires_in),
        "type": "access",
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256"), expires_in


def decode_access_token(token: str) -> int:
    payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"], issuer=settings.jwt_issuer)
    if payload.get("type") != "access":
        raise jwt.InvalidTokenError("Wrong token type")
    return int(payload["sub"])


import phonenumbers
import re

def normalize_phone_e164(phone: str | None, default_region: str = "IN") -> str | None:
    if not phone:
        return None
    phone_clean = phone.strip()
    if not phone_clean or phone_clean == "+91":
        return None
    try:
        parsed = phonenumbers.parse(phone_clean, default_region)
        if phonenumbers.is_valid_number(parsed):
            nat = str(parsed.national_number)
            if len(nat) == 10:
                return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
    except Exception:
        pass
    # Strict 10-digit extraction
    digits = re.sub(r"\D", "", phone_clean)
    if digits.startswith("91") and len(digits) == 12:
        digits = digits[2:]
    elif digits.startswith("0") and len(digits) == 11:
        digits = digits[1:]
    if len(digits) == 10:
        return f"+91{digits}"
    raise ValueError("Mobile number must be a valid 10-digit number")


def generate_2fa_code() -> str:
    """Generate a secure 6-digit numeric verification code."""
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_2fa_code(code: str) -> str:
    """Hash the 2FA code with HMAC-SHA256 using the JWT secret."""
    import hmac
    return hmac.new(settings.jwt_secret.encode(), code.encode(), hashlib.sha256).hexdigest()


def verify_2fa_code(code: str, hashed: str) -> bool:
    """Constant-time comparison for 2FA verification."""
    expected = hash_2fa_code(code)
    return secrets.compare_digest(expected, hashed)


def generate_2fa_temp_token() -> str:
    return secrets.token_urlsafe(32)


def hash_2fa_temp_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def get_client_ip(request: Request | None) -> str:
    """
    Extract the real client IP address from request headers or socket.
    Prioritizes headers set by reverse proxies / CDNs (Cloudflare, Cloud Run, Nginx).
    """
    if not request:
        return ""

    # 1. Cloudflare header: CF-Connecting-IP
    # Cloudflare overwrites this header with the client's actual IP address before forwarding.
    cf_ip = request.headers.get("cf-connecting-ip")
    if cf_ip:
        ip = cf_ip.strip()
        if ip:
            return ip

    # 2. X-Real-IP (set by Nginx / reverse proxies)
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        ip = real_ip.strip()
        if ip:
            return ip

    # 3. X-Forwarded-For (standard header: client, proxy1, proxy2)
    # The original client IP is the first non-empty IP in the comma-separated list
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        parts = [p.strip() for p in forwarded_for.split(",") if p.strip()]
        if parts:
            return parts[0]

    # 4. Fallback to raw TCP socket remote address
    if request.client and request.client.host:
        return request.client.host.strip()

    return ""


