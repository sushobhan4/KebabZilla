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

