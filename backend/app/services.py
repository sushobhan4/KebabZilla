import base64
import hashlib
import logging
import math
import string
import secrets
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx
from fastapi import HTTPException
from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger(__name__)
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.config import settings
from app.integrations import razorpay
from app.models import (
    Account,
    CustomMenuItem,
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

    std_menu_ids = {line.menu_item_id for line in lines if line.menu_item_id is not None}
    custom_menu_ids = {line.custom_menu_item_id for line in lines if getattr(line, "custom_menu_item_id", None) is not None}
    now = datetime.now(timezone.utc)

    std_items = db.scalars(select(MenuItem).where(MenuItem.id.in_(std_menu_ids), MenuItem.is_available.is_(True))).all() if std_menu_ids else []
    std_by_id = {item.id: item for item in std_items}

    # If an ID wasn't in std_items, check if it's a custom_menu_item_id
    remaining_ids = std_menu_ids - set(std_by_id.keys())
    all_custom_ids = custom_menu_ids | remaining_ids
    custom_items = db.scalars(select(CustomMenuItem).where(CustomMenuItem.id.in_(all_custom_ids), CustomMenuItem.is_available.is_(True))).all() if all_custom_ids else []
    custom_by_id = {item.id: item for item in custom_items}

    unavailable_std_ids = set(db.scalars(select(MenuItem.id).where(MenuItem.id.in_(std_by_id.keys()), MenuItem.paused_by_id.is_not(None))).all())
    unavailable_custom_ids = set(db.scalars(select(CustomMenuItem.id).where(CustomMenuItem.id.in_(custom_by_id.keys()), CustomMenuItem.paused_by_id.is_not(None))).all())
    for line in lines:
        mid = line.menu_item_id
        cid = getattr(line, "custom_menu_item_id", None)
        if mid not in std_by_id and mid not in custom_by_id and cid not in custom_by_id:
            raise HTTPException(status_code=400, detail="One or more menu items are unavailable")
    if unavailable_std_ids or unavailable_custom_ids:
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
    active_custom_discounts: dict[int, int] = {}
    for discount in discounts:
        starts_at = discount.starts_at if discount.starts_at.tzinfo else discount.starts_at.replace(tzinfo=timezone.utc)
        ends_at = discount.ends_at if discount.ends_at.tzinfo else discount.ends_at.replace(tzinfo=timezone.utc)
        if starts_at <= price_at < ends_at:
            for link in discount.items:
                if link.menu_item_id is not None:
                    active_discounts[link.menu_item_id] = discount.discount_percent
                if link.custom_menu_item_id is not None:
                    active_custom_discounts[link.custom_menu_item_id] = discount.discount_percent

    def line_unit_price(line) -> int:
        mid = line.menu_item_id
        cid = getattr(line, "custom_menu_item_id", None)
        if cid in custom_by_id or (mid not in std_by_id and mid in custom_by_id):
            c_item = custom_by_id.get(cid) or custom_by_id[mid]
            base = c_item.base_price_paise
            extra = sum(opt.get("extra_paise", 0) for opt in (getattr(line, "customizations", None) or []))
            raw_total = base + extra
            percent = active_custom_discounts.get(c_item.id)
            if percent is not None:
                return max(1, round(raw_total * (100 - percent) / 100))
            return raw_total

        item = std_by_id[mid]
        var_name = getattr(line, "variation_name", None)
        if not var_name and getattr(line, "customizations", None):
            for c in line.customizations:
                if any(v.get("name", "").lower() == c.get("name", "").lower() for v in (item.variations or [])):
                    var_name = c.get("name")
                    break

        if var_name and item.variations:
            matched_var = next((v for v in item.variations if v.get("name", "").lower() == var_name.lower()), None)
            base = matched_var["price_paise"] if matched_var else item.price_paise
        else:
            base = item.price_paise

        percent = active_discounts.get(item.id)
        if percent is not None:
            base = max(1, round(base * (100 - percent) / 100))
        extra = sum(opt.get("extra_paise", 0) for opt in (getattr(line, "customizations", None) or []) if opt.get("name") != var_name)
        return base + extra

    subtotal = sum(line_unit_price(line) * line.quantity for line in lines)
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

    order_items = []
    for line in lines:
        mid = line.menu_item_id
        cid = getattr(line, "custom_menu_item_id", None)
        is_custom = cid in custom_by_id or (mid not in std_by_id and mid in custom_by_id)
        actual_cid = cid if cid in custom_by_id else (mid if is_custom else None)
        actual_mid = mid if mid in std_by_id else None

        var_name = getattr(line, "variation_name", None)
        if not var_name and not is_custom and actual_mid and getattr(line, "customizations", None):
            for c in line.customizations:
                if any(v.get("name", "").lower() == c.get("name", "").lower() for v in (std_by_id[actual_mid].variations or [])):
                    var_name = c.get("name")
                    break

        order_items.append(
            OrderItem(
                menu_item_id=actual_mid,
                custom_menu_item_id=actual_cid,
                variation_name=var_name,
                quantity=line.quantity,
                customizations=getattr(line, "customizations", None) or [],
            )
        )

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
        items=order_items,
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


def _google_routes_distance_km(
    origin_lat: float, origin_lng: float, dest_lat: float, dest_lng: float
) -> float | None:
    api_key = settings.google_maps_api_key
    if not api_key:
        return None
    url = "https://routes.googleapis.com/directions/v2:computeRoutes"
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": "routes.distanceMeters,routes.duration",
    }
    payload = {
        "origin": {"location": {"latLng": {"latitude": origin_lat, "longitude": origin_lng}}},
        "destination": {"location": {"latLng": {"latitude": dest_lat, "longitude": dest_lng}}},
        "travelMode": "DRIVE",
    }
    try:
        with httpx.Client(timeout=6.0) as client:
            resp = client.post(url, headers=headers, json=payload)
            if resp.status_code == 200:
                data = resp.json()
                routes = data.get("routes") or []
                if routes and "distanceMeters" in routes[0]:
                    meters = float(routes[0]["distanceMeters"])
                    return meters / 1000.0
            else:
                logger.warning("Google Routes API returned %d: %s", resp.status_code, resp.text)
    except Exception as exc:
        logger.warning("Google Routes API request failed: %s", exc)
    return None


def calculate_delivery_distance(
    config: RestaurantSettings,
    latitude: float,
    longitude: float,
) -> tuple[float, str]:
    """Calculates delivery distance according to configured mode: AUTO, GOOGLE_MAPS, or HAVERSINE.
    Returns (distance_km, method_used).
    """
    if config.latitude is None or config.longitude is None:
        raise HTTPException(status_code=503, detail="The restaurant delivery location is not configured")

    mode = (getattr(config, "distance_calculation_mode", None) or "AUTO").upper()
    factor = float(getattr(config, "haversine_routing_factor", None) or 1.3)

    if mode == "HAVERSINE":
        dist = _distance_km(config.latitude, config.longitude, latitude, longitude) * factor
        return round(dist, 2), "HAVERSINE"

    if mode == "GOOGLE_MAPS":
        google_dist = _google_routes_distance_km(config.latitude, config.longitude, latitude, longitude)
        if google_dist is not None:
            return round(google_dist, 2), "GOOGLE_MAPS"
        raise HTTPException(
            status_code=502,
            detail="Google Maps Routes API is unreachable or returned an error. Please try again or switch distance calculation mode."
        )

    # AUTO mode: Try Google Maps first, fall back to Haversine if broken or unconfigured
    google_dist = _google_routes_distance_km(config.latitude, config.longitude, latitude, longitude)
    if google_dist is not None:
        return round(google_dist, 2), "GOOGLE_MAPS"

    dist = _distance_km(config.latitude, config.longitude, latitude, longitude) * factor
    return round(dist, 2), "HAVERSINE"


def _delivery_fee_paise(
    config: RestaurantSettings,
    latitude: float | None,
    longitude: float | None,
) -> int:
    if latitude is None or longitude is None:
        raise HTTPException(status_code=400, detail="Delivery coordinates are required to calculate the delivery fee")
    if config.latitude is None or config.longitude is None:
        raise HTTPException(status_code=503, detail="The restaurant delivery location is not configured")

    distance_km, _ = calculate_delivery_distance(config, latitude, longitude)

    # Check maximum allowed delivery distance from the shop
    if distance_km > config.delivery_radius_km:
        raise HTTPException(
            status_code=400,
            detail=f"Delivery location is {distance_km:.1f} km away, which exceeds our maximum delivery radius of {config.delivery_radius_km:.1f} km."
        )

    # First x km is free
    if distance_km <= config.free_delivery_radius_km:
        return 0

    # Beyond free radius, priced per km proportionally
    billable_km = distance_km - config.free_delivery_radius_km
    raw_fee_inr = billable_km * (config.delivery_fee_per_km_paise / 100.0)
    rounded_fee_inr = math.ceil(raw_fee_inr)
    return int(rounded_fee_inr * 100)


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


def is_scheduled_open(config: RestaurantSettings, value: datetime | None = None) -> tuple[bool, str]:
    schedule = config.weekly_schedule or {}
    if not schedule:
        return True, "Open"
    if value is None:
        value = datetime.now(timezone.utc)
    local = value.astimezone(ZoneInfo(settings.business_timezone))
    day = local.strftime("%A").lower()

    custom_schedules = schedule.get("custom_schedules")
    if isinstance(custom_schedules, list):
        if not custom_schedules:
            return True, "Open"
        moment = local.time().replace(tzinfo=None)
        day_matches = [s for s in custom_schedules if day in (s.get("days") or [])]
        if not day_matches:
            return False, "Closed today"
        for s in day_matches:
            try:
                opens = datetime.strptime(str(s["start_time"]), "%H:%M").time()
                closes = datetime.strptime(str(s["end_time"]), "%H:%M").time()
                if opens <= closes:
                    inside = opens <= moment <= closes
                else:
                    inside = moment >= opens or moment <= closes
                if inside:
                    return True, f"Open until {closes.strftime('%I:%M %p')}"
            except (KeyError, ValueError, TypeError):
                continue
        return False, "Closed"

    hours = schedule.get(day)
    if not hours or not hours.get("open"):
        return False, "Closed today"
    try:
        opens = datetime.strptime(str(hours["opens"]), "%H:%M").time()
        closes = datetime.strptime(str(hours["closes"]), "%H:%M").time()
    except (KeyError, ValueError, TypeError):
        return True, "Open"
    moment = local.time().replace(tzinfo=None)
    if opens <= closes:
        inside = opens <= moment <= closes
    else:
        inside = moment >= opens or moment <= closes
    if inside:
        return True, f"Open until {closes.strftime('%I:%M %p')}"
    return False, f"Closed (Opens at {opens.strftime('%I:%M %p')})"


def is_restaurant_open(config: RestaurantSettings, value: datetime | None = None) -> tuple[bool, str]:
    if not getattr(config, "accepting_orders", True):
        return False, "Not accepting orders"

    sched_open, sched_reason = is_scheduled_open(config, value)
    if sched_open:
        return True, sched_reason

    # If outside operating hours, check if admin explicitly activated an override
    if getattr(config, "admin_override_open", False) is True:
        return True, "Open (Admin override)"

    return False, sched_reason


def _validate_opening_time(config: RestaurantSettings, value: datetime) -> None:
    is_open, reason = is_restaurant_open(config, value)
    if not is_open:
        raise HTTPException(status_code=409, detail=f"The restaurant is closed at that time ({reason})")


def order_payload(order: Order, *, include_delivery_otp: bool = False) -> dict:
    customer = order.customer
    delivery = order.delivery
    payment = order.payment
    items = []
    for line in order.items:
        if line.custom_menu_item:
            base_item = line.custom_menu_item
            base_name = base_item.name
            base_price = base_item.base_price_paise
            img_urls = base_item.image_urls or []
        elif line.menu_item:
            base_item = line.menu_item
            base_name = base_item.name
            img_urls = base_item.image_urls or []
            if line.variation_name and base_item.variations:
                matched_v = next((v for v in base_item.variations if v.get("name", "").lower() == line.variation_name.lower()), None)
                base_price = matched_v["price_paise"] if matched_v else base_item.price_paise
            else:
                base_price = base_item.price_paise
        else:
            base_name = "Unavailable item"
            base_price = 0
            img_urls = []

        customs = line.customizations or []
        extra = sum(opt.get("extra_paise", 0) for opt in customs if isinstance(opt, dict) and opt.get("name") != line.variation_name)
        unit_price = base_price + extra

        if line.variation_name:
            item_name = f"{base_name} ({line.variation_name})"
        elif customs:
            custom_parts = [opt.get("name") for opt in customs if isinstance(opt, dict) and opt.get("name")]
            custom_summary = ", ".join(custom_parts)
            item_name = f"{base_name} ({custom_summary})" if custom_summary else base_name
        else:
            item_name = base_name

        items.append({
            "id": line.id,
            "menu_item_id": line.menu_item_id,
            "custom_menu_item_id": line.custom_menu_item_id,
            "variation_name": line.variation_name,
            "name": item_name,
            "quantity": line.quantity,
            "unit_price_paise": unit_price,
            "line_total_paise": unit_price * line.quantity,
            "tax_percent": 0,
            "tax_paise": 0,
            "customizations": customs,
            "image_url": (img_urls or [None])[0],
            "image_urls": img_urls,
        })
    subtotal = sum(line["line_total_paise"] for line in items)
    chosen_addr = next((a for a in customer.addresses if a.is_default), customer.addresses[0]) if customer and customer.addresses else None
    addr_str = (
        ", ".join(
            p for p in [
                chosen_addr.house_number,
                chosen_addr.road,
                chosen_addr.area,
                chosen_addr.landmark,
                chosen_addr.city,
                chosen_addr.pincode,
            ] if p
        ) or chosen_addr.label
    ) if chosen_addr else ""

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
        "address": addr_str,
        "latitude": chosen_addr.latitude if chosen_addr else None,
        "longitude": chosen_addr.longitude if chosen_addr else None,
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
