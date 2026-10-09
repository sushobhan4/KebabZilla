from datetime import timedelta
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models import Account, Role, UserSession, utcnow
from app.security import (
    SESSION_COOKIE_NAME,
    SESSION_LIFETIME_DAYS,
    compute_device_fingerprint,
    decode_access_token,
    hash_session_token,
)

bearer_scheme = HTTPBearer(auto_error=False)
DbSession = Annotated[Session, Depends(get_db)]


def current_account_base(
    request: Request,
    db: DbSession,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
) -> Account:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired session",
        headers={"WWW-Authenticate": "Bearer"},
    )

    # 1. Check HttpOnly cookie first, then fall back to Authorization header
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token and credentials and credentials.scheme.casefold() == "bearer":
        token = credentials.credentials

    if not token:
        raise unauthorized

    now = utcnow()

    # 2. Check if token corresponds to an active UserSession in the database
    token_hash = hash_session_token(token)
    session = db.query(UserSession).filter(
        UserSession.token_hash == token_hash,
        UserSession.is_revoked == False,
    ).first()

    if session:
        expires_at = session.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=now.tzinfo)

        if expires_at <= now:
            session.is_revoked = True
            db.commit()
            raise unauthorized

        # Device fingerprint protection: detects cross-device cookie theft
        user_agent = request.headers.get("user-agent", "")
        current_fp = compute_device_fingerprint(user_agent)
        if session.device_fingerprint and session.device_fingerprint != current_fp:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session device unrecognized",
                headers={"WWW-Authenticate": "Bearer"},
            )

        # 30-day sliding activity window: refresh timer on activity
        last_active = session.last_active_at
        if last_active.tzinfo is None:
            last_active = last_active.replace(tzinfo=now.tzinfo)

        if now - last_active > timedelta(minutes=5):
            session.last_active_at = now
            session.expires_at = now + timedelta(days=SESSION_LIFETIME_DAYS)
            db.commit()

        account = session.account
        if account is None:
            raise unauthorized
        return account

    # 3. Fallback: Support legacy JWT tokens for backward compatibility
    try:
        account_id = decode_access_token(token)
    except (jwt.InvalidTokenError, ValueError, KeyError):
        raise unauthorized
    account = db.get(Account, account_id)
    if account is None:
        raise unauthorized
    return account


def current_account(
    request: Request,
    db: DbSession,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
) -> Account:
    account = current_account_base(request, db, credentials)
    if account.must_change_password:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Change your temporary password before continuing")
    return account


CurrentAccount = Annotated[Account, Depends(current_account)]
# The sign-in bootstrap and password update endpoints must remain available to
# an account that has been provisioned with a temporary password.
PasswordChangeAccount = Annotated[Account, Depends(current_account_base)]


def require_roles(*roles: Role):
    def dependency(account: CurrentAccount) -> Account:
        # Role comes from the database-loaded account; claims supplied by the browser are never used.
        if account.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to this action")
        return account

    return dependency
