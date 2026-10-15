from sqlalchemy import select

from app.config import settings
from app.db import SessionLocal
from app.models import Account, MenuCategory, MenuItem, RestaurantSettings, Role, StaffInfo
from app.security import hash_password
from app.services import get_next_menu_id

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
            if len(settings.seed_admin_password) < 8:
                raise SystemExit("SEED_ADMIN_PASSWORD must be at least 8 characters")
            email = settings.seed_admin_email.lower().strip()
            account = db.scalar(select(Account).where(Account.email == email))
            if not account:
                admin_account = Account(
                    name="Restaurant Admin",
                    email=email,
                    password_hash=hash_password(settings.seed_admin_password),
                    role=Role.ADMIN,
                )
                admin_account.staff_info = StaffInfo(
                    is_accepting_deliveries=False,
                    must_change_password=False,
                )
                db.add(admin_account)
                print(f"Created administrator {email}")
            else:
                print(f"Administrator {email} already exists; no changes made")
        else:
            print("SEED_ADMIN_PASSWORD is empty; skipped administrator creation")
        if db.get(RestaurantSettings, 1) is None:
            db.add(RestaurantSettings(id=1))
        if db.scalar(select(MenuItem.id).limit(1)) is None:
            cat_map = {}
            for name, description, cat_name, price, veg, featured in DEFAULT_MENU:
                if cat_name not in cat_map:
                    cat = db.scalar(select(MenuCategory).where(MenuCategory.name == cat_name))
                    if not cat:
                        cat = MenuCategory(name=cat_name)
                        db.add(cat)
                        db.flush()
                    cat_map[cat_name] = cat
                db.add(
                    MenuItem(
                        id=get_next_menu_id(db),
                        name=name,
                        description=description,
                        category_id=cat_map[cat_name].id,
                        price_paise=price,
                        is_vegetarian=veg,
                        is_featured=featured,
                    )
                )
                db.flush()
            print("Added sample opening menu. Edit it in the admin dashboard.")
        db.commit()


if __name__ == "__main__":
    main()
