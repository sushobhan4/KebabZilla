from datetime import datetime, timedelta, timezone
import hashlib
import secrets

import jwt
from fastapi import Response
from pwdlib import PasswordHash

from app.config import settings

password_hash = PasswordHash.recommended()

SESSION_COOKIE_NAME = settings.session_cookie_name
SESSION_LIFETIME_DAYS = settings.session_lifetime_days


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


def compute_device_fingerprint(user_agent: str | None) -> str:
    # Hash User-Agent to detect and block cross-device/cross-browser session hijacking
    clean_ua = (user_agent or "").strip().lower()
    return hashlib.sha256(clean_ua.encode("utf-8")).hexdigest()


def get_cookie_security_params() -> dict:
    is_production = settings.environment.casefold() == "production"
    secure = settings.session_cookie_secure if settings.session_cookie_secure is not None else is_production

    samesite = settings.session_cookie_samesite.lower()
    if is_production and secure:
        # In production cross-origin deployment (e.g. GitHub Pages -> Cloud Run), SameSite="none" is required
        if samesite == "lax":
            samesite = "none"
    elif not secure:
        # Browsers reject SameSite=None without Secure=True
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

