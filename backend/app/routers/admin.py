from datetime import datetime, time, timedelta, timezone
import logging
import os
import secrets
import string
from zoneinfo import ZoneInfo

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile, status
import httpx
from sqlalchemy import delete, func, or_, select, update

from app.dependencies import CurrentAccount, DbSession, require_roles
from app.config import settings
from app.campaign_dispatcher import campaign_dispatcher
from app.integrations import staff_account_notifier
from app.models import (
    Account,
    AdminEvent,
    CustomMenuItem,
    DeliveryBatch,
    DeliveryBatchOrder,
    StaffInfo,
    MenuDiscount,
    MenuDiscountItem,
    MenuItem,
    OfferLog,
    Order,
    OrderItem,
    OrderStatus,
    PasswordResetCode,
    Payment,
    PaymentMethod,
    PaymentStatus,
    RestaurantSettings,
    Role,
    utcnow,
)
from app.schemas import AccountsPageOut, AccountOut, AdminAccountCreate, AdminOrdersPageOut, MenuDiscountInput, OfferInput, OrderStatusUpdate, ProvisionedAccountOut, RestaurantSettingsInput, RoleChangeInput
from app.security import hash_password, verify_password
from app.services import (
    calculate_override_until,
    evaluate_restaurant_and_delivery_status,
    get_current_closing_time,
    get_next_schedule_refresh,
    is_restaurant_open,
    is_scheduled_open,
    issue_razorpay_refund,
    order_payload,
    order_total_paise,
    restaurant_settings,
    transition_order,
)
from app.cache import (
    KEY_ADMIN_SETTINGS,
    cache,
    invalidate_delivery_cache,
    invalidate_menu_cache,
    invalidate_orders_cache,
    invalidate_restaurant_cache,
)

router = APIRouter(prefix="/admin", tags=["administration"], dependencies=[Depends(require_roles(Role.ADMIN))])
logger = logging.getLogger(__name__)


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
    
    # Generate high-entropy unguessable initial password
    random_init_password = secrets.token_urlsafe(32)
    account = Account(
        name=data.name.strip(),
        email=email,
        phone=data.phone,
        password_hash=hash_password(random_init_password),
        role=data.role,
    )
    account.staff_info = StaffInfo(
        account_id=account.id,
        is_accepting_deliveries=False,
        must_change_password=False,
    )
    db.add(account)
    db.flush()

    db.add(AdminEvent(event_type="account_created", message=f"{account.name} created with role {account.role.value}", details={"role": account.role.value, "email": account.email}))
    db.commit()
    db.refresh(account)

    notification_status = staff_account_notifier.send_account_created_notice(
        name=account.name,
        email=account.email,
        role=account.role.value,
    )

    payload = AccountOut.model_validate(account).model_dump()
    payload.update(
        temporary_password=None,
        notification_status=notification_status,
    )
    return payload


@router.patch("/accounts/{account_id}/role", response_model=AccountOut)
def change_role(account_id: int, data: RoleChangeInput, actor: CurrentAccount, db: DbSession):
    if not verify_password(data.password, actor.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect admin password. Please try again.")
    account = db.get(Account, account_id)
    if account is None:
        raise HTTPException(status_code=404, detail="Account not found")
    if actor.id == account.id:
        raise HTTPException(status_code=400, detail="You cannot change your own role")
    if account.role == Role.ADMIN and data.role != Role.ADMIN:
        admin_count = db.scalar(select(func.count(Account.id)).where(Account.role == Role.ADMIN)) or 0
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="Cannot change the role of the last remaining administrator")
    account.role = data.role
    if data.role != Role.USER and account.staff_info is None:
        account.staff_info = StaffInfo(
            account_id=account.id,
            is_accepting_deliveries=False,
            must_change_password=False,
        )
    db.add(AdminEvent(event_type="account_role_changed", message=f"{account.name}'s role changed to {data.role.value}", actor_id=actor.id, details={"account_id": account.id, "role": data.role.value}))
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
    limit: int = Query(default=10, ge=1, le=250),
    offset: int = Query(default=0, ge=0),
):
    effective_limit = min(limit, 10)
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
    rows = db.scalars(select(Order).where(*filters).order_by(Order.created_at.desc()).offset(offset).limit(effective_limit)).all()
    status_counts = {item.value: 0 for item in OrderStatus}
    for status_value, count in db.execute(select(Order.status, func.count(Order.order_id)).group_by(Order.status)):
        status_counts[status_value.value] = int(count)
    paid_revenue = sum(order_total_paise(order) for order in rows if order.payment and order.payment.status == PaymentStatus.PAID)
    return {
        "items": [order_payload(order) for order in rows],
        "total": total,
        "limit": effective_limit,
        "offset": offset,
        "status_counts": status_counts,
        "paid_revenue_paise": int(paid_revenue),
    }


@router.patch("/orders/{order_id}/status")
def admin_order_status(order_id: str, data: OrderStatusUpdate, actor: CurrentAccount, db: DbSession):
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    payment = db.get(Payment, order.order_id)
    if data.status in {OrderStatus.REJECTED, OrderStatus.CANCELLED} and payment and payment.status in {PaymentStatus.PAID, PaymentStatus.REFUND_PENDING}:
        raise HTTPException(status_code=409, detail="Issue a refund before rejecting or cancelling a paid order")

    old_status = order.status
    order.status = data.status

    # If status is moving back from OUT_FOR_DELIVERY or if moving to statuses before delivery
    if data.status in {OrderStatus.PLACED, OrderStatus.ACCEPTED, OrderStatus.PREPARING, OrderStatus.READY, OrderStatus.REJECTED, OrderStatus.CANCELLED}:
        if order.assigned_delivery_id is not None:
            order.assigned_delivery_id = None
            order.delivery_started_at = None
            order.delivery_otp_ciphertext = None
            order.delivery_otp_expires_at = None
            order.delivery_otp_attempts = 0
            db.execute(delete(DeliveryBatchOrder).where(DeliveryBatchOrder.order_id == order.order_id))
            empty_batches = db.scalars(select(DeliveryBatch).where(~DeliveryBatch.orders.any())).all()
            for eb in empty_batches:
                db.delete(eb)
    elif data.status == OrderStatus.OUT_FOR_DELIVERY:
        if order.delivery_started_at is None:
            order.delivery_started_at = datetime.now(timezone.utc)
    elif data.status == OrderStatus.DELIVERED:
        if order.delivered_at is None:
            order.delivered_at = datetime.now(timezone.utc)

    if data.status != OrderStatus.DELIVERED:
        order.delivered_at = None

    db.add(AdminEvent(
        event_type="order_status",
        message=f"Order {order.order_id} status changed from {old_status.value} to {data.status.value} by {actor.name}",
        actor_id=actor.id,
        details={"order_id": order.order_id, "from_status": old_status.value, "status": data.status.value}
    ))
    db.commit()
    invalidate_orders_cache()
    invalidate_delivery_cache()
    return order_payload(order)


@router.post("/orders/{order_id}/unassign-delivery")
def admin_unassign_delivery(order_id: str, actor: CurrentAccount, db: DbSession):
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")

    driver_name = order.delivery.name if order.delivery else f"Driver #{order.assigned_delivery_id}"
    order.assigned_delivery_id = None
    order.delivery_started_at = None
    order.delivery_otp_ciphertext = None
    order.delivery_otp_expires_at = None
    order.delivery_otp_attempts = 0
    if order.status == OrderStatus.OUT_FOR_DELIVERY:
        order.status = OrderStatus.READY

    db.execute(delete(DeliveryBatchOrder).where(DeliveryBatchOrder.order_id == order.order_id))
    empty_batches = db.scalars(select(DeliveryBatch).where(~DeliveryBatch.orders.any())).all()
    for eb in empty_batches:
        db.delete(eb)

    db.add(AdminEvent(
        event_type="order_delivery_unassigned",
        message=f"Delivery driver {driver_name} unassigned from order {order.order_id} by {actor.name}. Order returned to READY status.",
        actor_id=actor.id,
        details={"order_id": order.order_id}
    ))
    db.commit()
    invalidate_orders_cache()
    invalidate_delivery_cache()
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


def sync_override_if_expired(settings_obj: RestaurantSettings, db: DbSession | None = None) -> None:
    now_utc = datetime.now(timezone.utc)
    changed = False
    if settings_obj.admin_override_until is not None:
        until_utc = settings_obj.admin_override_until
        if until_utc.tzinfo is None:
            until_utc = until_utc.replace(tzinfo=timezone.utc)
        if now_utc >= until_utc:
            settings_obj.admin_override_state = None
            settings_obj.admin_override_until = None
            is_open, _ = is_scheduled_open(settings_obj)
            settings_obj.accepting_orders = is_open
            if is_open:
                settings_obj.is_delivery_open = True
                settings_obj.delivery_paused_until = None
            changed = True

    paused_until = getattr(settings_obj, "delivery_paused_until", None)
    if paused_until is not None:
        if paused_until.tzinfo is None:
            paused_until = paused_until.replace(tzinfo=timezone.utc)
        if now_utc >= paused_until:
            settings_obj.delivery_paused_until = None
            settings_obj.is_delivery_open = True
            changed = True

    if changed and db is not None:
        db.commit()


def serialize_restaurant_settings(settings_obj: RestaurantSettings, db: DbSession | None = None) -> dict:
    is_open, status_reason = is_restaurant_open(settings_obj)
    sched_open, _ = is_scheduled_open(settings_obj)
    next_refresh = get_next_schedule_refresh(settings_obj)
    status_info = evaluate_restaurant_and_delivery_status(settings_obj)

    phones = [p.strip() for p in (settings_obj.phone or "").split(",") if p.strip()]

    active_drivers_ready = 0
    if db is not None:
        active_drivers_ready = db.scalar(
            select(func.count(StaffInfo.account_id))
            .join(Account, Account.id == StaffInfo.account_id)
            .where(
                Account.role.in_([Role.DELIVERY, Role.ADMIN]),
                StaffInfo.is_accepting_deliveries == True,
            )
        ) or 0

    return {
        "id": settings_obj.id,
        "restaurant_name": settings_obj.restaurant_name,
        "tagline": settings_obj.tagline,
        "phone": settings_obj.phone,
        "phones": phones,
        "email": getattr(settings_obj, "email", "support@kebabzilla.in") or "support@kebabzilla.in",
        "address": settings_obj.address,
        "latitude": settings_obj.latitude,
        "longitude": settings_obj.longitude,
        "weekly_schedule": settings_obj.weekly_schedule or {},
        "minimum_order_paise": settings_obj.minimum_order_paise,
        "delivery_radius_km": settings_obj.delivery_radius_km,
        "free_delivery_radius_km": settings_obj.free_delivery_radius_km,
        "delivery_fee_per_km_paise": settings_obj.delivery_fee_per_km_paise,
        "charge_from_zero_beyond_free_radius": getattr(settings_obj, "charge_from_zero_beyond_free_radius", False) or False,
        "accepting_orders": is_open,
        "is_restaurant_open": is_open,
        "is_delivery_open": bool(getattr(settings_obj, "is_delivery_open", True)) if not is_open else (status_info["delivery_status"] != "DELIVERY_PAUSED"),
        "delivery_paused_until": getattr(settings_obj, "delivery_paused_until", None),
        "delivery_paused_reason": getattr(settings_obj, "delivery_paused_reason", "Currently not delivering") or "Currently not delivering",
        "order_cutoff_minutes_before_closing": getattr(settings_obj, "order_cutoff_minutes_before_closing", 30) or 30,
        "delivery_status": status_info["delivery_status"],
        "delivery_status_heading": status_info["delivery_status_heading"],
        "delivery_status_message": status_info["delivery_status_message"],
        "closing_in_minutes": status_info["closing_in_minutes"],
        "closing_time": status_info["closing_time"],
        "admin_override_open": bool(settings_obj.admin_override_state is True),
        "admin_override_state": settings_obj.admin_override_state,
        "admin_override_until": settings_obj.admin_override_until,
        "is_currently_scheduled_open": sched_open,
        "schedule_status": status_reason,
        "next_schedule_refresh": next_refresh,
        "enforce_driver_geofence": settings_obj.enforce_driver_geofence,
        "driver_geofence_meters": settings_obj.driver_geofence_meters,
        "haversine_routing_factor": getattr(settings_obj, "haversine_routing_factor", 1.3627) or 1.3627,
        "average_delivery_speed_kmh": getattr(settings_obj, "average_delivery_speed_kmh", 30.0) or 30.0,
        "customer_sla_minutes": getattr(settings_obj, "customer_sla_minutes", 36.0) or 36.0,
        "alns_max_iterations_mode": getattr(settings_obj, "alns_max_iterations_mode", "AUTO") or "AUTO",
        "alns_max_iterations": getattr(settings_obj, "alns_max_iterations", 220) or 220,
        "max_orders_per_driver": getattr(settings_obj, "max_orders_per_driver", 5) or 5,
        "available_drivers_ready": active_drivers_ready,
    }


@router.get("/settings")
def get_settings(db: DbSession):
    cached = cache.get(KEY_ADMIN_SETTINGS)
    if cached is not None:
        return cached

    settings = restaurant_settings(db)
    sync_override_if_expired(settings, db)
    data = serialize_restaurant_settings(settings, db=db)
    cache.set(KEY_ADMIN_SETTINGS, data, ttl_seconds=10.0)
    return data


@router.put("/settings")
def update_settings(data: RestaurantSettingsInput, db: DbSession):
    try:
        settings = restaurant_settings(db)
        payload_data = data.model_dump()
        if payload_data.get("phones"):
            payload_data["phone"] = ", ".join(p.strip() for p in payload_data["phones"] if p.strip())
        payload_data.pop("phones", None)

        if "weekly_schedule" in payload_data and payload_data["weekly_schedule"]:
            settings.weekly_schedule = payload_data["weekly_schedule"]

        now_dt = datetime.now(timezone.utc)
        is_sched_open, _ = is_scheduled_open(settings, now_dt)

        target_accepting = data.accepting_orders

        was_open, _ = is_restaurant_open(settings, now_dt)

        if target_accepting == is_sched_open:
            # Desired state matches natural schedule: clear any active override!
            settings.admin_override_state = None
            settings.admin_override_until = None
            settings.accepting_orders = target_accepting
        else:
            # Desired state is an override against the natural schedule!
            override_until = calculate_override_until(settings, now_dt, target_accepting)
            settings.admin_override_state = target_accepting
            settings.admin_override_until = override_until
            settings.accepting_orders = target_accepting

        payload_data.pop("admin_override_open", None)
        payload_data.pop("admin_override_state", None)
        payload_data.pop("admin_override_until", None)
        payload_data.pop("accepting_orders", None)
        target_delivery_open = payload_data.pop("is_delivery_open", None)
        payload_data.pop("delivery_paused_until", None)
        target_delivery_reason = payload_data.pop("delivery_paused_reason", None)
        if target_delivery_reason is not None:
            settings.delivery_paused_reason = target_delivery_reason

        for field, value in payload_data.items():
            if hasattr(settings, field):
                setattr(settings, field, value)

        is_now_open, _ = is_restaurant_open(settings, now_dt)

        # When the restaurant opens, online orders start with it until and unless admin turns it off
        if is_now_open and not was_open:
            # Restaurant transitioning from closed to open: online order starts with it!
            settings.is_delivery_open = True
            settings.delivery_paused_until = None
        elif target_delivery_open is not None:
            if target_delivery_open is False:
                settings.is_delivery_open = False
                closing = get_current_closing_time(settings, now_dt)
                settings.delivery_paused_until = closing
            else:
                settings.is_delivery_open = True
                settings.delivery_paused_until = None

        if not is_now_open:
            db.execute(
                update(StaffInfo)
                .where(StaffInfo.is_accepting_deliveries == True)
                .values(is_accepting_deliveries=False)
            )

        admin_override_until_str = None
        if settings.admin_override_until:
            admin_override_until_str = (
                settings.admin_override_until.isoformat()
                if hasattr(settings.admin_override_until, "isoformat")
                else str(settings.admin_override_until)
            )

        db.add(AdminEvent(
            event_type="settings_changed",
            message="Restaurant settings updated",
            details={
                "weekly_schedule": data.weekly_schedule,
                "accepting_orders": settings.accepting_orders,
                "is_restaurant_open": is_now_open,
                "is_delivery_open": settings.is_delivery_open,
                "order_cutoff_minutes_before_closing": settings.order_cutoff_minutes_before_closing,
                "admin_override_state": settings.admin_override_state,
                "admin_override_until": admin_override_until_str,
            }
        ))
        db.commit()
        db.refresh(settings)
        invalidate_restaurant_cache()
        return serialize_restaurant_settings(settings, db=db)
    except Exception as exc:
        logger.exception("Failed to update restaurant settings: %s", exc)
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Could not update restaurant settings: {exc}",
        )



@router.get("/events")
def admin_events(
    db: DbSession,
    limit: int = Query(default=30, ge=1, le=250),
    offset: int = Query(default=0, ge=0),
    q: str = "",
    period: str = "all",
    sort: str = "newest",
):
    effective_limit = min(limit, 30)
    filters = []
    if period in {"day", "week", "month", "year"}:
        start, end, _ = date_range(period, None)
        filters.extend([AdminEvent.created_at >= start, AdminEvent.created_at < end])
    if q.strip():
        pattern = f"%{q.strip()}%"
        filters.append(
            or_(
                AdminEvent.message.ilike(pattern),
                AdminEvent.event_type.ilike(pattern),
                AdminEvent.actor.has(Account.name.ilike(pattern)),
            )
        )
    total = db.scalar(select(func.count(AdminEvent.id)).where(*filters)) or 0

    stmt = select(AdminEvent).where(*filters)
    if sort == "oldest":
        stmt = stmt.order_by(AdminEvent.created_at.asc())
    elif sort == "actor":
        stmt = stmt.outerjoin(Account, AdminEvent.actor_id == Account.id).order_by(
            func.coalesce(Account.name, "System").asc(),
            AdminEvent.created_at.desc(),
        )
    else:
        stmt = stmt.order_by(AdminEvent.created_at.desc())

    rows = db.scalars(
        stmt.offset(offset).limit(effective_limit)
    ).all()
    items = [
        {
            "id": row.id,
            "event_type": row.event_type,
            "message": row.message,
            "details": row.details,
            "actor_name": row.actor.name if row.actor else "System",
            "created_at": row.created_at,
        }
        for row in rows
    ]
    return {
        "items": items,
        "total": total,
        "limit": effective_limit,
        "offset": offset,
    }



@router.post("/email-images/upload", dependencies=[Depends(require_roles(Role.ADMIN))])
async def upload_email_image_endpoint(file: UploadFile = File(...)):
    """Upload an offer email image directly into the Google Cloud Storage bucket (emailImages/ folder)."""
    allowed_types = {
        "image/jpeg",
        "image/jpg",
        "image/pjpeg",
        "image/png",
        "image/x-png",
        "image/webp",
        "image/gif",
        "image/avif",
    }
    raw_content_type = (file.content_type or "").lower().strip()
    filename = file.filename or "image.jpg"
    _, ext = os.path.splitext(filename)
    ext_clean = ext.lower().strip()
    ext_map = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
        ".avif": "image/avif",
    }

    content_type = raw_content_type
    if content_type in ("image/jpg", "image/pjpeg"):
        content_type = "image/jpeg"
    elif content_type in ("image/x-png",):
        content_type = "image/png"
    elif not content_type or content_type == "application/octet-stream":
        content_type = ext_map.get(ext_clean, "image/jpeg")

    if content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail="Only JPEG, PNG, WebP, GIF, and AVIF image formats are supported.",
        )

    content = await file.read()
    if len(content) < 100:
        raise HTTPException(status_code=400, detail="Uploaded file is too small to be a valid image.")

    max_size_bytes = 10 * 1024 * 1024  # 10MB
    if len(content) > max_size_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Image size exceeds 10MB limit ({len(content) / (1024 * 1024):.2f}MB). Please upload a smaller image.",
        )

    try:
        from app.storage import upload_email_image
        result = upload_email_image(content, filename, content_type)
        return result
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Image upload to storage failed: {exc}")


@router.get("/email-images", dependencies=[Depends(require_roles(Role.ADMIN))])
def list_email_images_endpoint():
    """List all images stored in the GCS emailImages/ folder."""
    from app.storage import list_email_images
    return list_email_images()


@router.delete("/email-images/{filename:path}", dependencies=[Depends(require_roles(Role.ADMIN))])
def delete_email_image_endpoint(filename: str):
    """Delete an email image from GCS and local cache."""
    import os
    from app.storage import delete_email_image
    clean_name = os.path.basename(filename)
    deleted = delete_email_image(clean_name)
    if not deleted:
        raise HTTPException(status_code=404, detail="Email image not found or already deleted.")
    return {"deleted": True, "filename": clean_name}


@router.post("/offers", status_code=status.HTTP_201_CREATED)
async def create_offer(data: OfferInput, actor: CurrentAccount, db: DbSession, background_tasks: BackgroundTasks):
    customer_accounts = select(Account).where(Account.role == Role.USER, Account.promotional_consent.is_(True))
    customers = db.scalars(customer_accounts.order_by(Account.created_at.desc())).all()
    order_counts = dict(db.execute(select(Order.customer_id, func.count(Order.order_id)).where(Order.customer_id.is_not(None)).group_by(Order.customer_id)).all())
    if data.audience == "NEW":
        customers = [person for person in customers if not order_counts.get(person.id, 0)]
    elif data.audience == "RETURNING":
        customers = [person for person in customers if order_counts.get(person.id, 0)]
    configured = {"SMS": False, "EMAIL": bool(settings.smtp_password)}
    eligible = {channel: [person for person in customers if (person.phone if channel == "SMS" else person.email)] for channel in data.channels}
    recipients = list({person.id: person for people in eligible.values() for person in people}.values())
    failures = []
    delivery_counts = {channel: {"recipient_count": len(eligible[channel]), "sent_count": 0} for channel in data.channels}
    clean_subject = " ".join(data.subject.splitlines()).strip()

    email_recipients = [person.email for person in eligible.get("EMAIL", []) if person.email] if "EMAIL" in data.channels else []
    sms_recipients = [person.phone for person in eligible.get("SMS", []) if person.phone] if "SMS" in data.channels else []
    if "SMS" in data.channels and not configured["SMS"]:
        failures.append("SMS is not configured")
    if "EMAIL" in data.channels and not configured["EMAIL"]:
        failures.append("Email is not configured")

    has_queued = (configured.get("EMAIL") and bool(email_recipients)) or (configured.get("SMS") and bool(sms_recipients))
    state = "QUEUED" if has_queued else ("NOT_CONFIGURED" if not any(configured[c] for c in data.channels) else "FAILED")
    log = OfferLog(
        actor_id=actor.id,
        audience=data.audience,
        channels=data.channels,
        subject=clean_subject,
        message=data.message,
        delivery_counts=delivery_counts,
        status=state,
    )
    db.add(log)
    db.add(AdminEvent(event_type="offer_sent", message=f"Offer message campaign queued by {actor.name}", actor_id=actor.id, details={"audience": data.audience, "channels": data.channels, "recipients": len(recipients), "status": state}))
    db.commit()
    db.refresh(log)

    if configured.get("EMAIL") and email_recipients:
        campaign_dispatcher.enqueue_email_campaign(
            log.id,
            email_recipients,
            subject=clean_subject,
            message=data.message,
            headline=data.headline,
            subheading=data.subheading,
            promo_code=data.promo_code,
            discount_highlight=data.discount_highlight,
            cta_text=data.cta_text,
            cta_url=data.cta_url,
            background_image_url=data.background_image_url,
            theme_color=data.theme_color,
            background_opacity=data.background_opacity,
            outer_blur=data.outer_blur,
            invert_logo=data.invert_logo,
        )

    if configured.get("SMS") and sms_recipients:
        campaign_dispatcher.enqueue_sms_campaign(
            log.id,
            sms_recipients,
            message=data.message,
            promo_code=data.promo_code,
        )

    return {
        "id": log.id,
        "audience": log.audience,
        "channels": log.channels,
        "subject": log.subject,
        "message": log.message,
        "delivery_counts": log.delivery_counts,
        "recipient_count": log.recipient_count,
        "sent_count": 0,
        "status": log.status,
        "provider_notes": failures,
        "created_at": log.created_at,
    }


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
        item_ids = [link.menu_item_id for link in row.items if link.menu_item_id is not None]
        items = db.scalars(select(MenuItem).where(MenuItem.id.in_(item_ids))).all() if item_ids else []
        item_names = [item.name for item in items]
        campaigns.append({
            "id": row.id,
            "campaign_name": row.campaign_name,
            "menu_item_ids": item_ids,
            "custom_menu_item_ids": [],
            "menu_item_names": item_names,
            "discount_percent": row.discount_percent,
            "starts_at": starts_at.isoformat(),
            "ends_at": ends_at.isoformat(),
            "created_at": row.created_at,
        })
    return campaigns


@router.post("/discounts", status_code=status.HTTP_201_CREATED)
def create_discount(data: MenuDiscountInput, actor: CurrentAccount, db: DbSession):
    item_ids = list(dict.fromkeys(data.menu_item_ids + data.custom_menu_item_ids))
    items = db.scalars(select(MenuItem).where(MenuItem.id.in_(item_ids))).all() if item_ids else []
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
            conflicting_std = next((link.menu_item_id for link in row.items if link.menu_item_id and link.menu_item_id in item_ids), None)
            if conflicting_std is not None:
                raise HTTPException(status_code=409, detail=f"{items_by_id[conflicting_std].name} already has a discount during that time")

    discount = MenuDiscount(campaign_name=data.campaign_name, discount_percent=data.discount_percent, starts_at=starts_at, ends_at=ends_at, created_by_id=actor.id)
    discount.items = [MenuDiscountItem(menu_item_id=mid) for mid in item_ids]
    db.add(discount)
    item_names = [items_by_id[mid].name for mid in item_ids]
    db.add(AdminEvent(event_type="menu_discount_created", message=f"{data.discount_percent}% discount scheduled for {', '.join(item_names)}", actor_id=actor.id, details={"menu_item_ids": item_ids, "discount_percent": data.discount_percent, "starts_at": starts_at.isoformat(), "ends_at": ends_at.isoformat()}))
    db.commit()
    db.flush()
    invalidate_menu_cache()
    return {
        "id": discount.id,
        "campaign_name": data.campaign_name,
        "menu_item_ids": item_ids,
        "custom_menu_item_ids": [],
        "menu_item_names": item_names,
        "discount_percent": data.discount_percent,
        "starts_at": starts_at.isoformat(),
        "ends_at": ends_at.isoformat(),
        "created_at": discount.created_at,
    }


@router.put("/discounts/{discount_id}")
def update_discount(discount_id: int, data: MenuDiscountInput, actor: CurrentAccount, db: DbSession):
    current = db.get(MenuDiscount, discount_id)
    if not current:
        raise HTTPException(status_code=404, detail="Discount campaign not found")
    if (current.ends_at if current.ends_at.tzinfo else current.ends_at.replace(tzinfo=timezone.utc)) <= datetime.now(timezone.utc):
        raise HTTPException(status_code=409, detail="Ended discount campaigns cannot be edited")
    item_ids = list(dict.fromkeys(data.menu_item_ids + data.custom_menu_item_ids))
    items = db.scalars(select(MenuItem).where(MenuItem.id.in_(item_ids))).all() if item_ids else []
    items_by_id = {item.id: item for item in items}
    if set(item_ids) != set(items_by_id):
        raise HTTPException(status_code=404, detail="One or more menu items were not found")

    starts_at = data.starts_at.astimezone(timezone.utc)
    ends_at = data.ends_at.astimezone(timezone.utc)
    existing = db.scalars(select(MenuDiscount).where(MenuDiscount.id != discount_id)).all()
    for row in existing:
        old_start = row.starts_at if row.starts_at.tzinfo else row.starts_at.replace(tzinfo=timezone.utc)
        old_end = row.ends_at if row.ends_at.tzinfo else row.ends_at.replace(tzinfo=timezone.utc)
        if starts_at < old_end and ends_at > old_start:
            conflicting_std = next((link.menu_item_id for link in row.items if link.menu_item_id and link.menu_item_id in item_ids), None)
            if conflicting_std is not None:
                raise HTTPException(status_code=409, detail=f"{items_by_id[conflicting_std].name} already has a discount during that time")

    item_names = [items_by_id[mid].name for mid in item_ids]
    current.campaign_name = data.campaign_name
    current.items.clear()
    current.items.extend([MenuDiscountItem(menu_item_id=mid) for mid in item_ids])
    current.discount_percent = data.discount_percent
    current.starts_at = starts_at
    current.ends_at = ends_at
    db.add(AdminEvent(event_type="menu_discount_updated", message=f"{data.discount_percent}% discount campaign updated for {', '.join(item_names)}", actor_id=actor.id, details={"discount_id": discount_id, "menu_item_ids": item_ids, "discount_percent": data.discount_percent, "starts_at": starts_at.isoformat(), "ends_at": ends_at.isoformat()}))
    db.commit()
    invalidate_menu_cache()
    return {
        "id": current.id,
        "campaign_name": data.campaign_name,
        "menu_item_ids": item_ids,
        "custom_menu_item_ids": [],
        "menu_item_names": item_names,
        "discount_percent": data.discount_percent,
        "starts_at": starts_at.isoformat(),
        "ends_at": ends_at.isoformat(),
        "created_at": current.created_at,
    }


@router.delete("/discounts/{discount_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_discount(discount_id: int, actor: CurrentAccount, db: DbSession):
    discount = db.get(MenuDiscount, discount_id)
    if not discount:
        raise HTTPException(status_code=404, detail="Discount not found")
    if (discount.ends_at if discount.ends_at.tzinfo else discount.ends_at.replace(tzinfo=timezone.utc)) <= datetime.now(timezone.utc):
        raise HTTPException(status_code=409, detail="Ended discount campaigns cannot be deleted")
    item_ids = [link.menu_item_id for link in discount.items if link.menu_item_id is not None]
    item_names = db.scalars(select(MenuItem.name).where(MenuItem.id.in_(item_ids))).all() if item_ids else []
    all_names = list(item_names)
    db.add(AdminEvent(event_type="menu_discount_deleted", message=f"Scheduled discount for {', '.join(all_names)} deleted", actor_id=actor.id, details={"menu_item_ids": item_ids, "discount_percent": discount.discount_percent}))
    db.delete(discount)
    db.commit()
    invalidate_menu_cache()



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
