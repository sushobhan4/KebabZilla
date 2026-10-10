from datetime import timedelta
import secrets
import time
from collections import defaultdict
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.dependencies import CurrentAccount, DbSession, PasswordChangeAccount, bearer_scheme
from app.integrations import staff_account_notifier
from app.models import Account, AccountAddress, PasswordResetCode, Role, UserSession, utcnow
from app.schemas import AccountCreate, AccountOut, AccountProfileUpdate, GoogleLoginRequest, LoginRequest, PasswordResetConfirm, PasswordResetRequest, PasswordUpdate, TokenOut
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from app.security import (
    SESSION_COOKIE_NAME,
    SESSION_LIFETIME_DAYS,
    compute_device_fingerprint,
    delete_session_cookie,
    generate_session_token,
    hash_password,
    hash_session_token,
    set_session_cookie,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["authentication"])


def issue_session(account: Account, request: Request, response: Response, db: Session) -> TokenOut:
    raw_token = generate_session_token()
    token_hash = hash_session_token(raw_token)
    user_agent = request.headers.get("user-agent", "")
    ip_address = request.client.host if request.client else ""
    device_fingerprint = compute_device_fingerprint(user_agent)
    now = utcnow()
    expires_at = now + timedelta(days=SESSION_LIFETIME_DAYS)

    session = UserSession(
        account_id=account.id,
        token_hash=token_hash,
        user_agent=user_agent[:512],
        ip_address=ip_address[:64],
        device_fingerprint=device_fingerprint,
        created_at=now,
        last_active_at=now,
        expires_at=expires_at,
        is_revoked=False,
    )
    db.add(session)
    db.commit()

    set_session_cookie(response, raw_token)

    return TokenOut(
        access_token=raw_token,
        token_type="bearer",
        expires_in=SESSION_LIFETIME_DAYS * 86400,
        account=AccountOut.model_validate(account),
    )


@router.post("/register", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
def register(data: AccountCreate, request: Request, response: Response, db: DbSession):
    email = data.email.lower().strip()
    if db.scalar(select(Account.id).where(Account.email == email)):
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    account = Account(
        name=data.name.strip(),
        email=email,
        phone=data.phone,
        password_hash=hash_password(data.password),
        role=Role.USER,
    )
    account.addresses = [
        AccountAddress(address_id="home", label="Home", is_default=True),
        AccountAddress(address_id="work", label="Work"),
    ]
    db.add(account)
    db.commit()
    db.refresh(account)
    return issue_session(account, request, response, db)


import time
from collections import defaultdict

_failed_logins: dict[str, list[float]] = defaultdict(list)


def check_login_rate_limit(key: str) -> None:
    now = time.time()
    attempts = [t for t in _failed_logins[key] if now - t < 300]
    _failed_logins[key] = attempts
    if len(attempts) >= 5:
        raise HTTPException(
            status_code=429,
            detail="Too many failed login attempts. Please wait 5 minutes before trying again.",
        )


def record_failed_login(key: str) -> None:
    _failed_logins[key].append(time.time())


def clear_failed_logins(key: str) -> None:
    _failed_logins.pop(key, None)


@router.post("/login", response_model=TokenOut)
def login(data: LoginRequest, request: Request, response: Response, db: DbSession):
    email = data.email.lower().strip()
    check_login_rate_limit(email)
    account = db.scalar(select(Account).where(Account.email == email))
    if not account or not verify_password(data.password, account.password_hash):
        record_failed_login(email)
        raise HTTPException(status_code=401, detail="Email or password is incorrect")
    clear_failed_logins(email)
    return issue_session(account, request, response, db)


def verify_google_token(credential: str) -> dict:
    client_id = (settings.google_client_id or "").strip()
    errors: list[str] = []

    # 1. Primary: Verify locally with 120s clock skew tolerance
    try:
        return id_token.verify_oauth2_token(
            credential,
            google_requests.Request(),
            client_id,
            clock_skew_in_seconds=120,
        )
    except Exception as exc:
        errors.append(f"local: {exc}")

    # 2. Fallback: Verify directly with Google's tokeninfo service
    try:
        import httpx
        with httpx.Client(timeout=6.0) as client:
            resp = client.get("https://oauth2.googleapis.com/tokeninfo", params={"id_token": credential})
            if resp.status_code == 200:
                payload = resp.json()
                aud = payload.get("aud")
                if aud == client_id:
                    return payload
                errors.append(f"tokeninfo aud mismatch: expected {client_id}, got {aud}")
            else:
                errors.append(f"tokeninfo HTTP {resp.status_code}: {resp.text}")
    except Exception as exc:
        errors.append(f"tokeninfo error: {exc}")

    raise ValueError("; ".join(errors))


@router.post("/google", response_model=TokenOut)
def google_login(
    data: GoogleLoginRequest,
    request: Request,
    response: Response,
    db: DbSession,
):
    if not settings.google_client_id:
        raise HTTPException(
            status_code=500,
            detail="Google sign-in is not configured on the server (GOOGLE_CLIENT_ID missing in backend/.env)",
        )
    try:
        id_info = verify_google_token(data.credential)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid Google credential token: {exc}") from exc

    email = id_info.get("email", "").lower().strip()
    if not email:
        raise HTTPException(status_code=400, detail="Google account has no email address")

    account = db.scalar(select(Account).where(Account.email == email))
    if not account:
        name = (id_info.get("name") or email.split("@")[0]).strip()
        account = Account(
            name=name[:120],
            email=email,
            phone=None,
            password_hash=hash_password(secrets.token_urlsafe(32)),
            role=Role.USER,
        )
        account.addresses = [
            AccountAddress(address_id="home", label="Home", is_default=True),
            AccountAddress(address_id="work", label="Work"),
        ]
        db.add(account)
        db.commit()
        db.refresh(account)

    return issue_session(account, request, response, db)


@router.post("/forgot-password")
def request_password_reset(data: PasswordResetRequest, db: DbSession):
    email = data.email.lower().strip()
    account = db.scalar(select(Account).where(Account.email == email))
    if account:
        recent = db.scalar(
            select(PasswordResetCode).where(
                PasswordResetCode.account_id == account.id,
                PasswordResetCode.created_at >= utcnow() - timedelta(seconds=60),
            )
        )
        if not recent:
            db.query(PasswordResetCode).filter(
                (PasswordResetCode.account_id == account.id) | (PasswordResetCode.expires_at <= utcnow())
            ).delete(synchronize_session=False)
            otp = f"{secrets.randbelow(1_000_000):06d}"
            reset_code = PasswordResetCode(
                account_id=account.id,
                otp_hash=hash_password(otp),
                expires_at=utcnow() + timedelta(minutes=10),
            )
            db.add(reset_code)
            db.flush()
            try:
                sent = staff_account_notifier.send_password_reset_otp(name=account.name, email=account.email, otp=otp)
                if not sent:
                    db.delete(reset_code)
            except Exception:
                db.delete(reset_code)
            db.commit()
    return {"message": "If an active account uses that email, a password reset code has been sent."}


@router.post("/reset-password", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(data: PasswordResetConfirm, db: DbSession):
    email = data.email.lower().strip()
    account = db.scalar(select(Account).where(Account.email == email))
    if not account:
        raise HTTPException(status_code=400, detail="The code is invalid or has expired")
    reset_code = db.scalar(
        select(PasswordResetCode)
        .where(
            PasswordResetCode.account_id == account.id,
        )
        .order_by(PasswordResetCode.created_at.desc())
    )
    expires_at = reset_code.expires_at if reset_code else None
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=utcnow().tzinfo)
    if not reset_code or not expires_at or expires_at <= utcnow() or reset_code.attempts >= 5:
        if reset_code:
            db.delete(reset_code)
            db.commit()
        raise HTTPException(status_code=400, detail="The code is invalid or has expired")
    if not verify_password(data.otp, reset_code.otp_hash):
        reset_code.attempts += 1
        if reset_code.attempts >= 5:
            db.delete(reset_code)
        db.commit()
        raise HTTPException(status_code=400, detail="The code is invalid or has expired")

    account.password_hash = hash_password(data.new_password)
    account.must_change_password = False
    # Remove the password reset OTP row once used
    db.delete(reset_code)

    # Invalidate all active sessions for this account across all devices on password reset
    db.query(UserSession).filter(UserSession.account_id == account.id).update(
        {UserSession.is_revoked: True},
        synchronize_session=False,
    )
    db.commit()


@router.get("/me", response_model=AccountOut)
def me(account: PasswordChangeAccount, request: Request, response: Response):
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if token:
        set_session_cookie(response, token)
    return account


@router.patch("/profile", response_model=AccountOut)
def update_profile(data: AccountProfileUpdate, account: CurrentAccount, db: DbSession):
    email = str(data.email).lower().strip()
    duplicate = db.scalar(select(Account.id).where(Account.email == email, Account.id != account.id))
    if duplicate:
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    account.name = data.name.strip()
    account.email = email
    account.phone = data.phone.strip() if data.phone else None
    if account.role == Role.USER and data.addresses is not None:
        addresses = [item.model_dump() for item in data.addresses]
        ids = [item["id"] for item in addresses]
        if len(ids) != len(set(ids)):
            raise HTTPException(status_code=422, detail="Each saved address needs a unique id")
        for address_id, label in (("home", "Home"), ("work", "Work")):
            if address_id not in ids:
                addresses.append({"id": address_id, "label": label, "house_number": "", "road": "", "area": "", "city": "", "pincode": "", "landmark": "", "latitude": None, "longitude": None, "is_default": False})
        defaults = [item for item in addresses if item.get("is_default")]
        if len(defaults) > 1:
            raise HTTPException(status_code=422, detail="Choose only one default delivery address")
        if not defaults and addresses:
            addresses[0]["is_default"] = True
        existing_by_id = {addr.address_id: addr for addr in account.addresses}
        incoming_ids = set()
        for item in addresses:
            addr_id = item.pop("id")
            incoming_ids.add(addr_id)
            if addr_id in existing_by_id:
                existing = existing_by_id[addr_id]
                for key, val in item.items():
                    setattr(existing, key, val)
            else:
                account.addresses.append(
                    AccountAddress(
                        address_id=addr_id,
                        **item,
                    )
                )

        for addr in list(account.addresses):
            if addr.address_id not in incoming_ids:
                account.addresses.remove(addr)
    db.commit()
    db.refresh(account)
    return account


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(data: PasswordUpdate, account: PasswordChangeAccount, request: Request, db: DbSession):
    if not verify_password(data.current_password, account.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if verify_password(data.new_password, account.password_hash):
        raise HTTPException(status_code=400, detail="Choose a new password you have not used before")
    account.password_hash = hash_password(data.new_password)
    account.must_change_password = False

    # Revoke sessions on all other devices, keeping current device active
    current_token = request.cookies.get(SESSION_COOKIE_NAME)
    current_hash = hash_session_token(current_token) if current_token else None
    query = db.query(UserSession).filter(UserSession.account_id == account.id)
    if current_hash:
        query = query.filter(UserSession.token_hash != current_hash)
    query.update({UserSession.is_revoked: True}, synchronize_session=False)

    db.commit()


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    request: Request,
    response: Response,
    db: DbSession,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)] = None,
):
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token and credentials and credentials.scheme.casefold() == "bearer":
        token = credentials.credentials
    if token:
        token_hash = hash_session_token(token)
        db.query(UserSession).filter(UserSession.token_hash == token_hash).update(
            {UserSession.is_revoked: True},
            synchronize_session=False,
        )
        db.commit()

    delete_session_cookie(response)

