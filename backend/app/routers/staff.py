from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select

from app.dependencies import CurrentAccount, DbSession, require_roles
from app.models import (
    DraftOrder,
    MenuItem,
    Order,
    OrderStatus,
    Payment,
    PaymentMethod,
    PaymentStatus,
    Role,
    utcnow,
)
from app.schemas import DraftInput, OrderCreate, OrderStatusUpdate
from app.services import assemble_order, order_payload, transition_order

router = APIRouter(prefix="/staff", tags=["staff operations"], dependencies=[Depends(require_roles(Role.ADMIN, Role.EMPLOYEE))])


@router.get("/orders")
def staff_orders(db: DbSession, status_filter: OrderStatus | None = None):
    query = select(Order).order_by(Order.created_at.desc()).limit(200)
    if status_filter:
        query = query.where(Order.status == status_filter)
    return [order_payload(order) for order in db.scalars(query).all()]


@router.patch("/orders/{order_id}/status")
def update_status(order_id: int, data: OrderStatusUpdate, db: DbSession):
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
    db.commit()
    return order_payload(order)



@router.post("/walk-in", status_code=status.HTTP_201_CREATED)
def walk_in_order(data: OrderCreate, actor: CurrentAccount, db: DbSession, customer_name: str = "Walk-in", phone: str | None = None):
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
        customer_name=customer_name[:120] or "Walk-in",
        customer_phone=phone,
    )
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
