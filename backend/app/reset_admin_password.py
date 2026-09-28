"""Reset the configured local administrator password without printing it."""

from sqlalchemy import select

from app.config import settings
from app.db import SessionLocal
from app.models import Account, Role
from app.security import hash_password


def main() -> None:
    password = settings.seed_admin_password
    if not password or len(password) < 12:
        raise SystemExit("Set SEED_ADMIN_PASSWORD to a new password of at least 12 characters in backend/.env")

    email = settings.seed_admin_email.lower().strip()
    with SessionLocal() as db:
        account = db.scalar(select(Account).where(Account.email == email))
        if account is None:
            raise SystemExit(f"No account found for {email}. Create the administrator with app.seed_admin first.")
        if account.role != Role.ADMIN:
            raise SystemExit(f"{email} exists but is not an ADMIN account; no password was changed.")
        account.password_hash = hash_password(password)
        db.commit()

    print(f"Administrator password updated for {email}.")


if __name__ == "__main__":
    main()
