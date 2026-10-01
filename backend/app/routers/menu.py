import re

import httpx
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select

from app.dependencies import CurrentAccount, DbSession, require_roles
from app.models import AdminEvent, MenuCategory, MenuDiscount, MenuItem, MenuPause, Order, OrderItem, OrderStatus, Role
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
    legacy = db.scalars(select(MenuItem.category).where(MenuItem.category != "").distinct().order_by(MenuItem.category)).all()
    return [*saved, *(MenuCategoryOut(id=0, name=name) for name in legacy if name not in saved_names)]


@router.post("/categories", response_model=MenuCategoryOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_roles(Role.ADMIN))])
def create_category(data: MenuCategoryInput, db: DbSession):
    name = data.name.strip()
    if len(name) < 2:
        raise HTTPException(status_code=422, detail="Category name must be at least 2 characters")
    existing = db.scalar(select(MenuCategory).where(func.lower(MenuCategory.name) == name.lower()))
    legacy_exists = db.scalar(select(MenuItem.id).where(func.lower(MenuItem.category) == name.lower()).limit(1))
    if existing or legacy_exists:
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
    affected = db.scalar(select(func.count(MenuItem.id)).where(MenuItem.category == category.name)) or 0
    db.query(MenuItem).filter(MenuItem.category == category.name).update({MenuItem.category: ""}, synchronize_session=False)
    db.delete(category)
    db.commit()
    return {"affected_menus": affected}


@router.get("", response_model=list[MenuItemOut])
def list_menu(db: DbSession):
    now = datetime.now(timezone.utc)
    paused = select(MenuPause.menu_item_id).where(MenuPause.paused_until > datetime.now(timezone.utc))
    query = select(MenuItem).where(MenuItem.is_available.is_(True), MenuItem.id.not_in(paused)).order_by(MenuItem.category, MenuItem.name)
    items = db.scalars(query).all()
    counts = dict(db.execute(
        select(OrderItem.menu_item_id, func.sum(OrderItem.quantity))
        .join(Order, Order.id == OrderItem.order_id)
        .where(Order.status.not_in([OrderStatus.CANCELLED, OrderStatus.REJECTED]))
        .group_by(OrderItem.menu_item_id)
    ).all())
    discounts = db.scalars(select(MenuDiscount).where(MenuDiscount.menu_item_id.in_([item.id for item in items]))).all() if items else []
    active: dict[int, MenuDiscount] = {}
    for discount in discounts:
        starts_at = discount.starts_at if discount.starts_at.tzinfo else discount.starts_at.replace(tzinfo=timezone.utc)
        ends_at = discount.ends_at if discount.ends_at.tzinfo else discount.ends_at.replace(tzinfo=timezone.utc)
        if starts_at <= now < ends_at:
            active[discount.menu_item_id] = discount
    results = []
    for item in items:
        result = MenuItemOut.model_validate(item).model_dump()
        if item.id in active:
            discount = active[item.id]
            result["discount_percent"] = discount.discount_percent
            result["discounted_price_paise"] = None
            result["discount_campaign_name"] = discount.campaign_name
        result["popularity_count"] = int(counts.get(item.id, 0) or 0)
        results.append(result)
    return results


@router.get("/manage", response_model=list[MenuItemOut], dependencies=[Depends(require_roles(Role.ADMIN))])
def list_all_menu(db: DbSession):
    return db.scalars(select(MenuItem).order_by(MenuItem.category, MenuItem.name)).all()


@router.post("", response_model=MenuItemOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_roles(Role.ADMIN))])
def create_menu_item(data: MenuItemInput, db: DbSession):
    values = data.model_dump()
    values["image_urls"] = values["image_urls"] or ([values["image_url"]] if values["image_url"] else [])
    values["image_url"] = values["image_urls"][0] if values["image_urls"] else None
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
    values["image_urls"] = values["image_urls"] or ([values["image_url"]] if values["image_url"] else [])
    values["image_url"] = values["image_urls"][0] if values["image_urls"] else None
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
