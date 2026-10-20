from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import joinedload, selectinload

from app.config import settings
from app.dependencies import CurrentAccount, DbSession
from app.integrations import razorpay
from app.models import Account, CartItem, Order, OrderItem, OrderStatus, Payment, PaymentMethod, PaymentStatus, Role
from app.schemas import OrderCreate
from app.services import assemble_order, issue_razorpay_refund, order_payload, order_total_paise, transition_order

router = APIRouter(prefix="/orders", tags=["customer orders"])


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_order(data: OrderCreate, account: CurrentAccount, db: DbSession):
    if data.payment_method == PaymentMethod.RAZORPAY:
        if not settings.razorpay_key_id or not settings.razorpay_key_secret:
            raise HTTPException(status_code=503, detail="Online payment is not configured. Choose cash or contact the restaurant.")
    order = assemble_order(
        db,
        customer=account,
        created_by=None,
        lines=data.items,
        payment_method=data.payment_method,
        address=data.address,
        latitude=data.latitude,
        longitude=data.longitude,
        notes=data.notes,
        scheduled_for=data.scheduled_for,
    )
    payment = Payment(order_id=order.order_id, method=data.payment_method, status=PaymentStatus.PENDING, amount_paise=order_total_paise(order))
    db.add(payment)
    if data.payment_method == PaymentMethod.CASH:
        db.query(CartItem).filter(CartItem.customer_id == account.id).delete(synchronize_session=False)
    db.commit()
    db.refresh(order)
    payload = order_payload(order)
    if data.payment_method == PaymentMethod.RAZORPAY:
        gateway_order = await razorpay.create_order(amount_paise=order_total_paise(order), receipt=order.order_id)
        payment.gateway_order_id = gateway_order["id"]
        db.commit()
        payload["checkout"] = {
            "gateway_order_id": gateway_order["id"],
            "amount": gateway_order["amount"],
            "currency": gateway_order["currency"],
            "key_id": razorpay_key_id(),
            "name": "KebabZilla",
            "description": f"Order {order.order_id}",
            "prefill": {"name": account.name, "email": account.email, "contact": account.phone or ""},
        }
    return payload


def razorpay_key_id() -> str:
    return settings.razorpay_key_id or ""


@router.get("")
def my_orders(
    account: CurrentAccount,
    db: DbSession,
    limit: int = 10,
    offset: int = 0,
):
    effective_limit = min(limit, 10)
    total = db.scalar(select(func.count(Order.order_id)).where(Order.customer_id == account.id)) or 0
    orders = db.scalars(
        select(Order)
        .where(Order.customer_id == account.id)
        .options(
            joinedload(Order.payment),
            joinedload(Order.delivery),
            selectinload(Order.items).joinedload(OrderItem.menu_item),
        )
        .order_by(Order.created_at.desc())
        .offset(offset)
        .limit(effective_limit)
    ).all()
    return {
        "items": [order_payload(order, include_delivery_otp=True) for order in orders],
        "total": total,
        "limit": effective_limit,
        "offset": offset,
    }


@router.post("/{order_id}/switch-to-cash")
def switch_to_cash(order_id: str, account: CurrentAccount, db: DbSession):
    order = db.scalar(select(Order).where(Order.order_id == order_id, Order.customer_id == account.id))
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    payment = db.get(Payment, order.order_id)
    if not payment or payment.status == PaymentStatus.PAID:
        raise HTTPException(status_code=400, detail="Cannot switch payment method for a paid order")
    payment.method = PaymentMethod.CASH
    payment.status = PaymentStatus.PENDING
    payment.gateway_order_id = None
    payment.gateway_payment_id = None
    db.query(CartItem).filter(CartItem.customer_id == account.id).delete(synchronize_session=False)
    db.commit()
    db.refresh(order)
    return order_payload(order)


@router.post("/{order_id}/abandon")
def abandon_order(order_id: str, account: CurrentAccount, db: DbSession):
    order = db.scalar(select(Order).where(Order.order_id == order_id, Order.customer_id == account.id))
    if order and order.status == OrderStatus.PLACED:
        payment = db.get(Payment, order.order_id)
        if payment and payment.status != PaymentStatus.PAID:
            transition_order(order, OrderStatus.CANCELLED)
            db.commit()
    return {"ok": True}


@router.get("/{order_id}")
def order_details(order_id: str, account: CurrentAccount, db: DbSession):
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    if (
        order.customer_id != account.id
        and order.assigned_delivery_id != account.id
        and account.role not in (Role.ADMIN, Role.EMPLOYEE)
    ):
        raise HTTPException(status_code=404, detail="Order not found")
    is_customer = order.customer_id == account.id
    return order_payload(order, include_delivery_otp=is_customer)


@router.post("/{order_id}/cancel")
async def cancel_order(order_id: str, account: CurrentAccount, db: DbSession):
    order = db.scalar(select(Order).where(Order.order_id == order_id, Order.customer_id == account.id))
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status == OrderStatus.CANCELLED:
        payment = db.get(Payment, order.order_id)
        if payment and payment.status == PaymentStatus.PAID:
            await issue_razorpay_refund(order, payment)
            db.commit()
        return order_payload(order)
    if order.status != OrderStatus.PLACED:
        raise HTTPException(
            status_code=409,
            detail="Orders in preparation cannot be cancelled online. To cancel this order, please call the restaurant directly.",
        )
    payment = db.get(Payment, order.order_id)
    if payment and payment.status == PaymentStatus.PAID:
        if payment is None or payment.method != PaymentMethod.RAZORPAY:
            raise HTTPException(status_code=409, detail="This payment cannot be refunded automatically")
        await issue_razorpay_refund(order, payment)
    elif payment and payment.status == PaymentStatus.REFUND_PENDING:
        # A refund was already initiated; cancellation must not submit a duplicate refund.
        pass
    transition_order(order, OrderStatus.CANCELLED)
    db.commit()
    return order_payload(order)


@router.post("/{order_id}/payment-session")
async def payment_session(order_id: str, account: CurrentAccount, db: DbSession):
    """Issue a fresh Razorpay checkout for a still-payable customer order."""
    order = db.scalar(select(Order).where(Order.order_id == order_id, Order.customer_id == account.id))
    payment = db.get(Payment, order.order_id) if order else None
    if not order or not payment or payment.method != PaymentMethod.RAZORPAY:
        raise HTTPException(status_code=404, detail="Online payment order not found")
    if payment.status == PaymentStatus.PAID:
        raise HTTPException(status_code=409, detail="This order has already been paid")
    if order.status in {OrderStatus.REJECTED, OrderStatus.CANCELLED, OrderStatus.DELIVERED}:
        raise HTTPException(status_code=409, detail="This order can no longer be paid")
    if not settings.razorpay_key_id or not settings.razorpay_key_secret:
        raise HTTPException(status_code=503, detail="Online payment is not configured. Contact the restaurant.")
    gateway_order = await razorpay.create_order(amount_paise=order_total_paise(order), receipt=order.order_id)
    payment.gateway_order_id = gateway_order["id"]
    db.commit()
    return {
        "gateway_order_id": gateway_order["id"],
        "amount": gateway_order["amount"],
        "currency": gateway_order["currency"],
        "key_id": settings.razorpay_key_id,
        "name": "KebabZilla",
        "description": f"Order {order.order_id}",
        "prefill": {"name": account.name, "email": account.email, "contact": account.phone or ""},
    }
