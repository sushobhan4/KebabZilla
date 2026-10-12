from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select

from app.dependencies import CurrentAccount, DbSession, require_roles
from app.models import AdminEvent, CustomMenuItem, CustomMenuSection, MenuCategory, MenuDiscount, Role
from app.schemas import CustomMenuItemInput, CustomMenuItemOut
from app.services import get_next_menu_id, resolve_categories
from app.storage import cleanup_unreferenced_gcs_images

router = APIRouter(prefix="/custom-menu", tags=["custom menu"])


@router.get("", response_model=list[CustomMenuItemOut])
def list_custom_menu(db: DbSession):
    """Public list of available custom menu items."""
    now = datetime.now(timezone.utc)
    items = db.scalars(
        select(CustomMenuItem)
        .where(CustomMenuItem.is_available.is_(True))
        .order_by(CustomMenuItem.category_id, CustomMenuItem.name)
    ).all()
    discounts = db.scalars(select(MenuDiscount)).all() if items else []
    active: dict[int, MenuDiscount] = {}
    for discount in discounts:
        starts_at = discount.starts_at if discount.starts_at.tzinfo else discount.starts_at.replace(tzinfo=timezone.utc)
        ends_at = discount.ends_at if discount.ends_at.tzinfo else discount.ends_at.replace(tzinfo=timezone.utc)
        if starts_at <= now < ends_at:
            for link in discount.items:
                if link.custom_menu_item_id is not None:
                    active[link.custom_menu_item_id] = discount

    results = []
    for item in items:
        res = CustomMenuItemOut.model_validate(item).model_dump()
        if item.id in active:
            d = active[item.id]
            res["discount_percent"] = d.discount_percent
            res["discounted_base_price_paise"] = max(1, (item.base_price_paise * (100 - d.discount_percent) + 50) // 100)
            res["discount_campaign_name"] = d.campaign_name
        results.append(res)
    return results


@router.get("/manage", response_model=list[CustomMenuItemOut], dependencies=[Depends(require_roles(Role.ADMIN, Role.EMPLOYEE))])
def list_all_custom_menu(db: DbSession):
    return db.scalars(
        select(CustomMenuItem)
        .order_by(CustomMenuItem.category_id, CustomMenuItem.name)
    ).all()


@router.post("", response_model=CustomMenuItemOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_roles(Role.ADMIN))])
def create_custom_menu_item(data: CustomMenuItemInput, actor: CurrentAccount, db: DbSession):
    resolved_cats = resolve_categories(
        db,
        categories=data.categories,
        category_ids=data.category_ids,
        fallback_category=data.category,
        fallback_category_id=data.category_id,
    )

    item = CustomMenuItem(
        id=get_next_menu_id(db),
        name=data.name,
        description=data.description,
        category_id=resolved_cats[0].id if resolved_cats else None,
        base_price_paise=data.base_price_paise,
        image_urls=data.image_urls,
        is_vegetarian=data.is_vegetarian,
        is_available=data.is_available,
        is_featured=data.is_featured,
    )
    item.categories = resolved_cats
    for idx, sec in enumerate(data.sections):
        section = CustomMenuSection(
            name=sec.name,
            position=idx,
            required=sec.required,
            options=[{"name": opt.name, "extra_paise": opt.extra_paise} for opt in sec.options],
        )
        item.sections.append(section)

    db.add(item)
    db.commit()
    db.refresh(item)
    db.add(AdminEvent(
        event_type="custom_menu_item_created",
        message=f"Custom menu item '{item.name}' created by {actor.name}",
        actor_id=actor.id,
        details={"item_id": item.id, "name": item.name},
    ))
    db.commit()
    return item


@router.patch("/{item_id}", response_model=CustomMenuItemOut, dependencies=[Depends(require_roles(Role.ADMIN))])
def update_custom_menu_item(item_id: int, data: CustomMenuItemInput, actor: CurrentAccount, db: DbSession):
    item = db.get(CustomMenuItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Custom menu item not found")

    old_urls = list(item.image_urls or [])

    resolved_cats = resolve_categories(
        db,
        categories=data.categories,
        category_ids=data.category_ids,
        fallback_category=data.category,
        fallback_category_id=data.category_id,
    )

    item.name = data.name
    item.description = data.description
    item.category_id = resolved_cats[0].id if resolved_cats else None
    item.categories = resolved_cats
    item.base_price_paise = data.base_price_paise
    item.image_urls = data.image_urls
    item.is_vegetarian = data.is_vegetarian
    item.is_available = data.is_available
    item.is_featured = data.is_featured

    # Replace sections
    item.sections.clear()
    for idx, sec in enumerate(data.sections):
        section = CustomMenuSection(
            name=sec.name,
            position=idx,
            required=sec.required,
            options=[{"name": opt.name, "extra_paise": opt.extra_paise} for opt in sec.options],
        )
        item.sections.append(section)

    db.add(AdminEvent(
        event_type="custom_menu_item_updated",
        message=f"Custom menu item '{item.name}' updated by {actor.name}",
        actor_id=actor.id,
        details={"item_id": item.id},
    ))
    db.commit()
    db.refresh(item)

    # Clean up unreferenced GCS images that were removed in this update
    removed_urls = [u for u in old_urls if u not in (data.image_urls or [])]
    if removed_urls:
        cleanup_unreferenced_gcs_images(db, removed_urls, exclude_custom_menu_item_id=item.id)

    return item


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_roles(Role.ADMIN))])
def archive_custom_menu_item(item_id: int, actor: CurrentAccount, db: DbSession):
    item = db.get(CustomMenuItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Custom menu item not found")
    item.is_available = False
    db.add(AdminEvent(
        event_type="custom_menu_item_archived",
        message=f"Custom menu item '{item.name}' removed from live menu by {actor.name}",
        actor_id=actor.id,
        details={"item_id": item.id},
    ))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
