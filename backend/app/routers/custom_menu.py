import json
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select

from app.dependencies import CurrentAccount, DbSession, require_roles
from app.models import AdminEvent, MenuCategory, MenuItem, Role
from app.schemas import CustomMenuItemInput, CustomMenuItemOut

router = APIRouter(prefix="/custom-menu", tags=["custom menu"])


def _to_custom_out(item: MenuItem) -> dict:
    sections_raw = item.custom_sections or []
    if isinstance(sections_raw, str):
        try:
            sections_raw = json.loads(sections_raw)
        except Exception:
            sections_raw = []
    return {
        "id": item.id,
        "name": item.name,
        "description": item.description,
        "category_id": item.category_id,
        "category": item.category.name if item.category else "",
        "base_price_paise": item.price_paise,
        "image_urls": item.image_urls or [],
        "image_url": (item.image_urls or [None])[0],
        "is_vegetarian": item.is_vegetarian,
        "is_available": item.is_available,
        "is_featured": item.is_featured,
        "sections": [
            {
                "id": idx + 1,
                "name": sec.get("name", ""),
                "position": sec.get("position", idx),
                "required": sec.get("required", True),
                "options": sec.get("options", []),
            }
            for idx, sec in enumerate(sections_raw)
        ],
    }


@router.get("", response_model=list[CustomMenuItemOut])
def list_custom_menu(db: DbSession):
    """Public list of available custom menu items."""
    items = db.scalars(
        select(MenuItem)
        .where(MenuItem.is_custom.is_(True), MenuItem.is_available.is_(True))
        .order_by(MenuItem.category_id, MenuItem.name)
    ).all()
    return [_to_custom_out(item) for item in items]


@router.get("/manage", response_model=list[CustomMenuItemOut], dependencies=[Depends(require_roles(Role.ADMIN))])
def list_all_custom_menu(db: DbSession):
    items = db.scalars(
        select(MenuItem)
        .where(MenuItem.is_custom.is_(True))
        .order_by(MenuItem.category_id, MenuItem.name)
    ).all()
    return [_to_custom_out(item) for item in items]


@router.post("", response_model=CustomMenuItemOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_roles(Role.ADMIN))])
def create_custom_menu_item(data: CustomMenuItemInput, actor: CurrentAccount, db: DbSession):
    cat_id = data.category_id
    if cat_id is None and data.category:
        cat = db.scalar(select(MenuCategory).where(func.lower(MenuCategory.name) == data.category.lower().strip()))
        if cat:
            cat_id = cat.id

    sections_list = [
        {
            "name": sec.name,
            "position": idx,
            "required": sec.required,
            "options": [{"name": opt.name, "extra_paise": opt.extra_paise} for opt in sec.options],
        }
        for idx, sec in enumerate(data.sections)
    ]

    item = MenuItem(
        name=data.name,
        description=data.description,
        category_id=cat_id,
        price_paise=data.base_price_paise,
        image_urls=data.image_urls,
        is_vegetarian=data.is_vegetarian,
        is_available=data.is_available,
        is_featured=data.is_featured,
        is_custom=True,
        custom_sections=sections_list,
    )
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
    return _to_custom_out(item)


@router.patch("/{item_id}", response_model=CustomMenuItemOut, dependencies=[Depends(require_roles(Role.ADMIN))])
def update_custom_menu_item(item_id: int, data: CustomMenuItemInput, actor: CurrentAccount, db: DbSession):
    item = db.get(MenuItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Custom menu item not found")
    cat_id = data.category_id
    if cat_id is None and data.category:
        cat = db.scalar(select(MenuCategory).where(func.lower(MenuCategory.name) == data.category.lower().strip()))
        if cat:
            cat_id = cat.id

    sections_list = [
        {
            "name": sec.name,
            "position": idx,
            "required": sec.required,
            "options": [{"name": opt.name, "extra_paise": opt.extra_paise} for opt in sec.options],
        }
        for idx, sec in enumerate(data.sections)
    ]

    item.name = data.name
    item.description = data.description
    item.category_id = cat_id
    item.price_paise = data.base_price_paise
    item.image_urls = data.image_urls
    item.is_vegetarian = data.is_vegetarian
    item.is_available = data.is_available
    item.is_featured = data.is_featured
    item.is_custom = True
    item.custom_sections = sections_list

    db.add(AdminEvent(
        event_type="custom_menu_item_updated",
        message=f"Custom menu item '{item.name}' updated by {actor.name}",
        actor_id=actor.id,
        details={"item_id": item.id},
    ))
    db.commit()
    db.refresh(item)
    return _to_custom_out(item)


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_roles(Role.ADMIN))])
def archive_custom_menu_item(item_id: int, actor: CurrentAccount, db: DbSession):
    item = db.get(MenuItem, item_id)
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
