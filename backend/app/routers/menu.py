import re

import httpx
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select

from app.dependencies import CurrentAccount, DbSession, require_roles
from app.models import AdminEvent, MenuCategory, MenuDiscount, MenuDiscountItem, MenuItem, Order, OrderItem, OrderStatus, Role
from app.schemas import MenuCategoryDeleteOut, MenuCategoryInput, MenuCategoryOut, MenuItemInput, MenuItemOut

router = APIRouter(prefix="/menu", tags=["menu"])


@router.get("/images/{file_id}", response_class=Response)
def drive_menu_image(file_id: str):
    if not re.fullmatch(r"[A-Za-z0-9_-]{10,200}", file_id):
        raise HTTPException(status_code=404, detail="Menu image not found")

    url = f"https://drive.google.com/thumbnail?id={file_id}&sz=w1200"
    try:
        with httpx.stream("GET", url, follow_redirects=True, timeout=12) as upstream:
            if upstream.status_code != 200:
                raise HTTPException(status_code=502, detail="Menu image could not be loaded")
            media_type = upstream.headers.get("content-type", "").split(";", 1)[0].lower()
            if not media_type.startswith("image/"):
                raise HTTPException(status_code=502, detail="Menu image link did not return an image")

            content = bytearray()
            for chunk in upstream.iter_bytes(64 * 1024):
                content.extend(chunk)
                if len(content) > 8 * 1024 * 1024:
                    raise HTTPException(status_code=413, detail="Menu image is too large")
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Menu image could not be loaded") from exc

    return Response(
        content=bytes(content),
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff"},
    )


@router.get("/categories", response_model=list[MenuCategoryOut], dependencies=[Depends(require_roles(Role.ADMIN))])
def list_categories(db: DbSession):
    saved = db.scalars(select(MenuCategory).order_by(MenuCategory.name)).all()
    saved_names = {category.name for category in saved}
    return saved


@router.post("/categories", response_model=MenuCategoryOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_roles(Role.ADMIN))])
def create_category(data: MenuCategoryInput, db: DbSession):
    name = data.name.strip()
    if len(name) < 2:
        raise HTTPException(status_code=422, detail="Category name must be at least 2 characters")
    existing = db.scalar(select(MenuCategory).where(func.lower(MenuCategory.name) == name.lower()))
    if existing:
        raise HTTPException(status_code=409, detail="That category already exists")
    category = MenuCategory(name=name)
    db.add(category)
    db.commit()
    db.refresh(category)
    return category


@router.delete("/categories/{category_id}", response_model=MenuCategoryDeleteOut, dependencies=[Depends(require_roles(Role.ADMIN))])
def delete_category(category_id: int, db: DbSession):
    category = db.get(MenuCategory, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="Category not found")
    affected = db.scalar(select(func.count(MenuItem.id)).where(MenuItem.category_id == category_id)) or 0
    db.query(MenuItem).filter(MenuItem.category_id == category_id).update({MenuItem.category_id: None}, synchronize_session=False)
    db.delete(category)
    db.commit()
    return {"affected_menus": affected}


@router.get("", response_model=list[MenuItemOut])
def list_menu(db: DbSession):
    now = datetime.now(timezone.utc)
    query = select(MenuItem).where(MenuItem.is_available.is_(True), MenuItem.paused_by_id.is_(None)).order_by(MenuItem.category_id, MenuItem.name)
    items = db.scalars(query).all()
    counts = dict(db.execute(
        select(OrderItem.menu_item_id, func.sum(OrderItem.quantity))
        .join(Order, Order.order_id == OrderItem.order_id)
        .where(Order.status.not_in([OrderStatus.CANCELLED, OrderStatus.REJECTED]))
        .group_by(OrderItem.menu_item_id)
    ).all())
    discounts = db.scalars(select(MenuDiscount)).all() if items else []
    active: dict[int, MenuDiscount] = {}
    for discount in discounts:
        starts_at = discount.starts_at if discount.starts_at.tzinfo else discount.starts_at.replace(tzinfo=timezone.utc)
        ends_at = discount.ends_at if discount.ends_at.tzinfo else discount.ends_at.replace(tzinfo=timezone.utc)
        if starts_at <= now < ends_at:
            for link in discount.items:
                active[link.menu_item_id] = discount
    results = []
    for item in items:
        result = MenuItemOut.model_validate(item).model_dump()
        if item.id in active:
            discount = active[item.id]
            result["discount_percent"] = discount.discount_percent
            result["discounted_price_paise"] = max(1, (item.price_paise * (100 - discount.discount_percent) + 50) // 100)
            result["discount_campaign_name"] = discount.campaign_name
        result["popularity_count"] = int(counts.get(item.id, 0) or 0)
        results.append(result)
    return results


@router.get("/manage", response_model=list[MenuItemOut], dependencies=[Depends(require_roles(Role.ADMIN))])
def list_all_menu(db: DbSession):
    return db.scalars(select(MenuItem).order_by(MenuItem.category_id, MenuItem.name)).all()


@router.post("", response_model=MenuItemOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_roles(Role.ADMIN))])
def create_menu_item(data: MenuItemInput, db: DbSession):
    values = data.model_dump()
    legacy_category = values.pop("category")
    legacy_image = values.pop("image_url")
    if values["category_id"] is None and legacy_category:
        category = db.scalar(select(MenuCategory).where(func.lower(MenuCategory.name) == legacy_category.lower()))
        if category:
            values["category_id"] = category.id
    values["image_urls"] = values["image_urls"] or ([legacy_image] if legacy_image else [])
    item = MenuItem(**values)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/{item_id}", response_model=MenuItemOut, dependencies=[Depends(require_roles(Role.ADMIN))])
def update_menu_item(item_id: int, data: MenuItemInput, db: DbSession):
    item = db.get(MenuItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Menu item not found")
    values = data.model_dump()
    legacy_category = values.pop("category")
    legacy_image = values.pop("image_url")
    if values["category_id"] is None and legacy_category:
        category = db.scalar(select(MenuCategory).where(func.lower(MenuCategory.name) == legacy_category.lower()))
        if category:
            values["category_id"] = category.id
    values["image_urls"] = values["image_urls"] or ([legacy_image] if legacy_image else [])
    for key, value in values.items():
        setattr(item, key, value)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_roles(Role.ADMIN))])
def archive_menu_item(item_id: int, db: DbSession):
    item = db.get(MenuItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Menu item not found")
    item.is_available = False
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
