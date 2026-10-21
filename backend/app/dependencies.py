import logging
import secrets
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select, update
from sqlalchemy.orm import Session, joinedload

from app.cache import auth_cache, auth_metrics
from app.config import settings
from app.db import get_db
from app.models import Account, Role, StaffInfo, UserSession, utcnow
from app.security import (
    CSRF_COOKIE_NAME,
    SESSION_COOKIE_NAME,
    SESSION_LIFETIME_DAYS,
    compute_device_fingerprint,
    decode_access_token,
    hash_session_token,
)

logger = logging.getLogger(__name__)

bearer_scheme = HTTPBearer(auto_error=False)
DbSession = Annotated[Session, Depends(get_db)]


@dataclass(frozen=True)
class AuthContext:
    """Lightweight authentication context.
    Avoids loading full SQLAlchemy Account ORM models for routine authenticated requests.
    Duck-types with Account for id, name, email, phone, role, must_change_password,
    is_accepting_deliveries, promotional_consent, delivery_duty, and addresses.
    """
    id: int
    name: str
    email: str
    phone: str | None
    role: Role
    must_change_password: bool
    is_accepting_deliveries: bool
    session_id: int | None
    token_hash: str | None
    device_fingerprint: str | None
    expires_at: datetime
    promotional_consent: bool = True
    addresses: tuple = ()

    @property
    def delivery_duty(self) -> Any:
        return None


def auth_context_to_cache(auth: AuthContext, last_active_at: datetime) -> dict[str, Any]:
    return {
        "account_id": auth.id,
        "name": auth.name,
        "email": auth.email,
        "phone": auth.phone,
        "role": auth.role.value if isinstance(auth.role, Role) else str(auth.role),
        "must_change_password": bool(auth.must_change_password),
        "is_accepting_deliveries": bool(auth.is_accepting_deliveries),
        "promotional_consent": bool(auth.promotional_consent),
        "session_id": auth.session_id,
        "token_hash": auth.token_hash,
        "device_fingerprint": auth.device_fingerprint,
        "expires_at": auth.expires_at.isoformat() if isinstance(auth.expires_at, datetime) else str(auth.expires_at),
        "last_active_at": last_active_at.isoformat() if isinstance(last_active_at, datetime) else str(last_active_at),
    }


def auth_context_from_cache(cached: dict[str, Any]) -> tuple[AuthContext, datetime]:
    role_raw = cached.get("role", Role.USER)
    try:
        role = Role(role_raw)
    except ValueError:
        role = Role.USER

    exp_raw = cached.get("expires_at")
    if isinstance(exp_raw, str):
        expires_at = datetime.fromisoformat(exp_raw)
    elif isinstance(exp_raw, datetime):
        expires_at = exp_raw
    else:
        expires_at = utcnow()

    last_act_raw = cached.get("last_active_at")
    if isinstance(last_act_raw, str):
        last_active_at = datetime.fromisoformat(last_act_raw)
    elif isinstance(last_act_raw, datetime):
        last_active_at = last_act_raw
    else:
        last_active_at = utcnow()

    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if last_active_at.tzinfo is None:
        last_active_at = last_active_at.replace(tzinfo=timezone.utc)

    auth = AuthContext(
        id=int(cached["account_id"]),
        name=str(cached.get("name", "")),
        email=str(cached.get("email", "")),
        phone=cached.get("phone"),
        role=role,
        must_change_password=bool(cached.get("must_change_password", False)),
        is_accepting_deliveries=bool(cached.get("is_accepting_deliveries", False)),
        promotional_consent=bool(cached.get("promotional_consent", True)),
        session_id=cached.get("session_id"),
        token_hash=cached.get("token_hash"),
        device_fingerprint=cached.get("device_fingerprint"),
        expires_at=expires_at,
    )
    return auth, last_active_at


def current_auth_base(
    request: Request,
    db: DbSession,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
) -> AuthContext:
    start_time = time.perf_counter()
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired session",
        headers={"WWW-Authenticate": "Bearer"},
    )

    # 1. Check Authorization Bearer header first, then fall back to HttpOnly cookie
    bearer_token = credentials.credentials if (credentials and credentials.scheme.casefold() == "bearer") else None
    cookie_token = request.cookies.get(SESSION_COOKIE_NAME)
    token = bearer_token or cookie_token

    if not token:
        raise unauthorized

    # CSRF protection: If authenticated solely via ambient cookie on a state-changing method, verify double-submit CSRF token
    if not bearer_token and cookie_token and request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        csrf_cookie = request.cookies.get(CSRF_COOKIE_NAME)
        csrf_header = request.headers.get("x-csrf-token")
        if not csrf_cookie or not csrf_header or not secrets.compare_digest(csrf_header, csrf_cookie):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="CSRF token missing or invalid",
            )

    now = utcnow()
    token_hash = hash_session_token(token)
    user_agent = request.headers.get("user-agent", "")
    current_fp = compute_device_fingerprint(user_agent)

    def maybe_extend_session(auth: AuthContext, last_active: datetime, cached_dict: dict[str, Any] | None) -> None:
        """30-day sliding activity window: refresh timer on activity (throttled to 30 mins).
        Uses a conditional UPDATE to eliminate write contention from concurrent requests.
        """
        if now - last_active > timedelta(minutes=30):
            threshold = now - timedelta(minutes=30)
            new_expires = now + timedelta(days=SESSION_LIFETIME_DAYS)
            try:
                stmt = (
                    update(UserSession)
                    .where(
                        UserSession.token_hash == token_hash,
                        UserSession.is_revoked == False,
                        UserSession.last_active_at <= threshold,
                    )
                    .values(
                        last_active_at=now,
                        expires_at=new_expires,
                    )
                )
                res = db.execute(stmt)
                db.commit()
                if res.rowcount and res.rowcount > 0:
                    auth_metrics.record_sliding_expiry_update()
                    if cached_dict:
                        cached_dict["last_active_at"] = now.isoformat()
                        cached_dict["expires_at"] = new_expires.isoformat()
                        auth_cache.set(token_hash, cached_dict, ttl_seconds=60.0, account_id=auth.id)
            except Exception as exc:
                db.rollback()
                logger.warning("Sliding session update failed: %s", exc)

    # Fast path: check in-memory auth_cache
    cached = auth_cache.get(token_hash)
    if cached:
        auth_metrics.record_hit()
        auth, last_active = auth_context_from_cache(cached)
        if auth.expires_at <= now:
            auth_cache.delete(token_hash)
            raise unauthorized
        if auth.device_fingerprint and auth.device_fingerprint != current_fp:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session device unrecognized",
                headers={"WWW-Authenticate": "Bearer"},
            )
        maybe_extend_session(auth, last_active, cached)
        auth_metrics.record_auth_latency((time.perf_counter() - start_time) * 1000)
        return auth

    # Cache miss: per-key stampede protection ensures only 1 worker queries DB for this token
    auth_metrics.record_miss()
    with auth_cache.key_lock(token_hash):
        # Double-check cache inside lock
        cached = auth_cache.get(token_hash)
        if cached:
            auth_metrics.record_hit()
            auth, last_active = auth_context_from_cache(cached)
            if auth.expires_at <= now:
                auth_cache.delete(token_hash)
                raise unauthorized
            if auth.device_fingerprint and auth.device_fingerprint != current_fp:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Session device unrecognized",
                    headers={"WWW-Authenticate": "Bearer"},
                )
            maybe_extend_session(auth, last_active, cached)
            auth_metrics.record_auth_latency((time.perf_counter() - start_time) * 1000)
            return auth

        # Fallback to database with single joined query
        auth_metrics.record_db_fallback()
        stmt = (
            select(
                UserSession.id.label("session_id"),
                UserSession.token_hash,
                UserSession.account_id,
                UserSession.device_fingerprint,
                UserSession.last_active_at,
                UserSession.expires_at,
                UserSession.is_revoked,
                Account.id.label("acc_id"),
                Account.name,
                Account.email,
                Account.phone,
                Account.role,
                Account.promotional_consent,
                StaffInfo.must_change_password,
                StaffInfo.is_accepting_deliveries,
            )
            .join(Account, UserSession.account_id == Account.id)
            .outerjoin(StaffInfo, StaffInfo.account_id == Account.id)
            .where(UserSession.token_hash == token_hash, UserSession.is_revoked == False)
        )
        row = db.execute(stmt).first()
        if row:
            exp = row.expires_at
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if exp <= now:
                db.execute(
                    update(UserSession)
                    .where(UserSession.token_hash == token_hash)
                    .values(is_revoked=True)
                )
                db.commit()
                raise unauthorized

            is_staff = row.role != Role.USER
            mcp = bool(row.must_change_password) if is_staff else False
            iad = bool(row.is_accepting_deliveries) if (row.role in (Role.ADMIN, Role.DELIVERY)) else False

            auth = AuthContext(
                id=row.acc_id,
                name=row.name,
                email=row.email,
                phone=row.phone,
                role=row.role,
                must_change_password=mcp,
                is_accepting_deliveries=iad,
                promotional_consent=bool(row.promotional_consent),
                session_id=row.session_id,
                token_hash=row.token_hash,
                device_fingerprint=row.device_fingerprint,
                expires_at=exp,
            )

            last_act = row.last_active_at
            if last_act.tzinfo is None:
                last_act = last_act.replace(tzinfo=timezone.utc)

            cache_data = auth_context_to_cache(auth, last_act)
            auth_cache.set(token_hash, cache_data, ttl_seconds=60.0, account_id=auth.id)

            if row.device_fingerprint and row.device_fingerprint != current_fp:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Session device unrecognized",
                    headers={"WWW-Authenticate": "Bearer"},
                )

            maybe_extend_session(auth, last_act, cache_data)
            auth_metrics.record_auth_latency((time.perf_counter() - start_time) * 1000)
            return auth

    # 3. Fallback: Support legacy JWT tokens for backward compatibility
    try:
        account_id = decode_access_token(token)
    except (jwt.InvalidTokenError, ValueError, KeyError):
        raise unauthorized
    account = db.get(Account, account_id, options=[joinedload(Account.staff_info)])
    if account is None:
        raise unauthorized

    auth = AuthContext(
        id=account.id,
        name=account.name,
        email=account.email,
        phone=account.phone,
        role=account.role,
        must_change_password=account.must_change_password,
        is_accepting_deliveries=account.is_accepting_deliveries,
        promotional_consent=account.promotional_consent,
        session_id=None,
        token_hash=token_hash,
        device_fingerprint=current_fp,
        expires_at=now + timedelta(days=1),
    )
    auth_metrics.record_auth_latency((time.perf_counter() - start_time) * 1000)
    return auth


def current_auth(
    auth: Annotated[AuthContext, Depends(current_auth_base)],
) -> AuthContext:
    if auth.must_change_password:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Change your temporary password before continuing",
        )
    return auth


def get_current_account_model(
    auth: Annotated[AuthContext, Depends(current_auth)],
    db: DbSession,
) -> Account:
    """Explicitly load the full SQLAlchemy Account model for endpoints that genuinely require it
    (e.g., profile editing, password changing, ORM relationship mutations).
    """
    auth_metrics.record_account_load()
    account = db.get(Account, auth.id, options=[joinedload(Account.staff_info)])
    if not account:
        auth_cache.delete(auth.token_hash)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account not found")
    return account


def get_current_account_base_model(
    auth: Annotated[AuthContext, Depends(current_auth_base)],
    db: DbSession,
) -> Account:
    """Explicitly load the full SQLAlchemy Account model without enforcing password change check
    (used for initial /me profile hydration and password update endpoints).
    """
    auth_metrics.record_account_load()
    account = db.get(Account, auth.id, options=[joinedload(Account.staff_info)])
    if not account:
        auth_cache.delete(auth.token_hash)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account not found")
    return account


# Type annotations for lightweight context (zero DB lookup on warm cache)
CurrentAuth = Annotated[AuthContext, Depends(current_auth)]
PasswordChangeAuth = Annotated[AuthContext, Depends(current_auth_base)]

# Type annotations for full ORM model
CurrentAccountModel = Annotated[Account, Depends(get_current_account_model)]
PasswordChangeAccountModel = Annotated[Account, Depends(get_current_account_base_model)]

# Backward compatibility aliases: default to lightweight AuthContext
current_account = current_auth
current_account_base = current_auth_base
CurrentAccount = CurrentAuth
PasswordChangeAccount = PasswordChangeAuth


def require_roles(*roles: Role):
    def dependency(auth: CurrentAuth) -> AuthContext:
        if auth.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to this action",
            )
        return auth

    return dependency
