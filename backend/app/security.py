from datetime import datetime, timedelta, timezone

import jwt
from pwdlib import PasswordHash

from app.config import settings

password_hash = PasswordHash.recommended()


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return password_hash.verify(password, hashed)


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
