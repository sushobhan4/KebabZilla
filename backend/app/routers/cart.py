from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.dependencies import CurrentAccount, DbSession
from app.models import CartItem, MenuItem, Role
from app.schemas import CartItemOut, CartItemUpdate

router = APIRouter(prefix="/cart", tags=["customer cart"])


def customer_only(account: CurrentAccount) -> None:
    if account.role != Role.USER:
        raise HTTPException(status_code=403, detail="Saved carts are available to customer accounts")


@router.get("", response_model=list[CartItemOut])
def saved_cart(account: CurrentAccount, db: DbSession):
    customer_only(account)
    return db.scalars(select(CartItem).where(CartItem.customer_id == account.id).order_by(CartItem.updated_at.desc())).all()


@router.put("/items/{menu_item_id}", response_model=list[CartItemOut])
def update_cart_item(menu_item_id: int, data: CartItemUpdate, account: CurrentAccount, db: DbSession):
    customer_only(account)
    existing = db.scalar(select(CartItem).where(CartItem.customer_id == account.id, CartItem.menu_item_id == menu_item_id))
    if data.quantity == 0:
        if existing:
            db.delete(existing)
            db.commit()
        return db.scalars(select(CartItem).where(CartItem.customer_id == account.id).order_by(CartItem.updated_at.desc())).all()
    item = db.get(MenuItem, menu_item_id)
    if item is None or not item.is_available:
        raise HTTPException(status_code=404, detail="This menu item is no longer available")
    if existing:
        existing.quantity = data.quantity
    else:
        db.add(CartItem(customer_id=account.id, menu_item_id=menu_item_id, quantity=data.quantity))
    db.commit()
    return db.scalars(select(CartItem).where(CartItem.customer_id == account.id).order_by(CartItem.updated_at.desc())).all()
