import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, update

from app.dependencies import CurrentAccount, DbSession, require_roles
from app.integrations import customer_notifier
from app.models import (
    Account,
    DeliveryBatch,
    DeliveryBatchOrder,
    Order,
    OrderStatus,
    Payment,
    PaymentMethod,
    PaymentStatus,
    Role,
)
from app.schemas import BatchCreate, VerifyOtpInput
from app.services import create_delivery_otp, order_payload, transition_order, verify_delivery_otp

router = APIRouter(prefix="/delivery", tags=["delivery"], dependencies=[Depends(require_roles(Role.DELIVERY))])


def route_bucket(address: str) -> str:
    pins = re.findall(r"\b\d{6}\b", address)
    if pins:
        return f"pin:{pins[-1]}"
    segments = [part.strip().casefold() for part in address.split(",") if part.strip()]
    return "place:" + ",".join(segments[-2:]) if segments else ""


@router.get("/queue")
def queue(account: CurrentAccount, db: DbSession):
    orders = db.scalars(
        select(Order)
        .where(Order.assigned_delivery_id == account.id, Order.status == OrderStatus.OUT_FOR_DELIVERY)
        .order_by(Order.created_at)
    ).all()
    return [order_payload(order) for order in orders]


@router.get("/available")
def available_orders(db: DbSession):
    orders = db.scalars(
        select(Order).where(Order.status == OrderStatus.READY, Order.assigned_delivery_id.is_(None)).order_by(Order.created_at)
    ).all()
    return [order_payload(order) for order in orders]


@router.post("/orders/{order_id}/claim")
async def claim_order(order_id: int, account: CurrentAccount, db: DbSession):
    claimed = db.execute(
        update(Order)
        .where(Order.id == order_id, Order.status == OrderStatus.READY, Order.assigned_delivery_id.is_(None))
        .values(assigned_delivery_id=account.id)
    )
    if claimed.rowcount != 1:
        db.rollback()
        raise HTTPException(status_code=409, detail="This delivery was already taken or is no longer available")
    order = db.get(Order, order_id)
    if order is None:
        db.rollback()
        raise HTTPException(status_code=404, detail="Delivery not found")
    transition_order(order, OrderStatus.OUT_FOR_DELIVERY)
    otp = create_delivery_otp(order)
    await customer_notifier.send_delivery_otp(
        phone=order.customer_phone or (order.customer.phone if order.customer else None),
        order_number=order.public_id,
        otp=otp,
    )
    db.commit()
    return order_payload(order)


@router.post("/batches", status_code=status.HTTP_201_CREATED)
def create_batch(data: BatchCreate, account: CurrentAccount, db: DbSession):
    if len(set(data.order_ids)) != len(data.order_ids):
        raise HTTPException(status_code=400, detail="A delivery may only appear once in a route")
    orders = db.scalars(
        select(Order).where(
            Order.id.in_(data.order_ids),
            Order.assigned_delivery_id == account.id,
            Order.status == OrderStatus.OUT_FOR_DELIVERY,
        )
    ).all()
    if len(orders) != len(data.order_ids):
        raise HTTPException(status_code=400, detail="All selected orders must be in your active delivery queue")
    buckets = {route_bucket(order.address) for order in orders}
    if len(buckets) > 1:
        raise HTTPException(status_code=400, detail="Select deliveries in the same postal code or nearby locality route")
    batch = DeliveryBatch(delivery_id=account.id, route_label=data.route_label)
    batch.orders = [DeliveryBatchOrder(order_id=order.id) for order in orders]
    db.add(batch)
    db.commit()
    db.refresh(batch)
    return {"id": batch.id, "route_label": batch.route_label, "order_ids": data.order_ids, "created_at": batch.created_at}


@router.get("/batches")
def list_batches(account: CurrentAccount, db: DbSession):
    batches = db.scalars(
        select(DeliveryBatch).where(DeliveryBatch.delivery_id == account.id).order_by(DeliveryBatch.created_at.desc()).limit(50)
    ).all()
    return [
        {"id": batch.id, "route_label": batch.route_label, "order_ids": [entry.order_id for entry in batch.orders], "created_at": batch.created_at}
        for batch in batches
    ]


@router.post("/orders/{order_id}/verify-otp")
def deliver(order_id: int, data: VerifyOtpInput, account: CurrentAccount, db: DbSession):
    order = db.get(Order, order_id)
    if order is None or order.assigned_delivery_id != account.id or order.status != OrderStatus.OUT_FOR_DELIVERY:
        raise HTTPException(status_code=404, detail="Active delivery not found")
    if not verify_delivery_otp(order, data.otp):
        raise HTTPException(status_code=400, detail="The delivery code is incorrect or expired")
    transition_order(order, OrderStatus.DELIVERED)
    order.delivered_at = datetime.now(timezone.utc)
    if order.payment_method == PaymentMethod.CASH:
        order.payment_status = PaymentStatus.PAID
        payment = db.scalar(select(Payment).where(Payment.order_id == order.id))
        if payment:
            payment.status = PaymentStatus.PAID
    db.commit()
    return order_payload(order)
