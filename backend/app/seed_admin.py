from sqlalchemy import select

from app.config import settings
from app.db import SessionLocal
from app.models import Account, MenuItem, RestaurantSettings, Role
from app.security import hash_password

DEFAULT_MENU = [
    ("Zilla Seekh Kebab", "Charcoal-grilled lamb seekh, mint chutney, pickled onion.", "Signature kebabs", 32900, False, True),
    ("Smoky Chicken Tikka", "Yogurt-marinated chicken, roasted over live coals.", "Signature kebabs", 28900, False, True),
    ("Paneer Malai Tikka", "Silky cream-marinated paneer with peppers.", "Vegetarian", 24900, True, True),
    ("Zilla Chicken Biryani", "Slow-cooked dum biryani, raita, crispy onions.", "Mains", 27900, False, False),
    ("Loaded Masala Fries", "Crispy fries, house masala, green chutney.", "Sides", 14900, True, False),
    ("Mango Lassi", "Chilled Alphonso mango and creamy yogurt.", "Drinks", 9900, True, False),
]


def main() -> None:
    with SessionLocal() as db:
        if settings.seed_admin_password:
            if len(settings.seed_admin_password) < 12:
                raise SystemExit("SEED_ADMIN_PASSWORD must be at least 12 characters")
            email = settings.seed_admin_email.lower().strip()
            account = db.scalar(select(Account).where(Account.email == email))
            if not account:
                db.add(
                    Account(
                        name="Restaurant Admin",
                        email=email,
                        password_hash=hash_password(settings.seed_admin_password),
                        role=Role.ADMIN,
                    )
                )
                print(f"Created administrator {email}")
            else:
                print(f"Administrator {email} already exists; no changes made")
        else:
            print("SEED_ADMIN_PASSWORD is empty; skipped administrator creation")
        if db.get(RestaurantSettings, 1) is None:
            db.add(RestaurantSettings(id=1))
        if db.scalar(select(MenuItem.id).limit(1)) is None:
            db.add_all(
                [
                    MenuItem(name=name, description=description, category=category, price_paise=price, is_vegetarian=veg, is_featured=featured)
                    for name, description, category, price, veg, featured in DEFAULT_MENU
                ]
            )
            print("Added sample opening menu. Edit it in the admin dashboard.")
        db.commit()


if __name__ == "__main__":
    main()
