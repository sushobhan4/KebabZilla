from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select

from app.dependencies import CurrentAccount, DbSession, require_roles
from app.config import settings
from app.models import Account, MenuItem, Order, OrderItem, OrderStatus, Payment, PaymentMethod, PaymentStatus, RestaurantSettings, Role
from app.schemas import AccountsPageOut, AccountOut, AdminAccountCreate, AdminOrdersPageOut, OrderStatusUpdate, RestaurantSettingsInput
from app.security import hash_password
from app.services import issue_razorpay_refund, order_payload, restaurant_settings, transition_order

router = APIRouter(prefix="/admin", tags=["administration"], dependencies=[Depends(require_roles(Role.ADMIN))])


@router.get("/accounts", response_model=AccountsPageOut)
def accounts(
    db: DbSession,
    q: str = "",
    role: Role | None = None,
    active: bool | None = None,
    limit: int = Query(default=100, ge=1, le=250),
    offset: int = Query(default=0, ge=0),
):
    filters = []
    if q.strip():
        pattern = f"%{q.strip()}%"
        filters.append((Account.name.ilike(pattern)) | (Account.email.ilike(pattern)) | (Account.phone.ilike(pattern)))
    if role:
        filters.append(Account.role == role)
    if active is not None:
        filters.append(Account.is_active.is_(active))
    total = db.scalar(select(func.count(Account.id)).where(*filters)) or 0
    rows = db.scalars(select(Account).where(*filters).order_by(Account.created_at.desc()).offset(offset).limit(limit)).all()
    role_counts = {item.value: 0 for item in Role}
    for role_value, count in db.execute(select(Account.role, func.count(Account.id)).group_by(Account.role)):
        role_counts[role_value.value] = int(count)
    active_total = db.scalar(select(func.count(Account.id)).where(Account.is_active.is_(True))) or 0
    return {"items": rows, "total": total, "limit": limit, "offset": offset, "role_counts": role_counts, "active_total": active_total}


@router.post("/accounts", response_model=AccountOut, status_code=status.HTTP_201_CREATED)
def create_account(data: AdminAccountCreate, db: DbSession):
    email = data.email.lower().strip()
    if db.scalar(select(Account.id).where(Account.email == email)):
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    account = Account(
        name=data.name.strip(),
        email=email,
        phone=data.phone,
        password_hash=hash_password(data.password),
        role=data.role,
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    return account


@router.patch("/accounts/{account_id}/role", response_model=AccountOut)
def change_role(account_id: int, role: Role, actor: CurrentAccount, db: DbSession):
    account = db.get(Account, account_id)
    if account is None:
        raise HTTPException(status_code=404, detail="Account not found")
    if actor.id == account.id:
        raise HTTPException(status_code=400, detail="You cannot change your own role")
    account.role = role
    db.commit()
    db.refresh(account)
    return account


@router.patch("/accounts/{account_id}/active", response_model=AccountOut)
def set_account_active(account_id: int, is_active: bool, actor: CurrentAccount, db: DbSession):
    account = db.get(Account, account_id)
    if account is None:
        raise HTTPException(status_code=404, detail="Account not found")
    if actor.id == account.id and not is_active:
        raise HTTPException(status_code=400, detail="You cannot disable your own account")
    account.is_active = is_active
    db.commit()
    db.refresh(account)
    return account


@router.get("/accounts/{account_id}/orders")
def account_order_history(account_id: int, db: DbSession):
    if db.get(Account, account_id) is None:
        raise HTTPException(status_code=404, detail="Account not found")
    orders = db.scalars(select(Order).where(Order.customer_id == account_id).order_by(Order.created_at.desc()).limit(200)).all()
    return [order_payload(order) for order in orders]


@router.get("/orders", response_model=AdminOrdersPageOut)
def admin_orders(
    db: DbSession,
    status_filter: OrderStatus | None = None,
    limit: int = Query(default=50, ge=1, le=250),
    offset: int = Query(default=0, ge=0),
):
    filters = []
    if status_filter:
        filters.append(Order.status == status_filter)
    total = db.scalar(select(func.count(Order.id)).where(*filters)) or 0
    rows = db.scalars(select(Order).where(*filters).order_by(Order.created_at.desc()).offset(offset).limit(limit)).all()
    status_counts = {item.value: 0 for item in OrderStatus}
    for status_value, count in db.execute(select(Order.status, func.count(Order.id)).group_by(Order.status)):
        status_counts[status_value.value] = int(count)
    paid_revenue = db.scalar(select(func.coalesce(func.sum(Order.total_paise), 0)).where(Order.payment_status == PaymentStatus.PAID)) or 0
    return {
        "items": [order_payload(order) for order in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
        "status_counts": status_counts,
        "paid_revenue_paise": int(paid_revenue),
    }


@router.patch("/orders/{order_id}/status")
def admin_order_status(order_id: int, data: OrderStatusUpdate, db: DbSession):
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    if data.status == OrderStatus.OUT_FOR_DELIVERY:
        raise HTTPException(status_code=400, detail="A delivery partner must take this order from the delivery queue")
    if data.status == OrderStatus.DELIVERED:
        raise HTTPException(status_code=400, detail="A delivery partner must verify the customer’s code to complete delivery")
    if data.status in {OrderStatus.REJECTED, OrderStatus.CANCELLED} and order.payment_status in {PaymentStatus.PAID, PaymentStatus.REFUND_PENDING}:
        raise HTTPException(status_code=409, detail="Issue a refund before rejecting or cancelling a paid order")
    transition_order(order, data.status)
    db.commit()
    return order_payload(order)


@router.post("/orders/{order_id}/refund")
async def refund_order(order_id: int, db: DbSession):
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    payment = db.scalar(select(Payment).where(Payment.order_id == order.id))
    if payment is None:
        raise HTTPException(status_code=404, detail="Payment record not found")
    if payment.status == PaymentStatus.REFUND_PENDING:
        return {"order_id": order.public_id, "payment_status": PaymentStatus.REFUND_PENDING, "message": "Refund is still processing with the payment provider."}
    if payment.status != PaymentStatus.PAID or payment.method != PaymentMethod.RAZORPAY:
        raise HTTPException(status_code=409, detail="Only captured Razorpay payments can be refunded here")
    refund_id = await issue_razorpay_refund(order, payment)
    db.commit()
    return {"order_id": order.public_id, "payment_status": payment.status, "refund_id": refund_id}


@router.get("/settings")
def get_settings(db: DbSession):
    return restaurant_settings(db)


@router.put("/settings")
def update_settings(data: RestaurantSettingsInput, db: DbSession):
    settings = restaurant_settings(db)
    for field, value in data.model_dump().items():
        setattr(settings, field, value)
    db.commit()
    db.refresh(settings)
    return settings


def date_range(period: str, day: datetime | None) -> tuple[datetime, datetime, str]:
    business_tz = ZoneInfo(settings.business_timezone)
    now = day or datetime.now(business_tz)
    if now.tzinfo is None:
        now = now.replace(tzinfo=business_tz)
    if period == "day":
        start = datetime.combine(now.astimezone(business_tz).date(), time.min, tzinfo=business_tz)
        return start.astimezone(timezone.utc), (start + timedelta(days=1)).astimezone(timezone.utc), "hour"
    if period == "week":
        local_now = now.astimezone(business_tz)
        start_date = local_now.date() - timedelta(days=local_now.weekday())
        start = datetime.combine(start_date, time.min, tzinfo=business_tz)
        return start.astimezone(timezone.utc), (start + timedelta(days=7)).astimezone(timezone.utc), "day"
    if period == "month":
        local_now = now.astimezone(business_tz)
        start = datetime(local_now.year, local_now.month, 1, tzinfo=business_tz)
        next_month = datetime(local_now.year + (local_now.month == 12), local_now.month % 12 + 1, 1, tzinfo=business_tz)
        return start.astimezone(timezone.utc), next_month.astimezone(timezone.utc), "day"
    if period == "year":
        local_now = now.astimezone(business_tz)
        start = datetime(local_now.year, 1, 1, tzinfo=business_tz)
        end = datetime(local_now.year + 1, 1, 1, tzinfo=business_tz)
        return start.astimezone(timezone.utc), end.astimezone(timezone.utc), "month"
    raise HTTPException(status_code=400, detail="Period must be day, week, month, or year")


def bucket_label(value: datetime, granularity: str) -> str:
    if granularity == "hour":
        return value.strftime("%I %p").lstrip("0")
    if granularity == "month":
        return value.strftime("%b")
    return value.strftime("%d %b")


@router.get("/reports/sales")
def sales_report(db: DbSession, period: str = "week", at: datetime | None = None):
    start, end, granularity = date_range(period, at)
    orders = db.scalars(select(Order).where(Order.created_at >= start, Order.created_at < end).order_by(Order.created_at)).all()
    paid = [order for order in orders if order.payment_status == PaymentStatus.PAID]
    revenue = sum(order.total_paise for order in paid)
    buckets: dict[str, dict] = {}
    business_tz = ZoneInfo(settings.business_timezone)
    for order in orders:
        created_at = order.created_at
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        local_time = created_at.astimezone(business_tz)
        key = local_time.strftime("%Y-%m-%d %H:00" if granularity == "hour" else "%Y-%m" if granularity == "month" else "%Y-%m-%d")
        value = local_time.replace(minute=0, second=0, microsecond=0) if granularity == "hour" else local_time.replace(day=1, hour=0, minute=0, second=0, microsecond=0) if granularity == "month" else local_time.replace(hour=0, minute=0, second=0, microsecond=0)
        entry = buckets.setdefault(key, {"label": bucket_label(value, granularity), "revenue_paise": 0, "orders": 0})
        entry["orders"] += 1
        if order.payment_status == PaymentStatus.PAID:
            entry["revenue_paise"] += order.total_paise
    statuses = {status.value: sum(1 for order in orders if order.status == status) for status in OrderStatus}
    item_rows = db.execute(
        select(OrderItem.item_name, func.sum(OrderItem.quantity).label("quantity"))
        .join(Order, Order.id == OrderItem.order_id)
        .where(Order.created_at >= start, Order.created_at < end, Order.payment_status == PaymentStatus.PAID)
        .group_by(OrderItem.item_name)
        .order_by(func.sum(OrderItem.quantity).desc())
        .limit(5)
    ).all()
    return {
        "period": period,
        "from": start,
        "to": end,
        "revenue_paise": revenue,
        "paid_orders": len(paid),
        "total_orders": len(orders),
        "average_order_paise": round(revenue / len(paid)) if paid else 0,
        "statuses": statuses,
        "series": list(buckets.values()),
        "top_items": [{"name": row.item_name, "quantity": int(row.quantity or 0)} for row in item_rows],
    }
