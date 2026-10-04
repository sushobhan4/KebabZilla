import secrets
from datetime import timedelta

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.dependencies import CurrentAccount, DbSession, PasswordChangeAccount
from app.integrations import staff_account_notifier
from app.models import Account, AccountAddress, PasswordResetCode, Role, utcnow
from app.schemas import AccountCreate, AccountOut, AccountProfileUpdate, LoginRequest, PasswordResetConfirm, PasswordResetRequest, PasswordUpdate, TokenOut
from app.security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["authentication"])


def issue_token(account: Account) -> TokenOut:
    access_token, expires_in = create_access_token(account.id)
    return TokenOut(access_token=access_token, expires_in=expires_in, account=AccountOut.model_validate(account))


@router.post("/register", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
def register(data: AccountCreate, db: DbSession):
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
    return issue_token(account)


@router.post("/login", response_model=TokenOut)
def login(data: LoginRequest, db: DbSession):
    account = db.scalar(select(Account).where(Account.email == data.email.lower().strip()))
    if not account or not verify_password(data.password, account.password_hash):
        raise HTTPException(status_code=401, detail="Email or password is incorrect")
    return issue_token(account)


@router.post("/forgot-password")
def request_password_reset(data: PasswordResetRequest, db: DbSession):
    account = db.scalar(select(Account).where(Account.email == data.email))
    if account:
        db.query(PasswordResetCode).filter(
            PasswordResetCode.account_id == account.id,
            PasswordResetCode.used_at.is_(None),
        ).delete(synchronize_session=False)
        otp = f"{secrets.randbelow(1_000_000):06d}"
        reset_code = PasswordResetCode(
            account_id=account.id,
            otp_hash=hash_password(otp),
            expires_at=utcnow() + timedelta(minutes=10),
        )
        db.add(reset_code)
        db.flush()
        if not staff_account_notifier.send_password_reset_otp(name=account.name, email=account.email, otp=otp):
            db.delete(reset_code)
            db.commit()
            raise HTTPException(status_code=503, detail="Password reset email is not configured or could not be sent")
        db.commit()
    return {"message": "If an active account uses that email, a password reset code has been sent."}


@router.post("/reset-password", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(data: PasswordResetConfirm, db: DbSession):
    account = db.scalar(select(Account).where(Account.email == data.email))
    if not account:
        raise HTTPException(status_code=400, detail="The code is invalid or has expired")
    reset_code = db.scalar(
        select(PasswordResetCode)
        .where(
            PasswordResetCode.account_id == account.id,
            PasswordResetCode.used_at.is_(None),
        )
        .order_by(PasswordResetCode.created_at.desc())
    )
    expires_at = reset_code.expires_at if reset_code else None
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=utcnow().tzinfo)
    if not reset_code or not expires_at or expires_at <= utcnow() or reset_code.attempts >= 5:
        raise HTTPException(status_code=400, detail="The code is invalid or has expired")
    if not verify_password(data.otp, reset_code.otp_hash):
        reset_code.attempts += 1
        db.commit()
        raise HTTPException(status_code=400, detail="The code is invalid or has expired")
    account.password_hash = hash_password(data.new_password)
    account.must_change_password = False
    reset_code.used_at = utcnow()
    db.commit()


@router.get("/me", response_model=AccountOut)
def me(account: PasswordChangeAccount):
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
        account.addresses.clear()
        account.addresses.extend(
            AccountAddress(
                address_id=address.pop("id"),
                **address,
            )
            for address in addresses
        )
    db.commit()
    db.refresh(account)
    return account


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(data: PasswordUpdate, account: PasswordChangeAccount, db: DbSession):
    if not verify_password(data.current_password, account.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if verify_password(data.new_password, account.password_hash):
        raise HTTPException(status_code=400, detail="Choose a new password you have not used before")
    account.password_hash = hash_password(data.new_password)
    account.must_change_password = False
    db.commit()
