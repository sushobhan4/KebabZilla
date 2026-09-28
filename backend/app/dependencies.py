from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models import Account, Role
from app.security import decode_access_token

bearer_scheme = HTTPBearer(auto_error=False)
DbSession = Annotated[Session, Depends(get_db)]


def current_account(db: DbSession, credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)]) -> Account:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired access token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if credentials is None or credentials.scheme.casefold() != "bearer":
        raise unauthorized
    try:
        account_id = decode_access_token(credentials.credentials)
    except (jwt.InvalidTokenError, ValueError, KeyError):
        raise unauthorized
    account = db.get(Account, account_id)
    if account is None or not account.is_active:
        raise unauthorized
    return account


CurrentAccount = Annotated[Account, Depends(current_account)]


def require_roles(*roles: Role):
    def dependency(account: CurrentAccount) -> Account:
        # Role comes from the database-loaded account; claims supplied by the browser are never used.
        if account.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to this action")
        return account

    return dependency
