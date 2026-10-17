from datetime import timedelta
import secrets
import threading
import time
from collections import defaultdict
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Cookie, Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.dependencies import CurrentAccount, DbSession, PasswordChangeAccount, bearer_scheme
from app.integrations import staff_account_notifier
from app.models import Account, AccountAddress, PasswordResetCode, Role, TwoFactorChallenge, UserSession, utcnow
from app.schemas import (
    AccountCreate,
    AccountOut,
    AccountProfileUpdate,
    GoogleLoginRequest,
    LoginRequest,
    PasswordResetConfirm,
    PasswordResetRequest,
    PasswordUpdate,
    PromotionalConsentUpdate,
    TokenOut,
    TwoFactorVerifyRequest,
)
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from app.security import (
    CSRF_COOKIE_NAME,
    SESSION_COOKIE_NAME,
    SESSION_LIFETIME_DAYS,
    compute_device_fingerprint,
    delete_csrf_cookie,
    delete_session_cookie,
    generate_2fa_code,
    generate_2fa_temp_token,
    generate_csrf_token,
    generate_session_token,
    hash_2fa_code,
    hash_2fa_temp_token,
    hash_password,
    hash_session_token,
    set_csrf_cookie,
    set_session_cookie,
    verify_2fa_code,
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

    csrf_token = generate_csrf_token()
    set_session_cookie(response, raw_token)
    set_csrf_cookie(response, csrf_token)
    response.headers["x-csrf-token"] = csrf_token

    return TokenOut(
        access_token=raw_token,
        token_type="bearer",
        expires_in=SESSION_LIFETIME_DAYS * 86400,
        account=AccountOut.model_validate(account),
        csrf_token=csrf_token,
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
        promotional_consent=data.promotional_consent,
    )
    account.addresses = [
        AccountAddress(address_id="home", label="Home", is_default=True),
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


def initiate_2fa_challenge(
    account: Account,
    db: Session,
    background_tasks: BackgroundTasks | None = None,
) -> TokenOut:
    code = generate_2fa_code()
    code_hash = hash_2fa_code(code)
    temp_token = generate_2fa_temp_token()
    token_hash = hash_2fa_temp_token(temp_token)
    expires_at = utcnow() + timedelta(minutes=10)

    db.query(TwoFactorChallenge).filter(TwoFactorChallenge.account_id == account.id).delete(synchronize_session=False)
    challenge = TwoFactorChallenge(
        account_id=account.id,
        token_hash=token_hash,
        code_hash=code_hash,
        expires_at=expires_at,
        attempts=0,
    )
    db.add(challenge)
    db.commit()

    # Dispatch 2FA email in background so staff login screen transitions immediately without freezing
    if background_tasks is not None:
        background_tasks.add_task(
            staff_account_notifier.send_2fa_code,
            name=account.name,
            email=account.email,
            code=code,
        )
    else:
        threading.Thread(
            target=staff_account_notifier.send_2fa_code,
            kwargs={"name": account.name, "email": account.email, "code": code},
            daemon=True,
        ).start()

    return TokenOut(
        requires_2fa=True,
        temp_token=temp_token,
        email=account.email,
        role=account.role,
    )


@router.post("/login", response_model=TokenOut)
def login(
    data: LoginRequest,
    request: Request,
    response: Response,
    db: DbSession,
    background_tasks: BackgroundTasks,
):
    email = data.email.lower().strip()
    ip_address = request.client.host if request.client else "unknown"
    rate_limit_key = f"{ip_address}:{email}"
    check_login_rate_limit(rate_limit_key)
    account = db.scalar(select(Account).where(Account.email == email))
    if not account or not verify_password(data.password, account.password_hash):
        record_failed_login(rate_limit_key)
        raise HTTPException(status_code=401, detail="Email or password is incorrect")
    clear_failed_logins(rate_limit_key)

    if account.role in (Role.ADMIN, Role.EMPLOYEE, Role.DELIVERY):
        return initiate_2fa_challenge(account, db, background_tasks)

    return issue_session(account, request, response, db)


@router.post("/verify-2fa", response_model=TokenOut)
def verify_2fa(
    data: TwoFactorVerifyRequest,
    request: Request,
    response: Response,
    db: DbSession,
):
    token_hash = hash_2fa_temp_token(data.temp_token)
    challenge = db.scalar(select(TwoFactorChallenge).where(TwoFactorChallenge.token_hash == token_hash))
    if not challenge:
        raise HTTPException(status_code=400, detail="Invalid or expired 2-step verification session")
    expires_at = challenge.expires_at if challenge.expires_at.tzinfo else challenge.expires_at.replace(tzinfo=utcnow().tzinfo)
    if expires_at < utcnow():
        db.delete(challenge)
        db.commit()
        raise HTTPException(status_code=400, detail="Verification code has expired. Please log in again.")
    if challenge.attempts >= 5:
        db.delete(challenge)
        db.commit()
        raise HTTPException(status_code=429, detail="Too many invalid attempts. Please log in again.")

    if not verify_2fa_code(data.code.strip(), challenge.code_hash):
        challenge.attempts += 1
        db.commit()
        raise HTTPException(status_code=400, detail="Invalid verification code")

    account = db.get(Account, challenge.account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    db.delete(challenge)
    db.commit()

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
    background_tasks: BackgroundTasks,
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

    if not id_info.get("email_verified"):
        raise HTTPException(status_code=400, detail="Google email address is not verified")

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
        ]
        db.add(account)
        db.commit()
        db.refresh(account)
    elif account.must_change_password:
        account.must_change_password = False
        db.commit()

    if account.role in (Role.ADMIN, Role.EMPLOYEE, Role.DELIVERY):
        return initiate_2fa_challenge(account, db, background_tasks)

    return issue_session(account, request, response, db)


_forgot_password_attempts: dict[str, list[float]] = defaultdict(list)


@router.post("/forgot-password")
def request_password_reset(
    data: PasswordResetRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: DbSession,
):
    ip_address = request.client.host if request.client else "unknown"
    now = time.time()
    recent_attempts = [t for t in _forgot_password_attempts[ip_address] if now - t < 300]
    _forgot_password_attempts[ip_address] = recent_attempts
    if len(recent_attempts) >= 5:
        raise HTTPException(status_code=429, detail="Too many password reset requests. Please wait 5 minutes.")
    _forgot_password_attempts[ip_address].append(now)

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
            db.commit()
            background_tasks.add_task(
                staff_account_notifier.send_password_reset_otp,
                name=account.name,
                email=account.email,
                otp=otp,
            )
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
    csrf_token = request.cookies.get(CSRF_COOKIE_NAME) or generate_csrf_token()
    set_csrf_cookie(response, csrf_token)
    response.headers["x-csrf-token"] = csrf_token
    return account


@router.get("/csrf")
def get_csrf(request: Request, response: Response):
    csrf_token = request.cookies.get(CSRF_COOKIE_NAME) or generate_csrf_token()
    set_csrf_cookie(response, csrf_token)
    response.headers["x-csrf-token"] = csrf_token
    return {"csrf_token": csrf_token}


@router.patch("/profile", response_model=AccountOut)
def update_profile(data: AccountProfileUpdate, account: CurrentAccount, db: DbSession):
    email = str(data.email).lower().strip()
    duplicate = db.scalar(select(Account.id).where(Account.email == email, Account.id != account.id))
    if duplicate:
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    account.name = data.name.strip()
    account.email = email
    account.phone = data.phone.strip() if data.phone else None
    if data.promotional_consent is not None:
        account.promotional_consent = data.promotional_consent
    if account.role == Role.USER and data.addresses is not None:
        addresses = [item.model_dump() for item in data.addresses]
        ids = [item["id"] for item in addresses]
        if len(ids) != len(set(ids)):
            raise HTTPException(status_code=422, detail="Each saved address needs a unique id")
        if "home" not in ids:
            addresses.append({"id": "home", "label": "Home", "house_number": "", "road": "", "area": "", "city": "", "pincode": "", "landmark": "", "latitude": None, "longitude": None, "is_default": False})
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


@router.patch("/promotional-consent", response_model=AccountOut)
def update_promotional_consent(data: PromotionalConsentUpdate, account: CurrentAccount, db: DbSession):
    account.promotional_consent = data.promotional_consent
    db.commit()
    db.refresh(account)
    return account


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(data: PasswordUpdate, account: PasswordChangeAccount, request: Request, db: DbSession):
    if not account.must_change_password:
        if not data.current_password or not verify_password(data.current_password, account.password_hash):
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
    bearer_token = credentials.credentials if credentials and credentials.scheme.casefold() == "bearer" else None
    cookie_token = request.cookies.get(SESSION_COOKIE_NAME)
    if not bearer_token and cookie_token:
        csrf_cookie = request.cookies.get(CSRF_COOKIE_NAME)
        csrf_header = request.headers.get("x-csrf-token")
        if not csrf_cookie or not csrf_header or not secrets.compare_digest(csrf_header, csrf_cookie):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="CSRF token missing or invalid",
            )
    token = bearer_token or cookie_token
    if token:
        token_hash = hash_session_token(token)
        db.query(UserSession).filter(UserSession.token_hash == token_hash).update(
            {UserSession.is_revoked: True},
            synchronize_session=False,
        )
        db.commit()

    delete_session_cookie(response)
    delete_csrf_cookie(response)

