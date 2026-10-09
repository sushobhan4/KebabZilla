from datetime import datetime, time, timedelta, timezone
import secrets
import string
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
import httpx
from sqlalchemy import func, or_, select

from app.dependencies import CurrentAccount, DbSession, require_roles
from app.config import settings
from app.integrations import staff_account_notifier
from app.models import Account, AdminEvent, MenuDiscount, MenuDiscountItem, MenuItem, OfferLog, Order, OrderItem, OrderStatus, Payment, PaymentMethod, PaymentStatus, RestaurantSettings, Role
from app.schemas import AccountsPageOut, AccountOut, AdminAccountCreate, AdminOrdersPageOut, MenuDiscountInput, OfferInput, OrderStatusUpdate, ProvisionedAccountOut, RestaurantSettingsInput
from app.security import hash_password
from app.services import issue_razorpay_refund, order_payload, order_total_paise, restaurant_settings, transition_order

router = APIRouter(prefix="/admin", tags=["administration"], dependencies=[Depends(require_roles(Role.ADMIN))])


@router.get("/accounts", response_model=AccountsPageOut)
def accounts(
    db: DbSession,
    q: str = "",
    role: Role | None = None,
    exclude_users: bool = False,
    limit: int = Query(default=100, ge=1, le=250),
    offset: int = Query(default=0, ge=0),
):
    filters = []
    if q.strip():
        pattern = f"%{q.strip()}%"
        filters.append((Account.name.ilike(pattern)) | (Account.email.ilike(pattern)) | (Account.phone.ilike(pattern)))
    if role:
        filters.append(Account.role == role)
    elif exclude_users:
        filters.append(Account.role != Role.USER)
    total = db.scalar(select(func.count(Account.id)).where(*filters)) or 0
    rows = db.scalars(select(Account).where(*filters).order_by(Account.created_at.desc()).offset(offset).limit(limit)).all()
    role_counts = {item.value: 0 for item in Role}
    for role_value, count in db.execute(select(Account.role, func.count(Account.id)).group_by(Account.role)):
        role_counts[role_value.value] = int(count)
    return {"items": rows, "total": total, "limit": limit, "offset": offset, "role_counts": role_counts}


def generated_temporary_password(name: str) -> str:
    first_name = name.strip().split()[0]
    formatted_name = first_name[:1].upper() + first_name[1:]
    digits = "".join(secrets.choice(string.digits) for _ in range(6))
    return f"{formatted_name}{digits}{secrets.choice('!@#%&')}"


@router.post("/accounts", response_model=ProvisionedAccountOut, status_code=status.HTTP_201_CREATED)
def create_account(data: AdminAccountCreate, db: DbSession):
    if data.role == Role.USER:
        raise HTTPException(status_code=422, detail="Administrators can provision only admin, employee, or delivery accounts")
    email = data.email.lower().strip()
    if db.scalar(select(Account.id).where(Account.email == email)):
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    temporary_password = generated_temporary_password(data.name)
    account = Account(
        name=data.name.strip(),
        email=email,
        phone=data.phone,
        password_hash=hash_password(temporary_password),
        role=data.role,
        must_change_password=True,
    )
    db.add(account)
    db.add(AdminEvent(event_type="account_created", message=f"{account.name} created with role {account.role.value}", details={"role": account.role.value, "email": account.email}))
    db.commit()
    db.refresh(account)
    notification_status = staff_account_notifier.send_temporary_password(
        name=account.name,
        email=account.email,
        role=account.role.value,
        temporary_password=temporary_password,
    )
    payload = AccountOut.model_validate(account).model_dump()
    # Do not return a delivered password to the browser. If email is not
    # available, show it once to the administrator as a secure hand-off
    # fallback instead.
    payload.update(
        temporary_password=None if notification_status == "EMAIL_SENT" else temporary_password,
        notification_status=notification_status,
    )
    return payload


@router.patch("/accounts/{account_id}/role", response_model=AccountOut)
def change_role(account_id: int, role: Role, actor: CurrentAccount, db: DbSession):
    account = db.get(Account, account_id)
    if account is None:
        raise HTTPException(status_code=404, detail="Account not found")
    if actor.id == account.id:
        raise HTTPException(status_code=400, detail="You cannot change your own role")
    if account.role == Role.ADMIN and role != Role.ADMIN:
        admin_count = db.scalar(select(func.count(Account.id)).where(Account.role == Role.ADMIN)) or 0
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="Cannot change the role of the last remaining administrator")
    account.role = role
    db.add(AdminEvent(event_type="account_role_changed", message=f"{account.name}'s role changed to {role.value}", actor_id=actor.id, details={"account_id": account.id, "role": role.value}))
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
        filters.append(or_(Order.order_id.ilike(pattern), Order.customer_name.ilike(pattern), Order.customer_phone.ilike(pattern)))
    total = db.scalar(select(func.count(Order.order_id)).where(*filters)) or 0
    rows = db.scalars(select(Order).where(*filters).order_by(Order.created_at.desc()).offset(offset).limit(limit)).all()
    status_counts = {item.value: 0 for item in OrderStatus}
    for status_value, count in db.execute(select(Order.status, func.count(Order.order_id)).group_by(Order.status)):
        status_counts[status_value.value] = int(count)
    paid_revenue = sum(order_total_paise(order) for order in rows if order.payment and order.payment.status == PaymentStatus.PAID)
    return {
        "items": [order_payload(order) for order in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
        "status_counts": status_counts,
        "paid_revenue_paise": int(paid_revenue),
    }


@router.patch("/orders/{order_id}/status")
def admin_order_status(order_id: str, data: OrderStatusUpdate, actor: CurrentAccount, db: DbSession):
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    if data.status == OrderStatus.OUT_FOR_DELIVERY:
        raise HTTPException(status_code=400, detail="A delivery partner must take this order from the delivery queue")
    if data.status == OrderStatus.DELIVERED:
        raise HTTPException(status_code=400, detail="A delivery partner must verify the customer’s code to complete delivery")
    payment = db.get(Payment, order.order_id)
    if data.status in {OrderStatus.REJECTED, OrderStatus.CANCELLED} and payment and payment.status in {PaymentStatus.PAID, PaymentStatus.REFUND_PENDING}:
        raise HTTPException(status_code=409, detail="Issue a refund before rejecting or cancelling a paid order")
    transition_order(order, data.status)
    db.add(AdminEvent(event_type="order_status", message=f"Order {order.order_id} changed to {data.status.value} by {actor.name}", actor_id=actor.id, details={"order_id": order.order_id, "status": data.status.value}))
    db.commit()
    return order_payload(order)


@router.post("/orders/{order_id}/refund")
async def refund_order(order_id: str, db: DbSession):
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    payment = db.scalar(select(Payment).where(Payment.order_id == order.order_id))
    if payment is None:
        raise HTTPException(status_code=404, detail="Payment record not found")
    if payment.status == PaymentStatus.REFUND_PENDING:
        return {"order_id": order.order_id, "payment_status": PaymentStatus.REFUND_PENDING, "message": "Refund is still processing with the payment provider."}
    if payment.status != PaymentStatus.PAID or payment.method != PaymentMethod.RAZORPAY:
        raise HTTPException(status_code=409, detail="Only captured Razorpay payments can be refunded here")
    refund_id = await issue_razorpay_refund(order, payment)
    db.commit()
    return {"order_id": order.order_id, "payment_status": payment.status, "refund_id": refund_id}


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
    customer_accounts = select(Account).where(Account.role == Role.USER)
    customers = db.scalars(customer_accounts.order_by(Account.created_at.desc())).all()
    order_counts = dict(db.execute(select(Order.customer_id, func.count(Order.order_id)).where(Order.customer_id.is_not(None)).group_by(Order.customer_id)).all())
    if data.audience == "NEW":
        customers = [person for person in customers if not order_counts.get(person.id, 0)]
    elif data.audience == "RETURNING":
        customers = [person for person in customers if order_counts.get(person.id, 0)]
    configured = {"SMS": False, "EMAIL": bool(settings.smtp_password)}
    eligible = {channel: [person for person in customers if (person.phone if channel == "SMS" else person.email)] for channel in data.channels}
    recipients = list({person.id: person for people in eligible.values() for person in people}.values())
    sent = 0
    failures = []
    delivery_counts = {channel: {"recipient_count": len(eligible[channel]), "sent_count": 0} for channel in data.channels}
    clean_subject = " ".join(data.subject.splitlines()).strip()
    for channel in data.channels:
        if not configured[channel]:
            failures.append("SMS is not configured" if channel == "SMS" else "Email is not configured")
            continue
        channel_recipients = eligible[channel]
        failed_count = 0
        for person in channel_recipients:
            if staff_account_notifier.send_offer(recipient=person.email, subject=clean_subject, message_text=data.message):
                sent += 1
                delivery_counts[channel]["sent_count"] += 1
            else:
                failed_count += 1
        if failed_count:
            failures.append(f"Email could not be delivered to {failed_count} recipient{'s' if failed_count != 1 else ''}")
    state = "SENT" if sent and not failures else "PARTIAL" if sent else "NOT_CONFIGURED" if not any(configured[c] for c in data.channels) else "FAILED"
    log = OfferLog(actor_id=actor.id, audience=data.audience, channels=data.channels, subject=clean_subject, message=data.message, delivery_counts=delivery_counts, recipient_count=sum(len(eligible[channel]) for channel in data.channels), sent_count=sent, status=state)
    db.add(log)
    db.add(AdminEvent(event_type="offer_sent", message=f"Offer message campaign {state.lower()} by {actor.name}", actor_id=actor.id, details={"audience": data.audience, "channels": data.channels, "recipients": len(recipients), "sent": sent, "status": state}))
    db.commit()
    db.refresh(log)
    return {"id": log.id, "audience": log.audience, "channels": log.channels, "subject": log.subject, "message": log.message, "delivery_counts": log.delivery_counts, "recipient_count": log.recipient_count, "sent_count": log.sent_count, "status": log.status, "provider_notes": failures, "created_at": log.created_at}


@router.get("/offers")
def offer_history(db: DbSession):
    logs = db.scalars(select(OfferLog).order_by(OfferLog.created_at.desc()).limit(100)).all()
    return [{"id": log.id, "audience": log.audience, "channels": log.channels, "subject": log.subject, "message": log.message, "delivery_counts": log.delivery_counts or {channel: {"recipient_count": log.recipient_count, "sent_count": log.sent_count} for channel in log.channels}, "recipient_count": log.recipient_count, "sent_count": log.sent_count, "status": log.status, "created_at": log.created_at} for log in logs]


@router.get("/discounts")
def list_discounts(db: DbSession):
    rows = db.scalars(select(MenuDiscount).order_by(MenuDiscount.starts_at.desc())).all()
    campaigns = []
    for row in rows:
        starts_at = row.starts_at if row.starts_at.tzinfo else row.starts_at.replace(tzinfo=timezone.utc)
        ends_at = row.ends_at if row.ends_at.tzinfo else row.ends_at.replace(tzinfo=timezone.utc)
        item_ids = [link.menu_item_id for link in row.items]
        items = db.scalars(select(MenuItem).where(MenuItem.id.in_(item_ids))).all()
        campaigns.append({"id": row.id, "campaign_name": row.campaign_name, "menu_item_ids": item_ids, "menu_item_names": [item.name for item in items], "discount_percent": row.discount_percent, "starts_at": starts_at.isoformat(), "ends_at": ends_at.isoformat(), "created_at": row.created_at})
    return campaigns


@router.post("/discounts", status_code=status.HTTP_201_CREATED)
def create_discount(data: MenuDiscountInput, actor: CurrentAccount, db: DbSession):
    item_ids = list(dict.fromkeys(data.menu_item_ids))
    items = db.scalars(select(MenuItem).where(MenuItem.id.in_(item_ids))).all()
    items_by_id = {item.id: item for item in items}
    if set(item_ids) != set(items_by_id):
        raise HTTPException(status_code=404, detail="One or more menu items were not found")
    starts_at = data.starts_at.astimezone(timezone.utc)
    ends_at = data.ends_at.astimezone(timezone.utc)
    existing = db.scalars(select(MenuDiscount)).all()
    for row in existing:
        old_start = row.starts_at if row.starts_at.tzinfo else row.starts_at.replace(tzinfo=timezone.utc)
        old_end = row.ends_at if row.ends_at.tzinfo else row.ends_at.replace(tzinfo=timezone.utc)
        if starts_at < old_end and ends_at > old_start:
            conflicting = next((link.menu_item_id for link in row.items if link.menu_item_id in item_ids), None)
            if conflicting is None:
                continue
            raise HTTPException(status_code=409, detail=f"{items_by_id[conflicting].name} already has a discount during that time")
    discount = MenuDiscount(campaign_name=data.campaign_name, discount_percent=data.discount_percent, starts_at=starts_at, ends_at=ends_at, created_by_id=actor.id)
    discount.items = [MenuDiscountItem(menu_item_id=item_id) for item_id in item_ids]
    db.add(discount)
    item_names = [items_by_id[item_id].name for item_id in item_ids]
    db.add(AdminEvent(event_type="menu_discount_created", message=f"{data.discount_percent}% discount scheduled for {', '.join(item_names)}", actor_id=actor.id, details={"menu_item_ids": item_ids, "discount_percent": data.discount_percent, "starts_at": starts_at.isoformat(), "ends_at": ends_at.isoformat()}))
    db.commit()
    db.flush()
    return {"id": discount.id, "campaign_name": data.campaign_name, "menu_item_ids": item_ids, "menu_item_names": item_names, "discount_percent": data.discount_percent, "starts_at": starts_at.isoformat(), "ends_at": ends_at.isoformat(), "created_at": discount.created_at}


@router.put("/discounts/{discount_id}")
def update_discount(discount_id: int, data: MenuDiscountInput, actor: CurrentAccount, db: DbSession):
    current = db.get(MenuDiscount, discount_id)
    if not current:
        raise HTTPException(status_code=404, detail="Discount campaign not found")
    if (current.ends_at if current.ends_at.tzinfo else current.ends_at.replace(tzinfo=timezone.utc)) <= datetime.now(timezone.utc):
        raise HTTPException(status_code=409, detail="Ended discount campaigns cannot be edited")
    item_ids = list(dict.fromkeys(data.menu_item_ids))
    items = db.scalars(select(MenuItem).where(MenuItem.id.in_(item_ids))).all()
    items_by_id = {item.id: item for item in items}
    if set(item_ids) != set(items_by_id):
        raise HTTPException(status_code=404, detail="One or more menu items were not found")
    starts_at = data.starts_at.astimezone(timezone.utc)
    ends_at = data.ends_at.astimezone(timezone.utc)
    existing = db.scalars(
        select(MenuDiscount).where(
            MenuDiscount.id != discount_id,
        )
    ).all()
    for row in existing:
        old_start = row.starts_at if row.starts_at.tzinfo else row.starts_at.replace(tzinfo=timezone.utc)
        old_end = row.ends_at if row.ends_at.tzinfo else row.ends_at.replace(tzinfo=timezone.utc)
        row_item_ids = {link.menu_item_id for link in row.items}
        if row_item_ids.intersection(item_ids) and starts_at < old_end and ends_at > old_start:
            conflicting = next(iter(row_item_ids.intersection(item_ids)))
            raise HTTPException(status_code=409, detail=f"{items_by_id[conflicting].name} already has a discount during that time")
    item_names = [items_by_id[item_id].name for item_id in item_ids]
    current.campaign_name = data.campaign_name
    current.items.clear()
    current.items.extend(MenuDiscountItem(menu_item_id=item_id) for item_id in item_ids)
    current.discount_percent = data.discount_percent
    current.starts_at = starts_at
    current.ends_at = ends_at
    db.add(AdminEvent(event_type="menu_discount_updated", message=f"{data.discount_percent}% discount campaign updated for {', '.join(item_names)}", actor_id=actor.id, details={"discount_id": discount_id, "menu_item_ids": item_ids, "discount_percent": data.discount_percent, "starts_at": starts_at.isoformat(), "ends_at": ends_at.isoformat()}))
    db.commit()
    return {"id": current.id, "campaign_name": data.campaign_name, "menu_item_ids": item_ids, "menu_item_names": item_names, "discount_percent": data.discount_percent, "starts_at": starts_at.isoformat(), "ends_at": ends_at.isoformat(), "created_at": current.created_at}


@router.delete("/discounts/{discount_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_discount(discount_id: int, actor: CurrentAccount, db: DbSession):
    discount = db.get(MenuDiscount, discount_id)
    if not discount:
        raise HTTPException(status_code=404, detail="Discount not found")
    if (discount.ends_at if discount.ends_at.tzinfo else discount.ends_at.replace(tzinfo=timezone.utc)) <= datetime.now(timezone.utc):
        raise HTTPException(status_code=409, detail="Ended discount campaigns cannot be deleted")
    item_ids = [link.menu_item_id for link in discount.items]
    item_names = db.scalars(select(MenuItem.name).where(MenuItem.id.in_(item_ids))).all()
    db.add(AdminEvent(event_type="menu_discount_deleted", message=f"Scheduled discount for {', '.join(item_names)} deleted", actor_id=actor.id, details={"menu_item_ids": item_ids, "discount_percent": discount.discount_percent}))
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
    paid = [order for order in orders if order.payment and order.payment.status == PaymentStatus.PAID]
    revenue = sum(order_total_paise(order) for order in paid)
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
        if order.payment and order.payment.status == PaymentStatus.PAID:
            entry["revenue_paise"] += order_total_paise(order)
    statuses = {status.value: sum(1 for order in orders if order.status == status) for status in OrderStatus}
    item_totals: dict[str, int] = {}
    for order in paid:
        for item in order.items:
            name = item.menu_item.name if item.menu_item else "Unavailable item"
            item_totals[name] = item_totals.get(name, 0) + item.quantity
    item_rows = sorted(item_totals.items(), key=lambda row: row[1], reverse=True)[:5]
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
        "top_items": [{"name": name, "quantity": quantity} for name, quantity in item_rows],
    }
