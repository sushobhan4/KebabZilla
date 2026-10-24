import base64
from email.message import EmailMessage
import json
import logging
from typing import Any

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials as UserCredentials
from google.oauth2.service_account import Credentials as ServiceAccountCredentials
import httpx

from app.config import settings

logger = logging.getLogger(__name__)

GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send"
GMAIL_API_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"


class GmailAPISender:
    """Sends emails via the official Gmail REST API using OAuth2 refresh token or Service Account."""

    def __init__(self) -> None:
        self._credentials: Any = None

    def is_configured(self) -> bool:
        if settings.gmail_refresh_token:
            return bool(settings.gmail_client_id and settings.gmail_client_secret)
        if settings.gmail_service_account_json or settings.gmail_service_account_file:
            return True
        return False

    def get_credentials(self) -> Any:
        # 1. OAuth2 User Refresh Token
        if settings.gmail_refresh_token:
            if self._credentials is None or not getattr(self._credentials, "valid", False):
                client_id = settings.gmail_client_id or settings.google_client_id
                client_secret = settings.gmail_client_secret or settings.google_client_secret
                if not client_id or not client_secret:
                    raise ValueError("Gmail API requires gmail_client_id and gmail_client_secret (or google_client_id/google_client_secret)")
                creds = UserCredentials(
                    None,
                    refresh_token=settings.gmail_refresh_token,
                    token_uri="https://oauth2.googleapis.com/token",
                    client_id=client_id,
                    client_secret=client_secret,
                    scopes=[GMAIL_SEND_SCOPE],
                )
                creds.refresh(Request())
                self._credentials = creds
            elif self._credentials.expired:
                self._credentials.refresh(Request())
            return self._credentials

        # 2. Service Account with Domain-Wide Delegation
        if settings.gmail_service_account_json or settings.gmail_service_account_file:
            delegated_user = settings.gmail_delegated_user or settings.email_from_address
            if self._credentials is None or not getattr(self._credentials, "valid", False):
                if settings.gmail_service_account_json:
                    info = json.loads(settings.gmail_service_account_json)
                    creds = ServiceAccountCredentials.from_service_account_info(
                        info,
                        scopes=[GMAIL_SEND_SCOPE],
                    )
                else:
                    creds = ServiceAccountCredentials.from_service_account_file(
                        settings.gmail_service_account_file,  # type: ignore[arg-type]
                        scopes=[GMAIL_SEND_SCOPE],
                    )
                if delegated_user:
                    creds = creds.with_subject(delegated_user)
                creds.refresh(Request())
                self._credentials = creds
            elif self._credentials.expired:
                self._credentials.refresh(Request())
            return self._credentials

        return None

    def send_message(self, message: EmailMessage) -> bool:
        try:
            creds = self.get_credentials()
            if not creds:
                raise ValueError("Gmail API credentials are not configured")
            if not creds.valid:
                creds.refresh(Request())

            raw_bytes = message.as_bytes()
            encoded_raw = base64.urlsafe_b64encode(raw_bytes).decode("ascii")

            headers = {
                "Authorization": f"Bearer {creds.token}",
                "Content-Type": "application/json",
            }
            with httpx.Client(timeout=25.0) as client:
                response = client.post(
                    GMAIL_API_URL,
                    headers=headers,
                    json={"raw": encoded_raw},
                )
                if response.status_code >= 400:
                    logger.error("Gmail API send error %d: %s", response.status_code, response.text)
                    return False
                logger.info("Email sent successfully via Gmail API (Message ID: %s)", response.json().get("id"))
                return True
        except Exception as exc:
            logger.error("Gmail API email dispatch failed: %s", exc)
            return False


class UnifiedEmailSender:
    """Unified email dispatcher using Gmail REST API with development simulation fallback."""

    def __init__(self) -> None:
        self.gmail = GmailAPISender()

    def active_backend(self) -> str:
        return "gmail_api" if self.gmail.is_configured() else "none"

    def is_configured(self) -> bool:
        return self.gmail.is_configured()

    def send_message(self, message: EmailMessage, to_addrs: list[str] | None = None) -> bool:
        if self.is_configured():
            return self.gmail.send_message(message)
        else:
            recipient = to_addrs or message.get("To") or message.get("Bcc")
            logger.info("[DEV EMAIL SIMULATION] To: %s | Subject: %s", recipient, message.get("Subject"))
            return False

    def send_bcc_batch(self, message: EmailMessage, bcc_recipients: list[str]) -> bool:
        if self.is_configured():
            return self.gmail.send_message(message)
        else:
            logger.info("[DEV EMAIL SIMULATION] BCC batch (%d recipients) | Subject: %s", len(bcc_recipients), message.get("Subject"))
            return False


email_sender = UnifiedEmailSender()
