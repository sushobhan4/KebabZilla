from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.dependencies import CurrentAccount, DbSession
from app.models import Account, Role
from app.schemas import AccountCreate, AccountOut, AccountProfileUpdate, LoginRequest, PasswordUpdate, TokenOut
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
        addresses=[
            {"id": "home", "label": "Home", "house_number": "", "road": "", "area": "", "city": "", "pincode": "", "landmark": "", "latitude": None, "longitude": None, "is_default": True},
            {"id": "work", "label": "Work", "house_number": "", "road": "", "area": "", "city": "", "pincode": "", "landmark": "", "latitude": None, "longitude": None, "is_default": False},
        ],
        password_hash=hash_password(data.password),
        role=Role.USER,
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    return issue_token(account)


@router.post("/login", response_model=TokenOut)
def login(data: LoginRequest, db: DbSession):
    account = db.scalar(select(Account).where(Account.email == data.email.lower().strip()))
    if not account or not verify_password(data.password, account.password_hash) or not account.is_active:
        raise HTTPException(status_code=401, detail="Email or password is incorrect")
    return issue_token(account)


@router.get("/me", response_model=AccountOut)
def me(account: CurrentAccount):
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
        account.addresses = addresses
    db.commit()
    db.refresh(account)
    return account


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(data: PasswordUpdate, account: CurrentAccount, db: DbSession):
    if not verify_password(data.current_password, account.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if verify_password(data.new_password, account.password_hash):
        raise HTTPException(status_code=400, detail="Choose a new password you have not used before")
    account.password_hash = hash_password(data.new_password)
    db.commit()
