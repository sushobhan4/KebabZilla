from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select

from app.dependencies import CurrentAccount, DbSession, require_roles
from app.models import (
    AdminEvent,
    DraftOrder,
    MenuItem,
    MenuPause,
    Order,
    OrderStatus,
    Payment,
    PaymentMethod,
    PaymentStatus,
    Role,
    utcnow,
)
from app.schemas import DraftInput, OrderCreate, OrderStatusUpdate
from app.schemas import MenuPauseInput
from app.config import settings
from app.services import assemble_order, order_payload, restaurant_settings, transition_order

router = APIRouter(prefix="/staff", tags=["staff operations"], dependencies=[Depends(require_roles(Role.ADMIN, Role.EMPLOYEE))])


@router.get("/menu")
def staff_menu(db: DbSession):
    return db.scalars(select(MenuItem).order_by(MenuItem.category, MenuItem.name)).all()


@router.get("/menu-pauses")
def staff_menu_pauses(db: DbSession):
    rows = db.scalars(select(MenuPause).where(MenuPause.paused_until > datetime.now(timezone.utc)).order_by(MenuPause.created_at.desc())).all()
    return [{"menu_item_id": row.menu_item_id, "employee_name": row.employee.name, "paused_until": row.paused_until} for row in rows]


@router.post("/menu/{item_id}/pause", status_code=status.HTTP_201_CREATED)
def staff_pause_menu_item(item_id: int, data: MenuPauseInput, actor: CurrentAccount, db: DbSession):
    item = db.get(MenuItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Menu item not found")
    local_now = datetime.now(ZoneInfo(settings.business_timezone))
    if data.mode == "manual":
        until = datetime.max.replace(tzinfo=timezone.utc)
    else:
        schedule = restaurant_settings(db).weekly_schedule or {}
        until = None
        for offset in range(1, 9):
            day = local_now.date() + timedelta(days=offset)
            hours = schedule.get(day.strftime("%A").lower())
            if not hours or not hours.get("open"):
                continue
            try:
                opening = datetime.combine(day, time.fromisoformat(hours["opens"]), tzinfo=ZoneInfo(settings.business_timezone))
            except (KeyError, ValueError, TypeError):
                continue
            if opening > local_now:
                until = opening.astimezone(timezone.utc)
                break
        if until is None:
            until = datetime.combine(local_now.date() + timedelta(days=1), time.min, tzinfo=ZoneInfo(settings.business_timezone)).astimezone(timezone.utc)
    pause = MenuPause(menu_item_id=item.id, employee_id=actor.id, paused_until=until)
    db.add(pause)
    db.add(AdminEvent(event_type="menu_paused", message=f"{item.name} paused by {actor.name} ({data.mode})", actor_id=actor.id, details={"menu_item_id": item.id, "menu_item_name": item.name, "mode": data.mode, "paused_until": until.isoformat()}))
    db.commit()
    return {"id": pause.id, "menu_item_id": item.id, "menu_item_name": item.name, "employee_name": actor.name, "paused_until": pause.paused_until}


@router.delete("/menu/{item_id}/pause", status_code=status.HTTP_204_NO_CONTENT)
def staff_resume_menu_item(item_id: int, actor: CurrentAccount, db: DbSession):
    item = db.get(MenuItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Menu item not found")
    db.query(MenuPause).filter(MenuPause.menu_item_id == item_id, MenuPause.paused_until > datetime.now(timezone.utc)).delete(synchronize_session=False)
    db.add(AdminEvent(event_type="menu_resumed", message=f"{item.name} restored to menu by {actor.name}", actor_id=actor.id, details={"menu_item_id": item.id, "menu_item_name": item.name}))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/orders")
def staff_orders(db: DbSession, status_filter: OrderStatus | None = None):
    query = select(Order).order_by(Order.created_at.desc()).limit(200)
    if status_filter:
        query = query.where(Order.status == status_filter)
    return [order_payload(order) for order in db.scalars(query).all()]


@router.patch("/orders/{order_id}/status")
def update_status(order_id: int, data: OrderStatusUpdate, actor: CurrentAccount, db: DbSession):
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    if data.status == OrderStatus.OUT_FOR_DELIVERY:
        raise HTTPException(status_code=400, detail="A delivery partner must take this order from the delivery queue")
    if data.status == OrderStatus.DELIVERED:
        raise HTTPException(status_code=400, detail="A delivery partner must verify the customer’s code to complete delivery")
    if data.status in {OrderStatus.REJECTED, OrderStatus.CANCELLED} and order.payment_status in {PaymentStatus.PAID, PaymentStatus.REFUND_PENDING}:
        raise HTTPException(status_code=409, detail="Issue a refund from order management before rejecting or cancelling a paid order")
    transition_order(order, data.status)
    db.add(AdminEvent(event_type="order_status", message=f"Order {order.public_id} changed to {data.status.value} by {actor.name}", actor_id=actor.id, details={"order_id": order.id, "status": data.status.value}))
    db.commit()
    return order_payload(order)



@router.post("/walk-in", status_code=status.HTTP_201_CREATED)
def walk_in_order(data: OrderCreate, actor: CurrentAccount, db: DbSession, customer_name: str = Query(min_length=2, max_length=120), phone: str | None = None):
    if data.payment_method != PaymentMethod.CASH:
        raise HTTPException(status_code=400, detail="Walk-in billing currently supports cash payments")
    order = assemble_order(
        db,
        customer=None,
        created_by=actor,
        lines=data.items,
        payment_method=PaymentMethod.CASH,
        address=data.address or "Restaurant counter",
        notes=data.notes,
        order_type="DINE_IN",
        check_minimum=False,
        enforce_opening_hours=False,
        customer_name=customer_name.strip(),
        customer_phone=phone,
    )
    db.add(AdminEvent(event_type="walk_in_order", message=f"Walk-in order {order.public_id} created by {actor.name}", actor_id=actor.id, details={"order_id": order.id}))
    order.status = OrderStatus.DELIVERED
    order.delivered_at = utcnow()
    db.add(Payment(order_id=order.id, method=PaymentMethod.CASH, status=PaymentStatus.PAID, amount_paise=order.total_paise))
    order.payment_status = PaymentStatus.PAID
    db.commit()
    return order_payload(order)


@router.get("/drafts")
def list_drafts(actor: CurrentAccount, db: DbSession):
    query = select(DraftOrder).order_by(DraftOrder.updated_at.desc()).limit(100)
    if actor.role != Role.ADMIN:
        query = query.where(DraftOrder.created_by_id == actor.id)
    drafts = db.scalars(query).all()
    return drafts


@router.post("/drafts", status_code=status.HTTP_201_CREATED)
def save_draft(data: DraftInput, actor: CurrentAccount, db: DbSession):
    draft = DraftOrder(created_by_id=actor.id, customer_name=data.customer_name, payload=data.payload)
    db.add(draft)
    db.commit()
    db.refresh(draft)
    return draft


@router.delete("/drafts/{draft_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_draft(draft_id: int, actor: CurrentAccount, db: DbSession):
    draft = db.get(DraftOrder, draft_id)
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")
    if actor.role != Role.ADMIN and draft.created_by_id != actor.id:
        raise HTTPException(status_code=404, detail="Draft not found")
    db.delete(draft)
    db.commit()




