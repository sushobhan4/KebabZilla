import base64
import hashlib
import string
import secrets
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from cryptography.fernet import Fernet, InvalidToken
from pwdlib import PasswordHash
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.config import settings
from app.integrations import razorpay
from app.models import (
    Account,
    MenuItem,
    MenuPause,
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

otp_hash = PasswordHash.recommended()

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
    active_pauses = db.scalars(select(MenuPause.menu_item_id).where(MenuPause.menu_item_id.in_(menu_ids), MenuPause.paused_until > now)).all()
    unavailable_ids = set(active_pauses)
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
    discounts = db.scalars(select(MenuDiscount).where(MenuDiscount.menu_item_id.in_(menu_ids))).all()
    active_discounts: dict[int, int] = {}
    for discount in discounts:
        starts_at = discount.starts_at if discount.starts_at.tzinfo else discount.starts_at.replace(tzinfo=timezone.utc)
        ends_at = discount.ends_at if discount.ends_at.tzinfo else discount.ends_at.replace(tzinfo=timezone.utc)
        if starts_at <= price_at < ends_at:
            active_discounts[discount.menu_item_id] = discount.discount_percent

    def price(item: MenuItem) -> int:
        percent = active_discounts.get(item.id)
        if percent is not None:
            return max(1, (item.price_paise * (100 - percent) + 50) // 100)
        return _effective_price(item)

    subtotal = sum(price(menu_by_id[line.menu_item_id]) * line.quantity for line in lines)
    if check_minimum and subtotal < config.minimum_order_paise:
        raise HTTPException(status_code=400, detail=f"Minimum order is ₹{config.minimum_order_paise / 100:.0f}")
    tax = sum(
        (price(menu_by_id[line.menu_item_id]) * line.quantity * menu_by_id[line.menu_item_id].tax_percent + 50) // 100
        for line in lines
    )
    delivery_fee = config.delivery_fee_paise if order_type == "DELIVERY" else 0
    if order_type == "DELIVERY" and not address.strip():
        raise HTTPException(status_code=400, detail="A delivery address is required")

    date_key = datetime.now(ZoneInfo(settings.business_timezone)).strftime("%y%m%d")
    prefix = date_key
    if db.bind and db.bind.dialect.name == "postgresql":
        from sqlalchemy import text
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": prefix})
    public_id = _next_public_id(db, prefix)
    order = Order(
        public_id=public_id,
        customer_id=customer.id if customer else None,
        created_by_id=created_by.id if created_by else None,
        status=OrderStatus.PLACED,
        order_type=order_type,
        payment_method=payment_method,
        payment_status=PaymentStatus.PENDING,
        subtotal_paise=subtotal,
        tax_paise=tax,
        delivery_fee_paise=delivery_fee,
        total_paise=subtotal + tax + delivery_fee,
        address=address,
        scheduled_for=scheduled_for,
        notes=notes,
        customer_name=customer_name or (customer.name if customer else "Walk-in"),
        customer_email=customer_email if customer_email is not None else (customer.email if customer else None),
        customer_phone=customer_phone if customer_phone is not None else (customer.phone if customer else None),
        items=[
            OrderItem(
                menu_item_id=menu_by_id[line.menu_item_id].id,
                item_name=menu_by_id[line.menu_item_id].name,
                unit_price_paise=price(menu_by_id[line.menu_item_id]),
                tax_percent=menu_by_id[line.menu_item_id].tax_percent,
                quantity=line.quantity,
            )
            for line in lines
        ],
    )
    db.add(order)
    db.flush()
    db.add(AdminEvent(event_type="order_created", message=f"Order {order.public_id} placed", actor_id=created_by.id if created_by else (customer.id if customer else None), details={"order_id": order.id, "order_number": order.public_id}))
    return order


def _next_public_id(db: Session, prefix: str) -> str:
    latest = db.scalar(select(func.max(Order.public_id)).where(Order.public_id.like(f"{prefix}%")))
    sequence = int(latest[-3:]) + 1 if latest and latest[-3:].isdigit() else 1
    if sequence > 999:
        raise HTTPException(status_code=503, detail="Daily order number limit reached")
    return f"{prefix}{sequence:03d}"


def _effective_price(item: MenuItem) -> int:
    if item.discounted_price_paise is not None:
        return min(item.price_paise, item.discounted_price_paise)
    if item.discount_percent:
        return max(1, (item.price_paise * (100 - item.discount_percent) + 50) // 100)
    return item.price_paise


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
    return {
        "id": order.id,
        "public_id": order.public_id,
        "customer_id": order.customer_id,
        "customer_name": order.customer_name or (customer.name if customer else "Walk-in"),
        "customer_email": order.customer_email or (customer.email if customer else ""),
        "customer_phone": order.customer_phone or (customer.phone if customer else None),
        "status": order.status,
        "order_type": order.order_type,
        "payment_method": order.payment_method,
        "payment_status": order.payment_status,
        "subtotal_paise": order.subtotal_paise,
        "tax_paise": order.tax_paise,
        "delivery_fee_paise": order.delivery_fee_paise,
        "total_paise": order.total_paise,
        "address": order.address,
        "scheduled_for": order.scheduled_for,
        "notes": order.notes,
        "assigned_delivery_id": order.assigned_delivery_id,
        "delivery_name": delivery.name if delivery else None,
        "delivery_phone": delivery.phone if delivery else None,
        "created_at": order.created_at,
        "items": [
            {
                "id": line.id,
                "menu_item_id": line.menu_item_id,
                "name": line.item_name,
                "quantity": line.quantity,
                "unit_price_paise": line.unit_price_paise,
                "line_total_paise": line.unit_price_paise * line.quantity,
                "tax_percent": line.tax_percent,
                "tax_paise": (line.unit_price_paise * line.quantity * line.tax_percent + 50) // 100,
                "image_url": line.menu_item.image_url if line.menu_item else None,
                "image_urls": (line.menu_item.image_urls or ([line.menu_item.image_url] if line.menu_item.image_url else [])) if line.menu_item else [],
            }
            for line in order.items
        ],
        "delivery_otp": customer_delivery_otp(order) if include_delivery_otp else None,
    }


def transition_order(order: Order, new_status: OrderStatus) -> None:
    if new_status not in ALLOWED_TRANSITIONS[order.status]:
        raise HTTPException(status_code=409, detail=f"Cannot move an order from {order.status} to {new_status}")
    order.status = new_status


def create_delivery_otp(order: Order) -> str:
    otp = "".join(secrets.choice(string.digits) for _ in range(6))
    order.delivery_otp_hash = otp_hash.hash(otp)
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
    if not order.delivery_otp_hash or not order.delivery_otp_expires_at:
        return False
    expires = order.delivery_otp_expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    verified = datetime.now(timezone.utc) < expires and otp_hash.verify(otp, order.delivery_otp_hash)
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
        receipt=order.public_id,
    )
    state = result.get("status")
    if state == "failed":
        raise HTTPException(status_code=502, detail="Razorpay could not start the refund; try again")
    payment.status = PaymentStatus.REFUNDED if state == "processed" else PaymentStatus.REFUND_PENDING
    order.payment_status = payment.status
    return result.get("id")
