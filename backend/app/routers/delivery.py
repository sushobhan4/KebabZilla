import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select, update

from app.dependencies import CurrentAccount, DbSession, require_roles
from app.integrations import customer_notifier
from app.models import (
    Account,
    DeliveryBatch,
    DeliveryBatchOrder,
    Order,
    AdminEvent,
    OrderStatus,
    Payment,
    PaymentMethod,
    PaymentStatus,
    Role,
)
from app.schemas import BatchClaimInput, BatchCreate, VerifyOtpInput
from app.services import create_delivery_otp, order_payload, restaurant_settings, transition_order, verify_delivery_otp

router = APIRouter(prefix="/delivery", tags=["delivery"], dependencies=[Depends(require_roles(Role.ADMIN, Role.DELIVERY))])


def route_bucket(address: str) -> str:
    pins = re.findall(r"\b\d{6}\b", address)
    if pins:
        return f"pin:{pins[-1]}"
    segments = [part.strip().casefold() for part in address.split(",") if part.strip()]
    return "place:" + ",".join(segments[-2:]) if segments else ""


def recommended_clusters(orders: list[Order], maximum_clusters: int) -> list[list[Order]]:
    """Deterministic locality clustering for the currently unclaimed queue.

    Saved location coordinates can later replace this grouping with Routes API
    travel times; this fallback keeps dispatch safe when a Maps lookup is not
    available and never assigns an order automatically.
    """
    count = max(1, min(maximum_clusters, len(orders)))
    groups: dict[str, list[Order]] = {}
    for order in orders:
        groups.setdefault(f"order:{order.order_id}", []).append(order)
    clusters: list[list[Order]] = [[] for _ in range(count)]
    for _, group in sorted(groups.items(), key=lambda item: (-len(item[1]), item[0])):
        target = min(range(count), key=lambda index: len(clusters[index]))
        clusters[target].extend(group)
    return [cluster for cluster in clusters if cluster]


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


@router.get("/history")
def delivery_history(account: CurrentAccount, db: DbSession):
    orders = db.scalars(select(Order).where(Order.assigned_delivery_id == account.id, Order.status == OrderStatus.DELIVERED).order_by(Order.delivered_at.desc(), Order.created_at.desc()).limit(100)).all()
    return [order_payload(order) for order in orders]


@router.get("/recommended-batches")
def recommended_batches(db: DbSession):
    orders = db.scalars(select(Order).where(Order.status == OrderStatus.READY, Order.assigned_delivery_id.is_(None)).order_by(Order.created_at)).all()
    active_riders = db.scalar(select(func.count(Account.id)).where(Account.role == Role.DELIVERY)) or 0
    clusters = recommended_clusters(orders, int(active_riders) or 1)
    restaurant = restaurant_settings(db)
    return {"active_riders": active_riders, "restaurant_latitude": restaurant.latitude, "restaurant_longitude": restaurant.longitude, "clusters": [{"id": "-".join(order.order_id for order in cluster), "route_label": f"Nearby delivery route {index + 1}", "orders": [order_payload(order) for order in cluster]} for index, cluster in enumerate(clusters)]}


@router.post("/recommended-batches/claim", status_code=status.HTTP_201_CREATED)
async def claim_recommended_batch(data: BatchClaimInput, account: CurrentAccount, db: DbSession):
    orders = db.scalars(select(Order).where(Order.order_id.in_(data.order_ids), Order.status == OrderStatus.READY, Order.assigned_delivery_id.is_(None))).all()
    if len(orders) != len(data.order_ids):
        raise HTTPException(status_code=409, detail="This batch was already claimed or has changed. Refresh to see the remaining deliveries.")
    for order in orders:
        claimed = db.execute(update(Order).where(Order.order_id == order.order_id, Order.status == OrderStatus.READY, Order.assigned_delivery_id.is_(None)).values(assigned_delivery_id=account.id))
        if claimed.rowcount != 1:
            db.rollback()
            raise HTTPException(status_code=409, detail="This batch was just claimed by another rider. Refresh to see the remaining deliveries.")
        transition_order(order, OrderStatus.OUT_FOR_DELIVERY)
        otp = create_delivery_otp(order)
        await customer_notifier.send_delivery_otp(phone=order.customer_phone or (order.customer.phone if order.customer else None), order_number=order.order_id, otp=otp)
    batch = DeliveryBatch(delivery_id=account.id, route_label=f"Nearby delivery route · {len(orders)} stop{'s' if len(orders) != 1 else ''}")
    batch.orders = [DeliveryBatchOrder(order_id=order.order_id) for order in orders]
    db.add(batch)
    db.add(AdminEvent(event_type="delivery_batch_claimed", message=f"{account.name} took a {len(orders)}-stop delivery batch", actor_id=account.id, details={"order_ids": data.order_ids, "delivery_id": account.id}))
    db.commit()
    return {"order_ids": data.order_ids, "route_label": batch.route_label}


@router.post("/orders/{order_id}/claim")
async def claim_order(order_id: str, account: CurrentAccount, db: DbSession):
    claimed = db.execute(
        update(Order)
        .where(Order.order_id == order_id, Order.status == OrderStatus.READY, Order.assigned_delivery_id.is_(None))
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
    db.add(AdminEvent(event_type="delivery_claimed", message=f"{account.name} picked order {order.order_id}", actor_id=account.id, details={"order_id": order.order_id, "delivery_id": account.id, "delivery_name": account.name}))
    otp = create_delivery_otp(order)
    await customer_notifier.send_delivery_otp(
        phone=order.customer_phone or (order.customer.phone if order.customer else None),
        order_number=order.order_id,
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
            Order.order_id.in_(data.order_ids),
            Order.assigned_delivery_id == account.id,
            Order.status == OrderStatus.OUT_FOR_DELIVERY,
        )
    ).all()
    if len(orders) != len(data.order_ids):
        raise HTTPException(status_code=400, detail="All selected orders must be in your active delivery queue")
    batch = DeliveryBatch(delivery_id=account.id, route_label=data.route_label)
    batch.orders = [DeliveryBatchOrder(order_id=order.order_id) for order in orders]
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
def deliver(order_id: str, data: VerifyOtpInput, account: CurrentAccount, db: DbSession):
    order = db.get(Order, order_id)
    if order is None or order.assigned_delivery_id != account.id or order.status != OrderStatus.OUT_FOR_DELIVERY:
        raise HTTPException(status_code=404, detail="Active delivery not found")
    if not verify_delivery_otp(order, data.otp):
        raise HTTPException(status_code=400, detail="The delivery code is incorrect or expired")
    transition_order(order, OrderStatus.DELIVERED)
    db.add(AdminEvent(event_type="order_delivered", message=f"Order {order.order_id} delivered by {account.name}", actor_id=account.id, details={"order_id": order.order_id, "delivery_id": account.id, "delivery_name": account.name}))
    order.delivered_at = datetime.now(timezone.utc)
    payment = db.get(Payment, order.order_id)
    if payment and payment.method == PaymentMethod.CASH:
        if payment:
            payment.status = PaymentStatus.PAID
    db.commit()
    return order_payload(order)
