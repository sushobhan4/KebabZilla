from datetime import datetime, timedelta, timezone
import logging
import secrets
import threading
import time
from collections import defaultdict
from typing import Annotated

logger = logging.getLogger(__name__)

from fastapi import APIRouter, BackgroundTasks, Cookie, Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.cache import invalidate_auth_cache, mark_account_revoked, mark_session_revoked
from app.config import settings
from app.dependencies import CurrentAccount, CurrentAccountModel, DbSession, PasswordChangeAccount, PasswordChangeAccountModel, bearer_scheme
from app.integrations import staff_account_notifier
from app.models import (
    Account,
    AccountAddress,
    AllOtp,
    Role,
    UserSession,
    utcnow,
)
from app.schemas import (
    AccountCreate,
    AccountOut,
    AccountProfileUpdate,
    EmailCheckOut,
    GoogleLoginRequest,
    LoginRequest,
    PasswordResetConfirm,
    PasswordResetRequest,
    PasswordUpdate,
    PromotionalConsentUpdate,
    SendEmailOtpInput,
    TokenOut,
    TwoFactorVerifyRequest,
    UserSessionOut,
    VerifyEmailOtpInput,
)
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from app.security import (
    ACCESS_COOKIE_NAME,
    CSRF_COOKIE_NAME,
    REFRESH_COOKIE_NAME,
    SESSION_COOKIE_NAME,
    SESSION_LIFETIME_DAYS,
    compute_composite_device_fingerprint,
    compute_device_fingerprint,
    create_access_token,
    decode_access_token,
    delete_auth_cookies,
    delete_csrf_cookie,
    delete_session_cookie,
    generate_2fa_code,
    generate_2fa_temp_token,
    generate_csrf_token,
    generate_session_token,
    get_client_ip,
    hash_2fa_code,
    hash_2fa_temp_token,
    hash_password,
    hash_session_token,
    parse_device_info,
    resolve_device_name,
    resolve_ip_location,
    set_access_cookie,
    set_csrf_cookie,
    set_refresh_cookie,
    set_session_cookie,
    verify_2fa_code,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["authentication"])


def issue_session(account: Account, request: Request, response: Response, db: Session) -> TokenOut:
    raw_token = generate_session_token()
    token_hash = hash_session_token(raw_token)
    user_agent = request.headers.get("user-agent", "")
    ip_address = get_client_ip(request)
    client_fp = request.headers.get("x-device-fingerprint")
    client_dev_name = request.headers.get("x-device-name")
    device_fingerprint = compute_composite_device_fingerprint(client_fp, user_agent)
    device_info = resolve_device_name(client_dev_name, user_agent)
    geo_info = resolve_ip_location(ip_address)
    now = utcnow()
    expires_at = now + timedelta(days=SESSION_LIFETIME_DAYS)

    session = UserSession(
        account_id=account.id,
        token_hash=token_hash,
        previous_token_hash=None,
        grace_period_until=None,
        user_agent=user_agent[:512],
        ip_address=ip_address[:64],
        device_fingerprint=device_fingerprint,
        device_name=device_info.get("device_name", "")[:128],
        country=geo_info.get("country", "")[:64],
        region=geo_info.get("region", "")[:64],
        city=geo_info.get("city", "")[:64],
        created_at=now,
        last_active_at=now,
        expires_at=expires_at,
        is_revoked=False,
    )
    db.add(session)
    db.commit()

    # 1. Issue short-lived 2-minute HS256 JWT access token in kz_access cookie
    access_token_jwt, _ = create_access_token(
        account_id=account.id,
        session_id=session.id,
        role=account.role,
        expires_seconds=settings.access_token_seconds,
    )
    set_access_cookie(response, access_token_jwt)

    # 2. Issue 30-day rotating refresh token in kz_refresh cookie
    set_refresh_cookie(response, raw_token)

    # 3. Double-Submit CSRF protection
    csrf_token = generate_csrf_token()
    set_csrf_cookie(response, csrf_token)
    response.headers["x-csrf-token"] = csrf_token

    # Return access_token & refresh_token for Authorization header / cross-origin clients while maintaining dual HttpOnly cookies
    return TokenOut(
        access_token=access_token_jwt,
        refresh_token=raw_token,
        token_type="bearer",
        expires_in=settings.access_token_seconds,
        account=AccountOut.model_validate(account),
        csrf_token=csrf_token,
    )


@router.get("/check-email", response_model=EmailCheckOut)
def check_email(email: str, exclude_id: int | None = None, db: DbSession = None):
    email_clean = email.lower().strip()
    query = select(Account.id).where(Account.email == email_clean)
    if exclude_id is not None:
        query = query.where(Account.id != exclude_id)
    exists = bool(db.scalar(query))
    return EmailCheckOut(exists=exists, available=not exists)


@router.post("/send-verification-otp")
def send_verification_otp(data: SendEmailOtpInput, background_tasks: BackgroundTasks, db: DbSession):
    email_clean = data.email.lower().strip()
    if data.purpose in ("register", "staff_create"):
        if db.scalar(select(Account.id).where(Account.email == email_clean)):
            raise HTTPException(status_code=409, detail="An account with this email already exists")

    recent = db.scalar(
        select(AllOtp).where(
            AllOtp.email == email_clean,
            AllOtp.purpose == data.purpose,
            AllOtp.created_at >= utcnow() - timedelta(seconds=30),
        )
    )
    if recent:
        raise HTTPException(status_code=429, detail="Please wait before requesting another verification code")

    db.query(AllOtp).filter(
        ((AllOtp.email == email_clean) & (AllOtp.purpose == data.purpose))
        | (AllOtp.expires_at <= utcnow())
    ).delete(synchronize_session=False)

    otp = f"{secrets.randbelow(1_000_000):06d}"
    code_entry = AllOtp(
        email=email_clean,
        otp_code=hash_password(otp),
        purpose=data.purpose,
        expires_at=utcnow() + timedelta(minutes=10),
        attempts=0,
    )
    db.add(code_entry)
    db.commit()

    background_tasks.add_task(
        staff_account_notifier.send_email_verification_otp,
        email=email_clean,
        otp=otp,
        purpose=data.purpose,
    )
    return {"status": "OTP_SENT", "message": f"Verification code sent to {email_clean}"}


@router.post("/verify-email-otp")
def verify_email_otp(data: VerifyEmailOtpInput, db: DbSession):
    email_clean = data.email.lower().strip()
    record = db.scalar(
        select(AllOtp)
        .where(
            AllOtp.email == email_clean,
            AllOtp.purpose != "forgot_password",
            AllOtp.purpose != "password_reset",
        )
        .order_by(AllOtp.created_at.desc())
    )
    if not record:
        raise HTTPException(status_code=400, detail="Verification code has expired or is invalid")

    expires_at = record.expires_at
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=utcnow().tzinfo)
    if not expires_at or expires_at <= utcnow():
        db.delete(record)
        db.commit()
        raise HTTPException(status_code=400, detail="Verification code has expired")

    if record.attempts >= 5:
        db.delete(record)
        db.commit()
        raise HTTPException(status_code=429, detail="Too many invalid attempts. Please request a new code.")

    if not verify_password(data.otp.strip(), record.otp_code):
        record.attempts += 1
        if record.attempts >= 5:
            db.delete(record)
        db.commit()
        raise HTTPException(status_code=400, detail="Incorrect verification code")

    # Delete row immediately upon successful verification
    db.delete(record)
    db.commit()
    return {"verified": True, "email": email_clean}


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


_rate_limit_lock = threading.Lock()
_failed_logins: dict[str, list[float]] = defaultdict(list)


def check_login_rate_limit(key: str) -> None:
    now = time.time()
    with _rate_limit_lock:
        attempts = [t for t in _failed_logins[key] if now - t < 300]
        if attempts:
            _failed_logins[key] = attempts
        else:
            _failed_logins.pop(key, None)
        if len(attempts) >= 5:
            raise HTTPException(
                status_code=429,
                detail="Too many failed login attempts. Please wait 5 minutes before trying again.",
            )


def record_failed_login(key: str) -> None:
    now = time.time()
    with _rate_limit_lock:
        if len(_failed_logins) > 1000:
            expired = [k for k, times in _failed_logins.items() if not times or now - times[-1] >= 300]
            for k in expired:
                _failed_logins.pop(k, None)
        _failed_logins[key].append(now)


def clear_failed_logins(key: str) -> None:
    with _rate_limit_lock:
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

    db.query(AllOtp).filter(AllOtp.account_id == account.id, AllOtp.purpose == "2fa").delete(synchronize_session=False)
    challenge = AllOtp(
        account_id=account.id,
        email=account.email,
        purpose="2fa",
        token_hash=token_hash,
        otp_code=code_hash,
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
    ip_address = get_client_ip(request) or "unknown"
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
    challenge = db.scalar(select(AllOtp).where(AllOtp.token_hash == token_hash, AllOtp.purpose == "2fa"))
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

    if not verify_2fa_code(data.code.strip(), challenge.otp_code):
        challenge.attempts += 1
        if challenge.attempts >= 5:
            db.delete(challenge)
        db.commit()
        raise HTTPException(status_code=400, detail="Invalid verification code")

    account = db.get(Account, challenge.account_id)
    if not account:
        db.delete(challenge)
        db.commit()
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
        logger.warning(f"Google token verification failed: {exc}")
        raise HTTPException(status_code=400, detail="Invalid Google credential token") from exc

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


@router.post("/refresh", response_model=TokenOut)
def refresh_session(
    request: Request,
    response: Response,
    db: DbSession,
):
    refresh_token = request.cookies.get(settings.refresh_cookie_name)
    if not refresh_token:
        # Fallback to header or legacy cookie name if present
        refresh_token = request.headers.get("x-refresh-token") or request.cookies.get(settings.session_cookie_name)
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token missing")

    incoming_hash = hash_session_token(refresh_token)
    session = db.scalar(
        select(UserSession)
        .where(
            or_(
                UserSession.token_hash == incoming_hash,
                UserSession.previous_token_hash == incoming_hash,
            )
        )
    )

    now = utcnow()
    if not session or session.is_revoked:
        delete_auth_cookies(response)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or revoked session")

    exp = session.expires_at
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)

    if exp <= now:
        session.is_revoked = True
        db.commit()
        mark_session_revoked(session.id)
        invalidate_auth_cache(token_hash=session.token_hash, account_id=session.account_id)
        delete_auth_cookies(response)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")

    # Silicon & Hardware Device Fingerprint Check
    client_fp = request.headers.get("x-device-fingerprint")
    user_agent = request.headers.get("user-agent", "")
    incoming_fp = compute_composite_device_fingerprint(client_fp, user_agent)
    if client_fp and session.device_fingerprint and incoming_fp != session.device_fingerprint:
        # Cross-machine token theft detected!
        session.is_revoked = True
        db.commit()
        mark_session_revoked(session.id)
        invalidate_auth_cache(token_hash=session.token_hash, account_id=session.account_id)
        delete_auth_cookies(response)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Device mismatch detected")

    account = db.get(Account, session.account_id)
    if not account:
        delete_auth_cookies(response)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account not found")

    # Case A: incoming_hash == session.token_hash (Normal Rotation R1 -> R2)
    if incoming_hash == session.token_hash:
        new_refresh_token = generate_session_token()
        new_hash = hash_session_token(new_refresh_token)
        session.previous_token_hash = session.token_hash
        session.token_hash = new_hash
        session.grace_period_until = now + timedelta(seconds=15)
        session.last_active_at = now
        session.expires_at = now + timedelta(days=SESSION_LIFETIME_DAYS)
        db.commit()

        new_access_jwt, _ = create_access_token(
            account_id=account.id,
            session_id=session.id,
            role=account.role,
            expires_seconds=settings.access_token_seconds,
        )
        set_access_cookie(response, new_access_jwt)
        set_refresh_cookie(response, new_refresh_token)

        csrf_token = generate_csrf_token()
        set_csrf_cookie(response, csrf_token)
        response.headers["x-csrf-token"] = csrf_token

        return TokenOut(
            access_token=new_access_jwt,
            refresh_token=new_refresh_token,
            token_type="bearer",
            expires_in=settings.access_token_seconds,
            account=AccountOut.model_validate(account),
            csrf_token=csrf_token,
        )

    # Case B: incoming_hash == session.previous_token_hash (Reuse or Multi-Tab Parallel Request)
    if incoming_hash == session.previous_token_hash:
        gpu = session.grace_period_until
        if gpu and gpu.tzinfo is None:
            gpu = gpu.replace(tzinfo=timezone.utc)
        # If within 15-second grace period: harmless parallel request / secondary tab from same browser
        if gpu and now <= gpu:
            new_access_jwt, _ = create_access_token(
                account_id=account.id,
                session_id=session.id,
                role=account.role,
                expires_seconds=settings.access_token_seconds,
            )
            set_access_cookie(response, new_access_jwt)
            csrf_token = generate_csrf_token()
            set_csrf_cookie(response, csrf_token)
            response.headers["x-csrf-token"] = csrf_token

            return TokenOut(
                access_token=new_access_jwt,
                refresh_token=refresh_token,
                token_type="bearer",
                expires_in=settings.access_token_seconds,
                account=AccountOut.model_validate(account),
                csrf_token=csrf_token,
            )
        else:
            # TOKEN THEFT DETECTED outside grace period!
            session.is_revoked = True
            db.commit()
            mark_session_revoked(session.id)
            invalidate_auth_cache(token_hash=session.token_hash, account_id=session.account_id)
            delete_auth_cookies(response)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session compromised and terminated",
            )



_forgot_password_attempts: dict[str, list[float]] = defaultdict(list)


@router.post("/forgot-password")
def request_password_reset(
    data: PasswordResetRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: DbSession,
):
    ip_address = get_client_ip(request) or "unknown"
    now = time.time()
    with _rate_limit_lock:
        if len(_forgot_password_attempts) > 1000:
            expired = [k for k, times in _forgot_password_attempts.items() if not times or now - times[-1] >= 300]
            for k in expired:
                _forgot_password_attempts.pop(k, None)
        recent_attempts = [t for t in _forgot_password_attempts[ip_address] if now - t < 300]
        if recent_attempts:
            _forgot_password_attempts[ip_address] = recent_attempts
        else:
            _forgot_password_attempts.pop(ip_address, None)
        if len(recent_attempts) >= 5:
            raise HTTPException(status_code=429, detail="Too many password reset requests. Please wait 5 minutes.")
        _forgot_password_attempts[ip_address].append(now)

    email = data.email.lower().strip()
    account = db.scalar(select(Account).where(Account.email == email))
    if account:
        recent = db.scalar(
            select(AllOtp).where(
                AllOtp.email == email,
                AllOtp.purpose.in_(["forgot_password", "password_reset"]),
                AllOtp.created_at >= utcnow() - timedelta(seconds=60),
            )
        )
        if not recent:
            db.query(AllOtp).filter(
                ((AllOtp.email == email) & (AllOtp.purpose.in_(["forgot_password", "password_reset"])))
                | (AllOtp.expires_at <= utcnow())
            ).delete(synchronize_session=False)
            otp = f"{secrets.randbelow(1_000_000):06d}"
            reset_code = AllOtp(
                email=email,
                account_id=account.id,
                otp_code=hash_password(otp),
                purpose="forgot_password",
                expires_at=utcnow() + timedelta(minutes=10),
                attempts=0,
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
        select(AllOtp)
        .where(
            AllOtp.email == email,
            AllOtp.purpose.in_(["forgot_password", "password_reset"]),
        )
        .order_by(AllOtp.created_at.desc())
    )
    expires_at = reset_code.expires_at if reset_code else None
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=utcnow().tzinfo)
    if not reset_code or not expires_at or expires_at <= utcnow() or reset_code.attempts >= 5:
        if reset_code:
            db.delete(reset_code)
            db.commit()
        raise HTTPException(status_code=400, detail="The code is invalid or has expired")
    if not verify_password(data.otp, reset_code.otp_code):
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
    invalidate_auth_cache(account_id=account.id)


@router.get("/me", response_model=AccountOut)
def me(account: PasswordChangeAccountModel, request: Request, response: Response):
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
def update_profile(data: AccountProfileUpdate, account: CurrentAccountModel, db: DbSession):
    email = str(data.email).lower().strip()
    duplicate = db.scalar(select(Account.id).where(Account.email == email, Account.id != account.id))
    if duplicate:
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    account.name = data.name.strip()
    account.email = email
    account.phone = data.phone.strip() if data.phone else None
    if data.promotional_consent is not None:
        account.promotional_consent = data.promotional_consent
    if data.addresses is not None:
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
            if item.get("distance_meters") is not None:
                item["distance_meters"] = int(round(item["distance_meters"]))
            elif item.get("latitude") is not None and item.get("longitude") is not None:
                try:
                    from app.services import restaurant_settings, _distance_km
                    settings_obj = restaurant_settings(db)
                    if settings_obj.latitude is not None and settings_obj.longitude is not None:
                        factor = getattr(settings_obj, "haversine_routing_factor", 1.3627) or 1.3627
                        dist_m = int(round(_distance_km(settings_obj.latitude, settings_obj.longitude, item["latitude"], item["longitude"]) * factor * 1000.0))
                        item["distance_meters"] = dist_m
                except Exception:
                    pass
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
    invalidate_auth_cache(account_id=account.id)
    db.refresh(account)
    return account


@router.patch("/promotional-consent", response_model=AccountOut)
def update_promotional_consent(data: PromotionalConsentUpdate, account: CurrentAccountModel, db: DbSession):
    account.promotional_consent = data.promotional_consent
    db.commit()
    invalidate_auth_cache(account_id=account.id)
    db.refresh(account)
    return account


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    data: PasswordUpdate,
    account: PasswordChangeAccountModel,
    request: Request,
    db: DbSession,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)] = None,
):
    if not account.must_change_password:
        if not data.current_password or not verify_password(data.current_password, account.password_hash):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
    if verify_password(data.new_password, account.password_hash):
        raise HTTPException(status_code=400, detail="Choose a new password you have not used before")
    account.password_hash = hash_password(data.new_password)
    account.must_change_password = False

    # Revoke sessions on all other devices, keeping current device active
    current_sid = getattr(account, "session_id", None)
    other_query = db.query(UserSession).filter(UserSession.account_id == account.id, UserSession.is_revoked == False)
    if current_sid:
        other_query = other_query.filter(UserSession.id != current_sid)
    other_sessions = other_query.all()
    for s in other_sessions:
        s.is_revoked = True
        mark_session_revoked(s.id)

    db.commit()
    invalidate_auth_cache(account_id=account.id)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    request: Request,
    response: Response,
    db: DbSession,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)] = None,
):
    bearer_token = credentials.credentials if credentials and credentials.scheme.casefold() == "bearer" else None
    cookie_access = request.cookies.get(settings.access_cookie_name)
    cookie_refresh = request.cookies.get(settings.refresh_cookie_name) or request.cookies.get(settings.session_cookie_name)

    if not bearer_token and (cookie_access or cookie_refresh):
        csrf_cookie = request.cookies.get(CSRF_COOKIE_NAME)
        csrf_header = request.headers.get("x-csrf-token")
        if not csrf_cookie or not csrf_header or not secrets.compare_digest(csrf_header, csrf_cookie):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="CSRF token missing or invalid",
            )

    # 1. Revoke session by JWT sid if access token is present
    access_tok = cookie_access or bearer_token
    if access_tok:
        try:
            payload = decode_access_token(access_tok)
            sid = payload.get("sid")
            if sid:
                mark_session_revoked(sid)
                db.query(UserSession).filter(UserSession.id == sid).update(
                    {UserSession.is_revoked: True},
                    synchronize_session=False,
                )
        except Exception:
            pass

    # 2. Revoke session by refresh token hash if present
    if cookie_refresh:
        ref_hash = hash_session_token(cookie_refresh)
        matched = db.query(UserSession).filter(
            or_(UserSession.token_hash == ref_hash, UserSession.previous_token_hash == ref_hash)
        ).all()
        for s in matched:
            s.is_revoked = True
            mark_session_revoked(s.id)

    db.commit()
    delete_auth_cookies(response)
    invalidate_auth_cache()


@router.get("/sessions", response_model=list[UserSessionOut])
def list_sessions(
    account: CurrentAccount,
    request: Request,
    db: DbSession,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)] = None,
):
    current_sid = getattr(account, "session_id", None)
    cookie_refresh = request.cookies.get(settings.refresh_cookie_name) or request.cookies.get(settings.session_cookie_name)
    current_hash = hash_session_token(cookie_refresh) if cookie_refresh else None

    sessions = (
        db.query(UserSession)
        .filter(UserSession.account_id == account.id)
        .order_by(UserSession.is_revoked.asc(), UserSession.last_active_at.desc())
        .all()
    )

    out: list[UserSessionOut] = []
    for s in sessions:
        d_name = s.device_name
        d_type = "desktop"
        if s.user_agent:
            parsed = parse_device_info(s.user_agent)
            if not d_name:
                d_name = parsed.get("device_name", "Desktop")
            d_type = parsed.get("device_type", "desktop")

        city = s.city or ""
        region = s.region or ""
        country = s.country or ""
        if not (city or country) and s.ip_address:
            geo = resolve_ip_location(s.ip_address)
            city = geo.get("city", "")
            region = geo.get("region", "")
            country = geo.get("country", "")

        loc_parts = [p for p in [city, country] if p and p != "Unknown"]
        location = ", ".join(loc_parts) if loc_parts else (city or country or "Unknown location")

        is_cur = False
        if current_sid:
            is_cur = bool(s.id == current_sid)
        elif current_hash:
            is_cur = bool(s.token_hash == current_hash or s.previous_token_hash == current_hash)

        out.append(
            UserSessionOut(
                id=s.id,
                device_name=d_name or "Device",
                device_type=d_type,
                country=country,
                region=region,
                city=city,
                location=location,
                ip_address=s.ip_address,
                created_at=s.created_at,
                last_active_at=s.last_active_at,
                is_current=is_cur,
                is_revoked=s.is_revoked,
            )
        )
    return out


@router.post("/sessions/{session_id}/revoke")
def revoke_session(
    session_id: int,
    account: CurrentAccount,
    request: Request,
    response: Response,
    db: DbSession,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)] = None,
):
    session = (
        db.query(UserSession)
        .filter(UserSession.id == session_id, UserSession.account_id == account.id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session.is_revoked = True
    db.commit()
    mark_session_revoked(session.id)
    invalidate_auth_cache(token_hash=session.token_hash, account_id=session.account_id)

    is_current = bool(account.session_id and session.id == account.session_id)
    if is_current:
        delete_auth_cookies(response)

    return {"revoked": True, "is_current": is_current}


@router.post("/sessions/revoke-others")
def revoke_other_sessions(
    account: CurrentAccount,
    request: Request,
    db: DbSession,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)] = None,
):
    current_sid = getattr(account, "session_id", None)
    query = db.query(UserSession).filter(UserSession.account_id == account.id, UserSession.is_revoked == False)
    if current_sid:
        query = query.filter(UserSession.id != current_sid)
    other_sessions = query.all()
    for s in other_sessions:
        s.is_revoked = True
        mark_session_revoked(s.id)
    db.commit()
    invalidate_auth_cache(account_id=account.id)

    return {"revoked_count": len(other_sessions)}


