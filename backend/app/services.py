import base64
import hashlib
import math
import string
import secrets
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.config import settings
from app.integrations import razorpay
from app.models import (
    Account,
    MenuItem,
    Order,
    OrderItem,
    OrderStatus,
    Payment,
    PaymentMethod,
    PaymentStatus,
    Role,
    RestaurantSettings,
    AdminEvent,
    MenuDiscount,
)
from app.schemas import OrderLineInput

ALLOWED_TRANSITIONS: dict[OrderStatus, set[OrderStatus]] = {
    OrderStatus.PLACED: {OrderStatus.ACCEPTED, OrderStatus.REJECTED, OrderStatus.CANCELLED},
    OrderStatus.ACCEPTED: {OrderStatus.PREPARING, OrderStatus.CANCELLED},
    OrderStatus.PREPARING: {OrderStatus.READY, OrderStatus.CANCELLED},
    OrderStatus.READY: {OrderStatus.OUT_FOR_DELIVERY},
    OrderStatus.OUT_FOR_DELIVERY: {OrderStatus.DELIVERED},
    OrderStatus.DELIVERED: set(),
    OrderStatus.REJECTED: set(),
    OrderStatus.CANCELLED: set(),
}


def restaurant_settings(db: Session) -> RestaurantSettings:
    settings = db.get(RestaurantSettings, 1)
    if settings is None:
        settings = RestaurantSettings(id=1)
        db.add(settings)
        db.flush()
    return settings


def assemble_order(
    db: Session,
    *,
    customer: Account | None,
    created_by: Account | None,
    lines: list[OrderLineInput],
    payment_method: PaymentMethod,
    address: str,
    latitude: float | None = None,
    longitude: float | None = None,
    notes: str,
    order_type: str = "DELIVERY",
    check_minimum: bool = True,
    customer_name: str | None = None,
    customer_email: str | None = None,
    customer_phone: str | None = None,
    scheduled_for: datetime | None = None,
    enforce_opening_hours: bool = True,
) -> Order:
    config = restaurant_settings(db)
    if not config.accepting_orders:
        raise HTTPException(status_code=409, detail="The restaurant is not accepting orders right now")

    menu_ids = {line.menu_item_id for line in lines}
    now = datetime.now(timezone.utc)
    menu = db.scalars(select(MenuItem).where(MenuItem.id.in_(menu_ids), MenuItem.is_available.is_(True))).all()
    unavailable_ids = set(db.scalars(select(MenuItem.id).where(MenuItem.id.in_(menu_ids), MenuItem.paused_by_id.is_not(None))).all())
    menu_by_id = {item.id: item for item in menu}
    if len(menu_by_id) != len(menu_ids) or unavailable_ids:
        raise HTTPException(status_code=400, detail="One or more menu items are unavailable")

    if scheduled_for is not None:
        if scheduled_for.tzinfo is None:
            raise HTTPException(status_code=422, detail="Scheduled order time must include a timezone")
        scheduled_for = scheduled_for.astimezone(timezone.utc)
        if scheduled_for <= now:
            raise HTTPException(status_code=400, detail="Choose a future order time")
        _validate_opening_time(config, scheduled_for)
    elif enforce_opening_hours:
        _validate_opening_time(config, now)

    price_at = scheduled_for or now
    discounts = db.scalars(select(MenuDiscount)).all()
    active_discounts: dict[int, int] = {}
    for discount in discounts:
        starts_at = discount.starts_at if discount.starts_at.tzinfo else discount.starts_at.replace(tzinfo=timezone.utc)
        ends_at = discount.ends_at if discount.ends_at.tzinfo else discount.ends_at.replace(tzinfo=timezone.utc)
        if starts_at <= price_at < ends_at:
            for link in discount.items:
                menu_item_id = link.menu_item_id
                if menu_item_id in menu_ids:
                    active_discounts[menu_item_id] = discount.discount_percent

    def price(item: MenuItem) -> int:
        percent = active_discounts.get(item.id)
        if percent is not None:
            return max(1, (item.price_paise * (100 - percent) + 50) // 100)
        return _effective_price(item)

    def line_unit_price(line, item: MenuItem) -> int:
        base = price(item)
        extra = sum(opt.get("extra_paise", 0) for opt in (getattr(line, "customizations", None) or []))
        return base + extra

    subtotal = sum(line_unit_price(line, menu_by_id[line.menu_item_id]) * line.quantity for line in lines)
    if check_minimum and subtotal < config.minimum_order_paise:
        raise HTTPException(status_code=400, detail=f"Minimum order is ₹{config.minimum_order_paise / 100:.0f}")
    tax = 0
    delivery_fee = _delivery_fee_paise(config, latitude, longitude) if order_type == "DELIVERY" else 0
    if order_type == "DELIVERY" and not address.strip():
        raise HTTPException(status_code=400, detail="A delivery address is required")

    date_key = datetime.now(ZoneInfo(settings.business_timezone)).strftime("%y%m%d")
    prefix = date_key
    if db.bind and db.bind.dialect.name == "postgresql":
        from sqlalchemy import text
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": prefix})
    order_id = _next_order_id(db, prefix)
    order = Order(
        order_id=order_id,
        customer_id=customer.id if customer else None,
        created_by_id=created_by.id if created_by else None,
        status=OrderStatus.PLACED,
        order_type=order_type,
        delivery_fee_paise=delivery_fee,
        scheduled_for=scheduled_for,
        notes=notes,
        customer_name=customer_name or (customer.name if customer else "Walk-in"),
        customer_phone=customer_phone if customer_phone is not None else (customer.phone if customer else None),
        items=[
            OrderItem(
                menu_item_id=menu_by_id[line.menu_item_id].id,
                quantity=line.quantity,
                customizations=getattr(line, "customizations", None) or [],
                unit_price_paise=line_unit_price(line, menu_by_id[line.menu_item_id]),
            )
            for line in lines
        ],
    )
    db.add(order)
    db.flush()
    db.add(AdminEvent(event_type="order_created", message=f"Order {order.order_id} placed", actor_id=created_by.id if created_by else (customer.id if customer else None), details={"order_id": order.order_id, "order_number": order.order_id}))
    return order


def _next_order_id(db: Session, prefix: str) -> str:
    latest = db.scalar(select(func.max(Order.order_id)).where(Order.order_id.like(f"{prefix}%")))
    sequence = int(latest[-3:]) + 1 if latest and latest[-3:].isdigit() else 1
    if sequence > 999:
        raise HTTPException(status_code=503, detail="Daily order number limit reached")
    return f"{prefix}{sequence:03d}"


def _effective_price(item: MenuItem) -> int:
    return item.price_paise


def _delivery_fee_paise(
    config: RestaurantSettings,
    latitude: float | None,
    longitude: float | None,
) -> int:
    if latitude is None or longitude is None:
        raise HTTPException(status_code=400, detail="Delivery coordinates are required to calculate the delivery fee")
    if config.latitude is None or config.longitude is None:
        raise HTTPException(status_code=503, detail="The restaurant delivery location is not configured")

    distance_km = _distance_km(config.latitude, config.longitude, latitude, longitude)
    if distance_km <= config.free_delivery_radius_km:
        return 0
    billable_km = math.ceil(distance_km - config.free_delivery_radius_km)
    return billable_km * config.delivery_fee_per_km_paise


def _distance_km(latitude_a: float, longitude_a: float, latitude_b: float, longitude_b: float) -> float:
    earth_radius_km = 6371.0
    lat_a = math.radians(latitude_a)
    lat_b = math.radians(latitude_b)
    delta_lat = math.radians(latitude_b - latitude_a)
    delta_long = math.radians(longitude_b - longitude_a)
    haversine = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat_a) * math.cos(lat_b) * math.sin(delta_long / 2) ** 2
    )
    return earth_radius_km * 2 * math.atan2(math.sqrt(haversine), math.sqrt(1 - haversine))


def _validate_opening_time(config: RestaurantSettings, value: datetime) -> None:
    schedule = config.weekly_schedule or {}
    if not schedule:
        return
    local = value.astimezone(ZoneInfo(settings.business_timezone))
    day = local.strftime("%A").lower()
    hours = schedule.get(day)
    if not hours or not hours.get("open"):
        raise HTTPException(status_code=409, detail="The restaurant is closed at that time")
    try:
        opens = datetime.strptime(str(hours["opens"]), "%H:%M").time()
        closes = datetime.strptime(str(hours["closes"]), "%H:%M").time()
    except (KeyError, ValueError, TypeError):
        raise HTTPException(status_code=409, detail="The restaurant opening schedule is incomplete")
    moment = local.time().replace(tzinfo=None)
    if opens <= closes:
        inside = opens <= moment <= closes
    else:
        inside = moment >= opens or moment <= closes
    if not inside:
        raise HTTPException(status_code=409, detail="The restaurant is closed at that time")


def order_payload(order: Order, *, include_delivery_otp: bool = False) -> dict:
    customer = order.customer
    delivery = order.delivery
    payment = order.payment
    items = []
    for line in order.items:
        unit_price = line.unit_price_paise if line.unit_price_paise is not None else (line.menu_item.price_paise if line.menu_item else 0)
        customs = line.customizations or []
        custom_parts = [opt.get("name") for opt in customs if isinstance(opt, dict) and opt.get("name")]
        custom_summary = ", ".join(custom_parts)
        if custom_summary and line.menu_item:
            item_name = f"{line.menu_item.name} ({custom_summary})"
        elif line.menu_item:
            item_name = line.menu_item.name
        else:
            item_name = "Unavailable item"

        items.append({
            "id": line.id,
            "menu_item_id": line.menu_item_id,
            "name": item_name,
            "quantity": line.quantity,
            "unit_price_paise": unit_price,
            "line_total_paise": unit_price * line.quantity,
            "tax_percent": 0,
            "tax_paise": 0,
            "customizations": customs,
            "image_url": (line.menu_item.image_urls or [None])[0] if line.menu_item else None,
            "image_urls": line.menu_item.image_urls if line.menu_item else [],
        })
    subtotal = sum(line["line_total_paise"] for line in items)
    return {
        "order_id": order.order_id,
        "customer_id": order.customer_id,
        "customer_name": order.customer_name or (customer.name if customer else "Walk-in"),
        "customer_email": customer.email if customer else "",
        "customer_phone": order.customer_phone or (customer.phone if customer else None),
        "status": order.status,
        "order_type": order.order_type,
        "payment_method": payment.method if payment else None,
        "payment_status": payment.status if payment else PaymentStatus.PENDING,
        "subtotal_paise": subtotal,
        "tax_paise": 0,
        "delivery_fee_paise": order.delivery_fee_paise,
        "total_paise": subtotal + order.delivery_fee_paise,
        "address": (
            ", ".join(
                p for p in [
                    chosen.house_number,
                    chosen.road,
                    chosen.area,
                    chosen.landmark,
                    chosen.city,
                    chosen.pincode,
                ] if p
            ) or chosen.label
        ) if customer and customer.addresses and (chosen := next((a for a in customer.addresses if a.is_default), customer.addresses[0])) else "",
        "latitude": next((a.latitude for a in customer.addresses if a.is_default), customer.addresses[0].latitude) if customer and customer.addresses else None,
        "longitude": next((a.longitude for a in customer.addresses if a.is_default), customer.addresses[0].longitude) if customer and customer.addresses else None,
        "scheduled_for": order.scheduled_for,
        "notes": order.notes,
        "assigned_delivery_id": order.assigned_delivery_id,
        "delivery_name": delivery.name if delivery else None,
        "delivery_phone": delivery.phone if delivery else None,
        "created_at": order.created_at,
        "items": items,
        "delivery_otp": customer_delivery_otp(order) if include_delivery_otp else None,
    }


def order_total_paise(order: Order) -> int:
    return sum(
        (line.menu_item.price_paise if line.menu_item else 0) * line.quantity
        for line in order.items
    ) + order.delivery_fee_paise


def transition_order(order: Order, new_status: OrderStatus) -> None:
    if new_status not in ALLOWED_TRANSITIONS[order.status]:
        raise HTTPException(status_code=409, detail=f"Cannot move an order from {order.status} to {new_status}")
    order.status = new_status


def create_delivery_otp(order: Order) -> str:
    otp = "".join(secrets.choice(string.digits) for _ in range(6))
    order.delivery_otp_ciphertext = _delivery_otp_cipher().encrypt(otp.encode()).decode()
    order.delivery_otp_expires_at = datetime.now(timezone.utc) + timedelta(hours=12)
    return otp


def _delivery_otp_cipher() -> Fernet:
    key = base64.urlsafe_b64encode(hashlib.sha256(settings.jwt_secret.encode()).digest())
    return Fernet(key)


def customer_delivery_otp(order: Order) -> str | None:
    if order.status != OrderStatus.OUT_FOR_DELIVERY or not order.delivery_otp_ciphertext or not order.delivery_otp_expires_at:
        return None
    expires = order.delivery_otp_expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) >= expires:
        return None
    try:
        return _delivery_otp_cipher().decrypt(order.delivery_otp_ciphertext.encode()).decode()
    except (InvalidToken, UnicodeDecodeError):
        return None


def verify_delivery_otp(order: Order, otp: str) -> bool:
    if not order.delivery_otp_ciphertext or not order.delivery_otp_expires_at:
        return False
    expires = order.delivery_otp_expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    try:
        stored_otp = _delivery_otp_cipher().decrypt(order.delivery_otp_ciphertext.encode()).decode()
    except (InvalidToken, UnicodeDecodeError):
        return False
    verified = datetime.now(timezone.utc) < expires and secrets.compare_digest(otp, stored_otp)
    if verified:
        order.delivery_otp_ciphertext = None
    return verified


async def issue_razorpay_refund(order: Order, payment: Payment) -> str | None:
    if payment.method != PaymentMethod.RAZORPAY:
        raise HTTPException(status_code=409, detail="Only Razorpay payments can be refunded automatically")
    if not payment.gateway_payment_id:
        raise HTTPException(status_code=409, detail="The captured Razorpay payment reference is missing")
    result = await razorpay.refund_payment(
        payment_id=payment.gateway_payment_id,
        amount_paise=payment.amount_paise,
        receipt=order.order_id,
    )
    state = result.get("status")
    if state == "failed":
        raise HTTPException(status_code=502, detail="Razorpay could not start the refund; try again")
    payment.status = PaymentStatus.REFUNDED if state == "processed" else PaymentStatus.REFUND_PENDING
    return result.get("id")
