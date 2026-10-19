"""Provider seams for identity, payments, maps, and customer notifications."""

import hashlib
import hmac
import json
import smtplib
from email.message import EmailMessage

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


from app.email_templates import (
    render_account_created_email,
    render_offer_email,
    render_otp_email,
    render_temporary_password_email,
)


class CustomerNotifier:
    """SMS/email delivery seam for order updates and delivery OTPs."""

    async def send_delivery_otp(
        self,
        *,
        phone: str | None,
        order_number: str,
        otp: str,
        email: str | None = None,
        customer_name: str | None = None,
    ) -> None:
        # If email is provided and SMTP is configured, send the fancy HTML delivery OTP email
        if email and settings.smtp_password:
            try:
                message = EmailMessage()
                message["Subject"] = f"Your KebabZilla Delivery Code for Order #{order_number}"
                message["From"] = f"{settings.smtp_from_name} <{settings.smtp_from_email}>"
                message["To"] = email
                plain_text = (
                    f"Hi {customer_name or 'there'},\n\n"
                    f"Your KebabZilla delivery code for order {order_number} is: {otp}\n\n"
                    "Share this code with your delivery partner to confirm delivery.\n\n"
                    "KebabZilla"
                )
                html_content = render_otp_email(
                    otp=otp,
                    name=customer_name or "there",
                    purpose="delivery_otp",
                    expiry_minutes=60,
                    email=email,
                )
                message.set_content(plain_text)
                message.add_alternative(html_content, subtype="html")
                with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as client:
                    client.starttls()
                    client.login(settings.smtp_username, settings.smtp_password)
                    client.send_message(message)
            except Exception as exc:
                print(f"[CustomerNotifier] Delivery OTP email failed: {exc}")

        # SMS delivery
        if settings.environment == "development":
            return
        if not phone or not settings.delivery_otp_api_url or not settings.delivery_otp_api_token:
            return
        try:
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
                print(f"[CustomerNotifier] Delivery OTP SMS upstream error: {response.status_code}")
        except Exception as exc:
            print(f"[CustomerNotifier] Delivery OTP SMS dispatch failed: {exc}")


class StaffAccountNotifier:
    """Sends first-login credentials, OTPs, invites and marketing offers with rich HTML/CSS/JS emails."""

    def send_account_created_notice(self, *, name: str, email: str, role: str) -> str:
        if not settings.smtp_password:
            return "NOT_CONFIGURED"
        message = EmailMessage()
        message["Subject"] = "Your KebabZilla account has been created"
        message["From"] = f"{settings.smtp_from_name} <{settings.smtp_from_email}>"
        message["To"] = email
        plain_text = (
            f"Hi {name},\n\n"
            f"Your KebabZilla {role.lower()} account has been created.\n\n"
            f"Email: {email}\n\n"
            f"To access your account, please visit the sign-in page and click 'Forgot password?' to set your password. You will receive an OTP code to verify your identity and choose your new password.\n\n"
            f"You can also sign in directly using Google if your email matches.\n\n"
            f"If you have any questions or were not expecting this email, please contact your administrator.\n\n"
            f"Warm regards,\nThe KebabZilla Team"
        )
        html_content = render_account_created_email(
            name=name,
            email=email,
            role=role,
        )
        message.set_content(plain_text)
        message.add_alternative(html_content, subtype="html")
        try:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as client:
                client.starttls()
                client.login(settings.smtp_username, settings.smtp_password)
                client.send_message(message)
        except (OSError, smtplib.SMTPException):
            return "EMAIL_FAILED"
        return "EMAIL_SENT"

    def send_staff_invite(self, *, name: str, email: str, role: str, invite_url: str = "", duration_str: str = "30 minutes") -> str:
        return self.send_account_created_notice(name=name, email=email, role=role)

    def send_temporary_password(self, *, name: str, email: str, role: str, temporary_password: str) -> str:
        if not settings.smtp_password:
            return "NOT_CONFIGURED"
        message = EmailMessage()
        message["Subject"] = "Your KebabZilla account is ready"
        message["From"] = f"{settings.smtp_from_name} <{settings.smtp_from_email}>"
        message["To"] = email
        plain_text = (
            f"Hi {name},\n\n"
            f"Your KebabZilla {role.lower()} account has been created.\n\n"
            f"Email: {email}\n"
            f"Temporary password: {temporary_password}\n\n"
            "Sign in and change this temporary password immediately. You will not be able to access the workspace until it is changed.\n\n"
            "If you were not expecting this email, please contact KebabZilla support."
        )
        html_content = render_temporary_password_email(
            name=name,
            email=email,
            role=role,
            temporary_password=temporary_password,
        )
        message.set_content(plain_text)
        message.add_alternative(html_content, subtype="html")
        try:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as client:
                client.starttls()
                client.login(settings.smtp_username, settings.smtp_password)
                client.send_message(message)
        except (OSError, smtplib.SMTPException):
            return "EMAIL_FAILED"
        return "EMAIL_SENT"

    def send_offer(
        self,
        *,
        recipient: str,
        subject: str,
        message_text: str,
        headline: str | None = None,
        subheading: str | None = None,
        promo_code: str | None = None,
        discount_highlight: str | None = None,
        cta_text: str | None = None,
        cta_url: str | None = None,
        background_image_url: str | None = None,
        theme_color: str | None = None,
    ) -> bool:
        """Send one customer offer with customizable rich HTML/CSS template."""
        if not settings.smtp_password:
            return False
        message = EmailMessage()
        message["Subject"] = subject
        message["From"] = f"{settings.smtp_from_name} <{settings.smtp_from_email}>"
        message["To"] = recipient

        plain_text = f"Hi,\n\n{message_text}\n\nKebabZilla"
        if promo_code:
            plain_text += f"\n\nUse Promo Code: {promo_code}"

        html_content = render_offer_email(
            subject=subject,
            message=message_text,
            headline=headline,
            subheading=subheading,
            promo_code=promo_code,
            discount_highlight=discount_highlight,
            cta_text=cta_text,
            cta_url=cta_url,
            background_image_url=background_image_url,
            theme_color=theme_color,
        )
        message.set_content(plain_text)
        message.add_alternative(html_content, subtype="html")
        try:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as client:
                client.starttls()
                client.login(settings.smtp_username, settings.smtp_password)
                client.send_message(message)
        except (OSError, smtplib.SMTPException):
            return False
        return True

    def send_password_reset_otp(self, *, name: str, email: str, otp: str) -> bool:
        if not settings.smtp_password:
            print(f"[SECURITY PASSWORD RESET OTP] Code for {email}: {otp}")
            return False
        message = EmailMessage()
        message["Subject"] = "Your KebabZilla password reset code"
        message["From"] = f"{settings.smtp_from_name} <{settings.smtp_from_email}>"
        message["To"] = email

        plain_text = (
            f"Hi {name},\n\n"
            f"Your KebabZilla password reset code is: {otp}\n\n"
            "This code expires in 10 minutes and can be used only once. "
            "If you did not request a password reset, you can safely ignore this email.\n\n"
            "KebabZilla"
        )
        html_content = render_otp_email(
            otp=otp,
            name=name,
            purpose="password_reset",
            expiry_minutes=10,
            email=email,
        )
        message.set_content(plain_text)
        message.add_alternative(html_content, subtype="html")
        try:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as client:
                client.starttls()
                client.login(settings.smtp_username, settings.smtp_password)
                client.send_message(message)
        except (OSError, smtplib.SMTPException):
            return False
        return True

    def send_2fa_code(self, *, name: str, email: str, code: str) -> bool:
        if not settings.smtp_password:
            # In local development without SMTP, print code to server logs for convenience
            print(f"[SECURITY 2FA CODE] Staff 2-Step verification code for {email}: {code}")
            return False
        message = EmailMessage()
        message["Subject"] = "Your KebabZilla 2-Step Verification Code"
        message["From"] = f"{settings.smtp_from_name} <{settings.smtp_from_email}>"
        message["To"] = email

        plain_text = (
            f"Hi {name},\n\n"
            f"Your KebabZilla 2-Step Verification Code is: {code}\n\n"
            "This code is required to access the staff workspace and expires in 10 minutes. "
            "Do not share this code with anyone.\n\n"
            "KebabZilla Security"
        )
        html_content = render_otp_email(
            otp=code,
            name=name,
            purpose="staff_2fa",
            expiry_minutes=10,
            email=email,
        )
        message.set_content(plain_text)
        message.add_alternative(html_content, subtype="html")
        try:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as client:
                client.starttls()
                client.login(settings.smtp_username, settings.smtp_password)
                client.send_message(message)
        except (OSError, smtplib.SMTPException):
            return False
        return True

    def send_email_verification_otp(self, *, email: str, otp: str, purpose: str = "register") -> bool:
        if not settings.smtp_password:
            print(f"[EMAIL VERIFICATION OTP] Verification code for {email} ({purpose}): {otp}")
            return False
        message = EmailMessage()
        message["Subject"] = "Your KebabZilla Email Verification Code"
        message["From"] = f"{settings.smtp_from_name} <{settings.smtp_from_email}>"
        message["To"] = email

        plain_text = (
            f"Hi,\n\n"
            f"Your KebabZilla email verification code is: {otp}\n\n"
            "This code expires in 10 minutes and is required to verify your email address. "
            "Do not share this code with anyone.\n\n"
            "Warm regards,\nThe KebabZilla Team"
        )
        html_content = render_otp_email(
            otp=otp,
            name="there",
            purpose="email_verification",
            expiry_minutes=10,
            email=email,
        )
        message.set_content(plain_text)
        message.add_alternative(html_content, subtype="html")
        try:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as client:
                client.starttls()
                client.login(settings.smtp_username, settings.smtp_password)
                client.send_message(message)
        except (OSError, smtplib.SMTPException):
            return False
        return True


razorpay = RazorpayGateway()
customer_notifier = CustomerNotifier()
staff_account_notifier = StaffAccountNotifier()
