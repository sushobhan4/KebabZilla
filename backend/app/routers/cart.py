from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.dependencies import CurrentAccount, DbSession
from app.models import CartItem, MenuItem, Role
from app.schemas import CartItemInput, CartItemOut, CartItemUpdate

router = APIRouter(prefix="/cart", tags=["customer cart"])


def customer_only(account: CurrentAccount) -> None:
    if account.role not in (Role.USER, Role.ADMIN):
        raise HTTPException(status_code=403, detail="Saved carts are available to customer and administrator accounts")


def _customizations_key(customizations: list | None) -> str:
    if not customizations:
        return ""
    opts = []
    for c in customizations:
        if hasattr(c, "name"):
            name = c.name or ""
            extra = max(0, int(c.extra_paise or 0))
        elif isinstance(c, dict):
            name = c.get("name", "")
            extra = max(0, int(c.get("extra_paise", 0) or 0))
        else:
            continue
        opts.append((name, extra))
    return "|".join(sorted(f"{name}:{extra}" for name, extra in opts))


def _same_item(ci: CartItem, menu_id: int, variation_name: str | None, customizations: list | None) -> bool:
    if ci.menu_id != menu_id:
        return False
    if (ci.variation_name or None) != (variation_name or None):
        return False
    return _customizations_key(ci.customizations) == _customizations_key(customizations)


@router.get("", response_model=list[CartItemOut])
def saved_cart(account: CurrentAccount, db: DbSession):
    customer_only(account)
    return db.scalars(
        select(CartItem).where(CartItem.customer_id == account.id).order_by(CartItem.id.asc())
    ).all()


@router.put("", response_model=list[CartItemOut])
def sync_cart(items: list[CartItemInput], account: CurrentAccount, db: DbSession):
    customer_only(account)

    db.query(CartItem).filter(CartItem.customer_id == account.id).delete(synchronize_session=False)

    seen_fingerprints: set[str] = set()
    for item_data in items:
        if item_data.quantity <= 0:
            continue

        item_id = item_data.menu_id or item_data.menu_item_id or item_data.custom_menu_item_id
        if not item_id:
            continue

        menu_item = db.get(MenuItem, item_id)
        if not menu_item or not menu_item.is_available or menu_item.paused_by_id is not None:
            continue

        fp = f"{item_id}:{item_data.variation_name or ''}:{_customizations_key(item_data.customizations)}"
        if fp in seen_fingerprints:
            continue
        seen_fingerprints.add(fp)

        unit_price = item_data.unit_price_paise
        if unit_price is None or unit_price < 0:
            unit_price = menu_item.price_paise

        raw_customs = [
            c.model_dump() if hasattr(c, "model_dump") else c
            for c in (item_data.customizations or [])
        ]
        db.add(
            CartItem(
                customer_id=account.id,
                menu_id=item_id,
                variation_name=item_data.variation_name or None,
                quantity=item_data.quantity,
                customizations=raw_customs,
            )
        )

    db.commit()
    return db.scalars(
        select(CartItem).where(CartItem.customer_id == account.id).order_by(CartItem.id.asc())
    ).all()


@router.post("/items", response_model=list[CartItemOut])
def add_or_update_cart_item(item_data: CartItemInput, account: CurrentAccount, db: DbSession):
    customer_only(account)

    item_id = item_data.menu_id or item_data.menu_item_id or item_data.custom_menu_item_id
    if not item_id:
        raise HTTPException(status_code=400, detail="Must specify a menu item")

    menu_item = db.get(MenuItem, item_id)
    if not menu_item or not menu_item.is_available:
        raise HTTPException(status_code=404, detail="This item is no longer available")

    existing_items = db.scalars(
        select(CartItem).where(
            CartItem.customer_id == account.id,
            CartItem.menu_id == item_id,
        )
    ).all()

    existing = next(
        (ci for ci in existing_items if _same_item(ci, item_id, item_data.variation_name, item_data.customizations)),
        None,
    )

    if item_data.quantity <= 0:
        if existing:
            db.delete(existing)
            db.commit()
        return db.scalars(
            select(CartItem).where(CartItem.customer_id == account.id).order_by(CartItem.id.asc())
        ).all()

    raw_customs = [
        c.model_dump() if hasattr(c, "model_dump") else c
        for c in (item_data.customizations or [])
    ]
    if existing:
        existing.quantity = item_data.quantity
        existing.customizations = raw_customs
        existing.variation_name = item_data.variation_name or None
    else:
        db.add(
            CartItem(
                customer_id=account.id,
                menu_id=item_id,
                variation_name=item_data.variation_name or None,
                quantity=item_data.quantity,
                customizations=raw_customs,
            )
        )

    db.commit()
    return db.scalars(
        select(CartItem).where(CartItem.customer_id == account.id).order_by(CartItem.id.asc())
    ).all()


@router.put("/items/{menu_item_id}", response_model=list[CartItemOut])
def update_standard_cart_item(menu_item_id: int, data: CartItemUpdate, account: CurrentAccount, db: DbSession):
    customer_only(account)
    existing = db.scalar(
        select(CartItem).where(
            CartItem.customer_id == account.id,
            CartItem.menu_id == menu_item_id,
            CartItem.variation_name.is_(None),
        )
    )

    if data.quantity == 0:
        if existing:
            db.delete(existing)
            db.commit()
        return db.scalars(
            select(CartItem).where(CartItem.customer_id == account.id).order_by(CartItem.id.asc())
        ).all()

    item = db.get(MenuItem, menu_item_id)
    if item is None or not item.is_available:
        raise HTTPException(status_code=404, detail="This menu item is no longer available")

    if existing:
        existing.quantity = data.quantity
    else:
        db.add(
            CartItem(
                customer_id=account.id,
                menu_id=menu_item_id,
                quantity=data.quantity,
                customizations=[],
            )
        )
    db.commit()
    return db.scalars(
        select(CartItem).where(CartItem.customer_id == account.id).order_by(CartItem.id.asc())
    ).all()


@router.delete("/items/{item_id}", response_model=list[CartItemOut])
def delete_cart_item(item_id: str, account: CurrentAccount, db: DbSession):
    customer_only(account)
    if item_id.isdigit():
        target_id = int(item_id)
        # 1. Try finding by CartItem.id first
        existing = db.scalar(
            select(CartItem).where(
                CartItem.customer_id == account.id,
                CartItem.id == target_id,
            )
        )
        if existing:
            db.delete(existing)
            db.commit()
        else:
            # 2. Fall back to removing all items matching menu_id
            menu_matches = db.scalars(
                select(CartItem).where(
                    CartItem.customer_id == account.id,
                    CartItem.menu_id == target_id,
                )
            ).all()
            for item in menu_matches:
                db.delete(item)
            if menu_matches:
                db.commit()

    return db.scalars(
        select(CartItem).where(CartItem.customer_id == account.id).order_by(CartItem.id.asc())
    ).all()


@router.delete("", response_model=list[CartItemOut])
def clear_cart(account: CurrentAccount, db: DbSession):
    customer_only(account)
    db.query(CartItem).filter(CartItem.customer_id == account.id).delete(synchronize_session=False)
    db.commit()
    return []
