from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.dependencies import CurrentAccount, DbSession
from app.integrations import razorpay
from app.models import Account, CartItem, Order, OrderStatus, Payment, PaymentMethod, PaymentStatus, Role
from app.schemas import OrderCreate
from app.services import assemble_order, issue_razorpay_refund, order_payload, order_total_paise, transition_order

router = APIRouter(prefix="/orders", tags=["customer orders"])


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_order(data: OrderCreate, account: CurrentAccount, db: DbSession):
    if account.role != Role.USER:
        raise HTTPException(status_code=403, detail="Customer ordering is only available to customer accounts")
    if data.payment_method == PaymentMethod.RAZORPAY:
        from app.config import settings
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
    from app.config import settings

    return settings.razorpay_key_id or ""


@router.get("")
def my_orders(account: CurrentAccount, db: DbSession):
    orders = db.scalars(
        select(Order).where(Order.customer_id == account.id).order_by(Order.created_at.desc()).limit(100)
    ).all()
    return [order_payload(order, include_delivery_otp=True) for order in orders]


@router.get("/{order_id}")
def order_details(order_id: str, account: CurrentAccount, db: DbSession):
    order = db.get(Order, order_id)
    if order is None or order.customer_id != account.id:
        raise HTTPException(status_code=404, detail="Order not found")
    return order_payload(order, include_delivery_otp=True)


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
        raise HTTPException(status_code=409, detail="Orders can only be cancelled before the restaurant accepts them")
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
    from app.config import settings
    from app.models import OrderStatus

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
