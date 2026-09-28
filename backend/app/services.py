import base64
import hashlib
import secrets
import string
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from cryptography.fernet import Fernet, InvalidToken
from pwdlib import PasswordHash
from sqlalchemy import select
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
) -> Order:
    config = restaurant_settings(db)
    if not config.accepting_orders:
        raise HTTPException(status_code=409, detail="The restaurant is not accepting orders right now")

    menu_ids = {line.menu_item_id for line in lines}
    menu = db.scalars(select(MenuItem).where(MenuItem.id.in_(menu_ids), MenuItem.is_available.is_(True))).all()
    menu_by_id = {item.id: item for item in menu}
    if len(menu_by_id) != len(menu_ids):
        raise HTTPException(status_code=400, detail="One or more menu items are unavailable")

    subtotal = sum(menu_by_id[line.menu_item_id].price_paise * line.quantity for line in lines)
    if check_minimum and subtotal < config.minimum_order_paise:
        raise HTTPException(status_code=400, detail=f"Minimum order is ₹{config.minimum_order_paise / 100:.0f}")
    tax = sum(
        (menu_by_id[line.menu_item_id].price_paise * line.quantity * menu_by_id[line.menu_item_id].tax_percent + 50) // 100
        for line in lines
    )
    delivery_fee = config.delivery_fee_paise if order_type == "DELIVERY" else 0
    if order_type == "DELIVERY" and not address.strip():
        raise HTTPException(status_code=400, detail="A delivery address is required")

    public_id = f"KZ{datetime.now(timezone.utc):%y%m%d}{secrets.token_hex(3).upper()}"
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
        notes=notes,
        customer_name=customer_name or (customer.name if customer else "Walk-in"),
        customer_email=customer_email if customer_email is not None else (customer.email if customer else None),
        customer_phone=customer_phone if customer_phone is not None else (customer.phone if customer else None),
        items=[
            OrderItem(
                menu_item_id=menu_by_id[line.menu_item_id].id,
                item_name=menu_by_id[line.menu_item_id].name,
                unit_price_paise=menu_by_id[line.menu_item_id].price_paise,
                tax_percent=menu_by_id[line.menu_item_id].tax_percent,
                quantity=line.quantity,
            )
            for line in lines
        ],
    )
    db.add(order)
    db.flush()
    return order


def order_payload(order: Order, *, include_delivery_otp: bool = False) -> dict:
    customer = order.customer
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
        "notes": order.notes,
        "assigned_delivery_id": order.assigned_delivery_id,
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
