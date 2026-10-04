import json

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.dependencies import CurrentAccount, DbSession
from app.integrations import razorpay
from app.models import Order, OrderStatus, Payment, PaymentMethod, PaymentStatus
from app.services import issue_razorpay_refund

router = APIRouter(prefix="/payments", tags=["payments"])


class VerifyPayment(BaseModel):
    gateway_order_id: str = Field(min_length=4, max_length=120)
    gateway_payment_id: str = Field(min_length=4, max_length=120)
    signature: str = Field(min_length=20, max_length=256)


@router.post("/razorpay/verify")
async def verify_checkout(data: VerifyPayment, account: CurrentAccount, db: DbSession):
    payment = db.scalar(select(Payment).where(Payment.gateway_order_id == data.gateway_order_id))
    if not payment:
        raise HTTPException(status_code=404, detail="Payment session not found")
    order = db.get(Order, payment.order_id)
    if not order or order.customer_id != account.id:
        raise HTTPException(status_code=404, detail="Payment session not found")
    if payment.status == PaymentStatus.PAID:
        if order.status == OrderStatus.CANCELLED and payment.method == PaymentMethod.RAZORPAY:
            await issue_razorpay_refund(order, payment)
            db.commit()
            return {"status": payment.status, "order_id": order.order_id}
        return {"status": "PAID", "order_id": order.order_id}
    if not razorpay.verify_checkout_signature(
        gateway_order_id=data.gateway_order_id,
        payment_id=data.gateway_payment_id,
        signature=data.signature,
    ):
        raise HTTPException(status_code=400, detail="Payment signature is invalid")
    gateway_payment = await razorpay.get_payment(data.gateway_payment_id)
    if (
        gateway_payment.get("order_id") != data.gateway_order_id
        or gateway_payment.get("amount") != payment.amount_paise
        or gateway_payment.get("currency") != "INR"
    ):
        raise HTTPException(status_code=400, detail="Payment details do not match this order")
    if gateway_payment.get("status") != "captured":
        raise HTTPException(status_code=409, detail="Payment is awaiting capture. Refresh your order status in a moment.")
    payment.gateway_payment_id = data.gateway_payment_id
    payment.status = PaymentStatus.PAID
    if order.status == OrderStatus.CANCELLED:
        await issue_razorpay_refund(order, payment)
    db.commit()
    return {"status": payment.status, "order_id": order.order_id}


@router.post("/razorpay/webhook")
async def razorpay_webhook(request: Request, db: DbSession, x_razorpay_signature: str = Header(default="")):
    body = await request.body()
    if not razorpay.verify_webhook_signature(body=body, signature=x_razorpay_signature):
        raise HTTPException(status_code=400, detail="Webhook signature is invalid")
    try:
        event = json.loads(body)
        if event.get("event") == "payment.captured":
            entity = event["payload"]["payment"]["entity"]
            gateway_order_id = entity["order_id"]
            payment = db.scalar(select(Payment).where(Payment.gateway_order_id == gateway_order_id))
            if payment:
                if entity.get("amount") != payment.amount_paise or entity.get("currency") != "INR":
                    raise HTTPException(status_code=400, detail="Captured amount does not match the order")
                payment.gateway_payment_id = entity["id"]
                order = db.get(Order, payment.order_id)
                if order:
                    if order.status == OrderStatus.CANCELLED and payment.status not in {PaymentStatus.REFUNDED, PaymentStatus.REFUND_PENDING}:
                        payment.status = PaymentStatus.PAID
                        await issue_razorpay_refund(order, payment)
                    else:
                        payment.status = PaymentStatus.PAID if payment.status not in {PaymentStatus.REFUNDED, PaymentStatus.REFUND_PENDING} else payment.status
                db.commit()
        elif event.get("event") in {"refund.processed", "refund.failed"}:
            refund = event["payload"]["refund"]["entity"]
            payment = db.scalar(select(Payment).where(Payment.gateway_payment_id == refund["payment_id"]))
            if payment and payment.status == PaymentStatus.REFUND_PENDING:
                payment.status = PaymentStatus.REFUNDED if event["event"] == "refund.processed" else PaymentStatus.PAID
                order = db.get(Order, payment.order_id)
                db.commit()
    except (KeyError, TypeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail="Webhook payload is invalid") from exc
    return {"received": True}
