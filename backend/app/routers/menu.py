import os
import re

import httpx
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from sqlalchemy import func, select

from app.dependencies import CurrentAccount, DbSession, require_roles
from app.models import (
    AdminEvent,
    CustomMenuItem,
    MenuCategory,
    MenuDiscount,
    MenuDiscountItem,
    MenuItem,
    Order,
    OrderItem,
    OrderStatus,
    Role,
    menu_item_categories,
)
from app.services import get_next_menu_id, resolve_categories
from app.schemas import MenuCategoryDeleteOut, MenuCategoryInput, MenuCategoryOut, MenuItemInput, MenuItemOut
from app.storage import (
    cleanup_unreferenced_gcs_images,
    delete_menu_image,
    get_menu_image_blob,
    is_gcs_image_referenced,
    upload_menu_image,
)
from app.cache import KEY_MENU_CATEGORIES, PREFIX_MENU, cache, image_cache, invalidate_menu_cache

router = APIRouter(prefix="/menu", tags=["menu"])


@router.get("/images/{file_id}", response_class=Response)
def drive_menu_image(file_id: str):
    if not re.fullmatch(r"[A-Za-z0-9_-]{10,200}", file_id):
        raise HTTPException(status_code=404, detail="Menu image not found")

    def _is_allowed_google_host(host: str) -> bool:
        h = host.lower()
        return (
            h == "drive.google.com"
            or h == "google.com"
            or h.endswith(".google.com")
            or h.endswith(".googleusercontent.com")
        )

    url = f"https://drive.google.com/thumbnail?id={file_id}&sz=w1200"
    try:
        with httpx.stream("GET", url, follow_redirects=True, timeout=12) as upstream:
            # Validate the final resolved URL after all redirects
            final_url = upstream.url
            if final_url.scheme != "https" or not _is_allowed_google_host(final_url.host):
                raise HTTPException(status_code=502, detail="Menu image could not be loaded")
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


@router.get("/images/gcs/{filename:path}", response_class=Response)
def serve_gcs_menu_image(filename: str):
    """Serve a menu image stored in Google Cloud Storage."""
    clean_file = os.path.basename(filename)
    cache_key = f"img:{clean_file}"
    cached = image_cache.get(cache_key)
    if cached is not None:
        data, content_type = cached
        return Response(
            content=data,
            media_type=content_type,
            headers={
                "Cache-Control": "public, max-age=86400, immutable",
                "X-Content-Type-Options": "nosniff",
            },
        )

    try:
        data, content_type = get_menu_image_blob(filename)
        image_cache.set(cache_key, (data, content_type), ttl_seconds=3600.0)
        return Response(
            content=data,
            media_type=content_type,
            headers={
                "Cache-Control": "public, max-age=86400, immutable",
                "X-Content-Type-Options": "nosniff",
            },
        )
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Menu image not found")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not load image from storage: {exc}")


@router.post("/images/upload", dependencies=[Depends(require_roles(Role.ADMIN))])
async def upload_menu_image_endpoint(file: UploadFile = File(...)):
    """Upload a menu image directly into the Google Cloud Storage bucket (menuImages/ folder)."""
    allowed_types = {"image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"}
    content_type = (file.content_type or "image/jpeg").lower()
    if content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, WebP, GIF, and AVIF image formats are supported.")

    content = await file.read()
    max_size_bytes = 1 * 1024 * 1024  # 1MB
    if len(content) > max_size_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Image size must not exceed 1MB. (Uploaded size: {len(content) / (1024 * 1024):.2f}MB)",
        )
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    try:
        result = upload_menu_image(content, file.filename or "image.jpg", content_type)
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to upload image to Cloud Storage: {exc}")


@router.delete("/images/gcs/{filename:path}", dependencies=[Depends(require_roles(Role.ADMIN))])
def delete_gcs_menu_image_endpoint(filename: str, db: DbSession):
    """Explicitly delete an unreferenced menu image from GCS."""
    clean_file = os.path.basename(filename)
    if is_gcs_image_referenced(db, clean_file):
        raise HTTPException(
            status_code=400,
            detail="Cannot delete this image from Cloud Storage because it is currently assigned to a menu item.",
        )
    deleted = delete_menu_image(clean_file)
    if not deleted:
        raise HTTPException(status_code=404, detail="Image not found in Cloud Storage.")
    image_cache.delete(f"img:{clean_file}")
    return {"deleted": True, "filename": clean_file}



@router.get("/categories", response_model=list[MenuCategoryOut])
def list_categories(db: DbSession, response: Response):
    cached = cache.get(KEY_MENU_CATEGORIES)
    if cached is not None:
        response.headers["Cache-Control"] = "public, max-age=60, stale-while-revalidate=300"
        return cached

    items = db.scalars(select(MenuCategory).order_by(MenuCategory.name)).all()
    cache.set(KEY_MENU_CATEGORIES, items, ttl_seconds=60.0)
    response.headers["Cache-Control"] = "public, max-age=60, stale-while-revalidate=300"
    return items


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
    invalidate_menu_cache()
    return category


@router.delete("/categories/{category_id}", response_model=MenuCategoryDeleteOut, dependencies=[Depends(require_roles(Role.ADMIN))])
def delete_category(category_id: int, db: DbSession):
    category = db.get(MenuCategory, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="Category not found")
    affected_menu = db.scalar(select(func.count()).select_from(menu_item_categories).where(menu_item_categories.c.category_id == category_id)) or 0

    db.execute(menu_item_categories.delete().where(menu_item_categories.c.category_id == category_id))
    db.delete(category)
    db.commit()
    invalidate_menu_cache()
    return {"affected_menus": affected_menu}


@router.get("", response_model=list[MenuItemOut])
def list_menu(db: DbSession, response: Response):
    cache_key = f"{PREFIX_MENU}public_list"
    cached = cache.get(cache_key)
    if cached is not None:
        response.headers["Cache-Control"] = "public, max-age=15, stale-while-revalidate=30"
        return cached

    now = datetime.now(timezone.utc)
    query = select(MenuItem).where(MenuItem.is_available.is_(True), MenuItem.is_customizable.is_(False)).order_by(MenuItem.name)
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

    cache.set(cache_key, results, ttl_seconds=20.0)
    response.headers["Cache-Control"] = "public, max-age=15, stale-while-revalidate=30"
    return results


@router.get("/manage", response_model=list[MenuItemOut], dependencies=[Depends(require_roles(Role.ADMIN))])
def list_all_menu(db: DbSession):
    cache_key = f"{PREFIX_MENU}manage_list"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    items = db.scalars(select(MenuItem).where(MenuItem.is_customizable.is_(False)).order_by(MenuItem.name)).all()
    cache.set(cache_key, items, ttl_seconds=30.0)
    return items


@router.post("", response_model=MenuItemOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_roles(Role.ADMIN))])
def create_menu_item(data: MenuItemInput, db: DbSession):
    resolved_cats = resolve_categories(
        db,
        categories=data.categories,
        category_ids=data.category_ids,
        fallback_category=data.category,
        fallback_category_id=data.category_id,
    )
    values = data.model_dump()
    values.pop("category", None)
    values.pop("categories", None)
    values.pop("category_ids", None)
    values.pop("category_id", None)
    legacy_image = values.pop("image_url", None)
    values["image_urls"] = values["image_urls"] or ([legacy_image] if legacy_image else [])
    item = MenuItem(id=get_next_menu_id(db), **values)
    item.categories = resolved_cats
    db.add(item)
    db.commit()
    db.refresh(item)
    invalidate_menu_cache()
    return item


@router.patch("/{item_id}", response_model=MenuItemOut, dependencies=[Depends(require_roles(Role.ADMIN))])
def update_menu_item(item_id: int, data: MenuItemInput, db: DbSession):
    item = db.get(MenuItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Menu item not found")

    old_urls = list(item.image_urls or [])

    resolved_cats = resolve_categories(
        db,
        categories=data.categories,
        category_ids=data.category_ids,
        fallback_category=data.category,
        fallback_category_id=data.category_id,
    )
    values = data.model_dump()
    values.pop("category", None)
    values.pop("categories", None)
    values.pop("category_ids", None)
    values.pop("category_id", None)
    legacy_image = values.pop("image_url", None)
    new_urls = values["image_urls"] or ([legacy_image] if legacy_image else [])
    values["image_urls"] = new_urls
    for key, value in values.items():
        setattr(item, key, value)
    if data.is_available:
        item.paused_by_id = None
    item.categories = resolved_cats
    db.commit()
    db.refresh(item)

    # Clean up unreferenced GCS images that were removed in this update
    removed_urls = [u for u in old_urls if u not in new_urls]
    if removed_urls:
        cleanup_unreferenced_gcs_images(db, removed_urls, exclude_menu_item_id=item.id)

    invalidate_menu_cache()
    return item


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_roles(Role.ADMIN))])
def archive_menu_item(item_id: int, db: DbSession):
    item = db.get(MenuItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Menu item not found")
    item.is_available = False
    db.commit()
    invalidate_menu_cache()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
