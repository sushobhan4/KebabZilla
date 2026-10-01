from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
import httpx
from uuid import uuid4
from sqlalchemy import func, or_, select

from app.dependencies import CurrentAccount, DbSession, require_roles
from app.config import settings
from app.models import Account, AdminEvent, MenuDiscount, MenuItem, OfferLog, Order, OrderItem, OrderStatus, Payment, PaymentMethod, PaymentStatus, RestaurantSettings, Role
from app.schemas import AccountsPageOut, AccountOut, AdminAccountCreate, AdminOrdersPageOut, MenuDiscountInput, OfferInput, OrderStatusUpdate, RestaurantSettingsInput
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
    db.add(AdminEvent(event_type="account_created", message=f"{account.name} created with role {account.role.value}", details={"role": account.role.value, "email": account.email}))
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
    db.add(AdminEvent(event_type="account_role_changed", message=f"{account.name}'s role changed to {role.value}", actor_id=actor.id, details={"account_id": account.id, "role": role.value}))
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
    db.add(AdminEvent(event_type="account_active_changed", message=f"{account.name} {'enabled' if is_active else 'disabled'}", actor_id=actor.id, details={"account_id": account.id, "is_active": is_active}))
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
    period: str = "all",
    q: str = "",
    limit: int = Query(default=50, ge=1, le=250),
    offset: int = Query(default=0, ge=0),
):
    filters = []
    if status_filter:
        filters.append(Order.status == status_filter)
    if period not in {"all", "day", "week", "month", "year"}:
        raise HTTPException(status_code=422, detail="Choose a valid order time period")
    if period != "all":
        start, end, _ = date_range(period, None)
        filters.extend([Order.created_at >= start, Order.created_at < end])
    if q.strip():
        pattern = f"%{q.strip()}%"
        filters.append(or_(Order.public_id.ilike(pattern), Order.customer_name.ilike(pattern), Order.customer_phone.ilike(pattern)))
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
def admin_order_status(order_id: int, data: OrderStatusUpdate, actor: CurrentAccount, db: DbSession):
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
    db.add(AdminEvent(event_type="order_status", message=f"Order {order.public_id} changed to {data.status.value} by {actor.name}", actor_id=actor.id, details={"order_id": order.id, "status": data.status.value}))
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
    db.add(AdminEvent(event_type="settings_changed", message="Restaurant settings updated", details={"weekly_schedule": data.weekly_schedule, "accepting_orders": data.accepting_orders}))
    db.commit()
    db.refresh(settings)
    return settings


@router.get("/events")
def admin_events(db: DbSession, limit: int = Query(default=100, ge=1, le=250)):
    rows = db.scalars(select(AdminEvent).order_by(AdminEvent.created_at.desc()).limit(limit)).all()
    return [{"id": row.id, "event_type": row.event_type, "message": row.message, "details": row.details, "actor_name": row.actor.name if row.actor else "System", "created_at": row.created_at} for row in rows]


@router.post("/offers", status_code=status.HTTP_201_CREATED)
async def create_offer(data: OfferInput, actor: CurrentAccount, db: DbSession):
    customer_ids = select(Account.id).where(Account.role == Role.USER, Account.is_active.is_(True))
    customers = db.scalars(customer_ids.order_by(Account.created_at.desc())).all()
    order_counts = dict(db.execute(select(Order.customer_id, func.count(Order.id)).where(Order.customer_id.is_not(None)).group_by(Order.customer_id)).all())
    if data.audience == "NEW":
        customers = [person for person in customers if not order_counts.get(person.id, 0)]
    elif data.audience == "RETURNING":
        customers = [person for person in customers if order_counts.get(person.id, 0)]
    configured = {"SMS": bool(settings.offer_sms_api_url and settings.offer_sms_api_token), "EMAIL": bool(settings.offer_email_api_url and settings.offer_email_api_token)}
    eligible = {channel: [person for person in customers if (person.phone if channel == "SMS" else person.email)] for channel in data.channels}
    recipients = list({person.id: person for people in eligible.values() for person in people}.values())
    sent = 0
    failures = []
    for channel in data.channels:
        if not configured[channel]:
            failures.append(f"{channel} provider is not configured")
            continue
        channel_recipients = eligible[channel]
        recipient_values = [person.phone if channel == "SMS" else person.email for person in channel_recipients]
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                response = await client.post(settings.offer_sms_api_url if channel == "SMS" else settings.offer_email_api_url, headers={"Authorization": f"Bearer {settings.offer_sms_api_token if channel == 'SMS' else settings.offer_email_api_token}"}, json={"to": recipient_values, "sender": settings.offer_sender, "message": data.message})
            if response.is_error:
                failures.append(f"{channel} provider returned {response.status_code}")
            else:
                sent += len(channel_recipients)
        except httpx.HTTPError:
            failures.append(f"{channel} provider could not be reached")
    state = "SENT" if sent and not failures else "PARTIAL" if sent else "NOT_CONFIGURED" if not any(configured[c] for c in data.channels) else "FAILED"
    log = OfferLog(actor_id=actor.id, audience=data.audience, channels=data.channels, message=data.message, recipient_count=sum(len(eligible[channel]) for channel in data.channels), sent_count=sent, status=state)
    db.add(log)
    db.add(AdminEvent(event_type="offer_sent", message=f"Offer message campaign {state.lower()} by {actor.name}", actor_id=actor.id, details={"audience": data.audience, "channels": data.channels, "recipients": len(recipients), "sent": sent, "status": state}))
    db.commit()
    db.refresh(log)
    return {"id": log.id, "audience": log.audience, "channels": log.channels, "recipient_count": log.recipient_count, "sent_count": log.sent_count, "status": log.status, "provider_notes": failures, "created_at": log.created_at}


@router.get("/offers")
def offer_history(db: DbSession):
    logs = db.scalars(select(OfferLog).order_by(OfferLog.created_at.desc()).limit(100)).all()
    return [{"id": log.id, "audience": log.audience, "channels": log.channels, "message": log.message, "recipient_count": log.recipient_count, "sent_count": log.sent_count, "status": log.status, "created_at": log.created_at} for log in logs]


@router.get("/discounts")
def list_discounts(db: DbSession):
    rows = db.scalars(select(MenuDiscount).order_by(MenuDiscount.starts_at.desc())).all()
    campaigns: dict[str, dict] = {}
    for row in rows:
        starts_at = row.starts_at if row.starts_at.tzinfo else row.starts_at.replace(tzinfo=timezone.utc)
        ends_at = row.ends_at if row.ends_at.tzinfo else row.ends_at.replace(tzinfo=timezone.utc)
        campaign = campaigns.setdefault(row.campaign_id, {"id": row.campaign_id, "campaign_name": row.campaign_name, "menu_item_ids": [], "menu_item_names": [], "discount_percent": row.discount_percent, "starts_at": starts_at.isoformat(), "ends_at": ends_at.isoformat(), "created_at": row.created_at})
        campaign["menu_item_ids"].append(row.menu_item_id)
        campaign["menu_item_names"].append(row.menu_item.name)
    return list(campaigns.values())


@router.post("/discounts", status_code=status.HTTP_201_CREATED)
def create_discount(data: MenuDiscountInput, actor: CurrentAccount, db: DbSession):
    item_ids = list(dict.fromkeys(data.menu_item_ids))
    items = db.scalars(select(MenuItem).where(MenuItem.id.in_(item_ids))).all()
    items_by_id = {item.id: item for item in items}
    if set(item_ids) != set(items_by_id):
        raise HTTPException(status_code=404, detail="One or more menu items were not found")
    starts_at = data.starts_at.astimezone(timezone.utc)
    ends_at = data.ends_at.astimezone(timezone.utc)
    existing = db.scalars(select(MenuDiscount).where(MenuDiscount.menu_item_id.in_(item_ids))).all()
    for row in existing:
        old_start = row.starts_at if row.starts_at.tzinfo else row.starts_at.replace(tzinfo=timezone.utc)
        old_end = row.ends_at if row.ends_at.tzinfo else row.ends_at.replace(tzinfo=timezone.utc)
        if starts_at < old_end and ends_at > old_start:
            raise HTTPException(status_code=409, detail=f"{items_by_id[row.menu_item_id].name} already has a discount during that time")
    campaign_id = str(uuid4())
    discounts = [MenuDiscount(campaign_id=campaign_id, campaign_name=data.campaign_name, menu_item_id=item_id, discount_percent=data.discount_percent, starts_at=starts_at, ends_at=ends_at, created_by_id=actor.id) for item_id in item_ids]
    db.add_all(discounts)
    item_names = [items_by_id[item_id].name for item_id in item_ids]
    db.add(AdminEvent(event_type="menu_discount_created", message=f"{data.discount_percent}% discount scheduled for {', '.join(item_names)}", actor_id=actor.id, details={"menu_item_ids": item_ids, "discount_percent": data.discount_percent, "starts_at": starts_at.isoformat(), "ends_at": ends_at.isoformat()}))
    db.commit()
    return {"id": campaign_id, "campaign_name": data.campaign_name, "menu_item_ids": item_ids, "menu_item_names": item_names, "discount_percent": data.discount_percent, "starts_at": starts_at.isoformat(), "ends_at": ends_at.isoformat(), "created_at": discounts[0].created_at}


@router.put("/discounts/{campaign_id}")
def update_discount(campaign_id: str, data: MenuDiscountInput, actor: CurrentAccount, db: DbSession):
    current = db.scalars(select(MenuDiscount).where(MenuDiscount.campaign_id == campaign_id)).all()
    if not current:
        raise HTTPException(status_code=404, detail="Discount campaign not found")
    item_ids = list(dict.fromkeys(data.menu_item_ids))
    items = db.scalars(select(MenuItem).where(MenuItem.id.in_(item_ids))).all()
    items_by_id = {item.id: item for item in items}
    if set(item_ids) != set(items_by_id):
        raise HTTPException(status_code=404, detail="One or more menu items were not found")
    starts_at = data.starts_at.astimezone(timezone.utc)
    ends_at = data.ends_at.astimezone(timezone.utc)
    existing = db.scalars(
        select(MenuDiscount).where(
            MenuDiscount.campaign_id != campaign_id,
            MenuDiscount.menu_item_id.in_(item_ids),
        )
    ).all()
    for row in existing:
        old_start = row.starts_at if row.starts_at.tzinfo else row.starts_at.replace(tzinfo=timezone.utc)
        old_end = row.ends_at if row.ends_at.tzinfo else row.ends_at.replace(tzinfo=timezone.utc)
        if starts_at < old_end and ends_at > old_start:
            raise HTTPException(status_code=409, detail=f"{items_by_id[row.menu_item_id].name} already has a discount during that time")
    for row in current:
        db.delete(row)
    item_names = [items_by_id[item_id].name for item_id in item_ids]
    discounts = [MenuDiscount(campaign_id=campaign_id, campaign_name=data.campaign_name, menu_item_id=item_id, discount_percent=data.discount_percent, starts_at=starts_at, ends_at=ends_at, created_by_id=actor.id) for item_id in item_ids]
    db.add_all(discounts)
    db.add(AdminEvent(event_type="menu_discount_updated", message=f"{data.discount_percent}% discount campaign updated for {', '.join(item_names)}", actor_id=actor.id, details={"campaign_id": campaign_id, "menu_item_ids": item_ids, "discount_percent": data.discount_percent, "starts_at": starts_at.isoformat(), "ends_at": ends_at.isoformat()}))
    db.commit()
    return {"id": campaign_id, "campaign_name": data.campaign_name, "menu_item_ids": item_ids, "menu_item_names": item_names, "discount_percent": data.discount_percent, "starts_at": starts_at.isoformat(), "ends_at": ends_at.isoformat(), "created_at": discounts[0].created_at}


@router.delete("/discounts/{campaign_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_discount(campaign_id: str, actor: CurrentAccount, db: DbSession):
    discounts = db.scalars(select(MenuDiscount).where(MenuDiscount.campaign_id == campaign_id)).all()
    if not discounts:
        raise HTTPException(status_code=404, detail="Discount not found")
    item_names = [discount.menu_item.name for discount in discounts]
    db.add(AdminEvent(event_type="menu_discount_deleted", message=f"Scheduled discount for {', '.join(item_names)} deleted", actor_id=actor.id, details={"menu_item_ids": [discount.menu_item_id for discount in discounts], "discount_percent": discounts[0].discount_percent}))
    for discount in discounts:
        db.delete(discount)
    db.commit()


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


