"""Provider seams for identity, payments, maps, and customer notifications."""

import hashlib
import hmac
import json

import httpx
from fastapi import HTTPException

from app.config import settings


class PaymentGateway:
    async def create_order(self, *, amount_paise: int, receipt: str) -> dict:
        raise NotImplementedError

    async def get_payment(self, payment_id: str) -> dict:
        raise NotImplementedError

    async def refund_payment(self, *, payment_id: str, amount_paise: int, receipt: str) -> dict:
        raise NotImplementedError

    def verify_checkout_signature(self, *, gateway_order_id: str, payment_id: str, signature: str) -> bool:
        raise NotImplementedError

    def verify_webhook_signature(self, *, body: bytes, signature: str) -> bool:
        raise NotImplementedError


class RazorpayGateway(PaymentGateway):
    async def create_order(self, *, amount_paise: int, receipt: str) -> dict:
        if not settings.razorpay_key_id or not settings.razorpay_key_secret:
            raise HTTPException(status_code=503, detail="Online payment is not configured. Choose cash or contact the restaurant.")
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                f"{settings.razorpay_api_base.rstrip('/')}/orders",
                auth=(settings.razorpay_key_id, settings.razorpay_key_secret),
                json={"amount": amount_paise, "currency": "INR", "receipt": receipt},
            )
        if response.is_error:
            raise HTTPException(status_code=502, detail="Payment provider could not create a checkout")
        return response.json()

    async def get_payment(self, payment_id: str) -> dict:
        if not settings.razorpay_key_id or not settings.razorpay_key_secret:
            raise HTTPException(status_code=503, detail="Online payment is not configured")
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(
                f"{settings.razorpay_api_base.rstrip('/')}/payments/{payment_id}",
                auth=(settings.razorpay_key_id, settings.razorpay_key_secret),
            )
        if response.is_error:
            raise HTTPException(status_code=502, detail="Payment provider could not confirm this payment")
        return response.json()

    async def refund_payment(self, *, payment_id: str, amount_paise: int, receipt: str) -> dict:
        if not settings.razorpay_key_id or not settings.razorpay_key_secret:
            raise HTTPException(status_code=503, detail="Online payment is not configured")
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                f"{settings.razorpay_api_base.rstrip('/')}/payments/{payment_id}/refund",
                auth=(settings.razorpay_key_id, settings.razorpay_key_secret),
                json={"amount": amount_paise, "receipt": receipt, "notes": {"reason": "KebabZilla order refund"}},
            )
        if response.is_error:
            raise HTTPException(status_code=502, detail="The payment provider could not start this refund")
        return response.json()

    def verify_checkout_signature(self, *, gateway_order_id: str, payment_id: str, signature: str) -> bool:
        secret = settings.razorpay_key_secret
        if not secret:
            return False
        expected = hmac.new(secret.encode(), f"{gateway_order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature)

    def verify_webhook_signature(self, *, body: bytes, signature: str) -> bool:
        secret = settings.razorpay_webhook_secret
        if not secret:
            return False
        expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature)


class IdentityProvider:
    """External identity verification boundary. Local password auth is used by default."""

    def verify_identity_token(self, token: str) -> dict:
        """Validate an Identity Platform ID token and return trusted identity claims.

        Implement using Firebase Admin SDK verification when Identity Platform is enabled.
        The verified subject must be linked to a database account; never accept a role claim.
        """
        raise NotImplementedError("Configure a Google Identity Platform verifier before enabling this provider")


class CustomerNotifier:
    """SMS/email delivery seam for order updates and delivery OTPs."""

    async def send_delivery_otp(self, *, phone: str | None, order_number: str, otp: str) -> None:
        # Provider-independent JSON contract; map it to the chosen transactional SMS service.
        if settings.environment == "development":
            return
        if not phone or not settings.delivery_otp_api_url or not settings.delivery_otp_api_token:
            raise HTTPException(status_code=503, detail="Delivery OTP messaging is not configured")
        async with httpx.AsyncClient(timeout=12) as client:
            response = await client.post(
                settings.delivery_otp_api_url,
                headers={"Authorization": f"Bearer {settings.delivery_otp_api_token}"},
                json={
                    "to": phone,
                    "sender": settings.delivery_otp_sender,
                    "message": f"Your KebabZilla delivery code for {order_number} is {otp}. Share it with your delivery partner to confirm delivery.",
                },
            )
        if response.is_error:
            raise HTTPException(status_code=502, detail="The delivery code could not be sent. Please retry dispatch.")


razorpay = RazorpayGateway()
customer_notifier = CustomerNotifier()
