import email.utils
import json
import logging
import queue
import smtplib
import threading
import time
from email.message import EmailMessage
from typing import Any, Callable

from app.config import settings
from app.db import SessionLocal
from app.email_templates import render_offer_email
from app.models import AdminEvent, OfferLog

logger = logging.getLogger("kebabzilla.campaign_dispatcher")

# BCC Batching Configuration:
# Groups recipients into BCC batches of 50 per email so Gmail Sent tab shows 1 message per 50 recipients
# instead of 1,000 separate emails. Customers only see their own address / "To: KebabZilla Customers".
DEFAULT_BCC_BATCH_SIZE = 50
# Paced interval between BCC batches (1.0s pause between batches of 50 recipients)
DEFAULT_BATCH_INTERVAL_SECONDS = 1.0


class CampaignDispatcher:
    """Asynchronous background campaign worker for high-volume delivery (1k - 10k recipients).

    Features:
    - Never blocks HTTP endpoints or UI screens
    - Delivers in privacy-safe BCC batches of 50 per email, preventing Gmail Sent tab clutter
    - Throttled pacing ("slowly slowly") between batches to respect SMTP provider limits
    - Pre-renders HTML/text templates once per campaign instead of 10,000 times
    - Incremental database progress commits so dashboards can show real-time progress
    - Extensible architecture ready for SMS dispatch
    """

    def __init__(
        self,
        bcc_batch_size: int = DEFAULT_BCC_BATCH_SIZE,
        batch_interval: float = DEFAULT_BATCH_INTERVAL_SECONDS,
        email_interval: float | None = None,
        batch_size: int | None = None,
    ):
        self.bcc_batch_size = bcc_batch_size or DEFAULT_BCC_BATCH_SIZE
        self.batch_interval = batch_interval if email_interval is None else email_interval
        self._queue: queue.Queue[dict[str, Any]] = queue.Queue()
        self._worker_thread: threading.Thread | None = None
        self._lock = threading.Lock()
        self._start_worker()

    def _start_worker(self) -> None:
        with self._lock:
            if self._worker_thread is None or not self._worker_thread.is_alive():
                self._worker_thread = threading.Thread(
                    target=self._worker_loop,
                    name="KebabZillaCampaignWorker",
                    daemon=True,
                )
                self._worker_thread.start()

    def enqueue_email_campaign(
        self,
        log_id: int,
        recipients: list[str],
        *,
        subject: str,
        message: str,
        headline: str | None = None,
        subheading: str | None = None,
        promo_code: str | None = None,
        discount_highlight: str | None = None,
        cta_text: str | None = None,
        cta_url: str | None = None,
        background_image_url: str | None = None,
        theme_color: str | None = None,
        background_opacity: float = 0.35,
        outer_blur: int = 70,
        invert_logo: bool = False,
    ) -> None:
        """Enqueue an email campaign for background dispatch."""
        self._start_worker()
        self._queue.put({
            "channel": "EMAIL",
            "log_id": log_id,
            "recipients": recipients,
            "payload": {
                "subject": subject,
                "message": message,
                "headline": headline,
                "subheading": subheading,
                "promo_code": promo_code,
                "discount_highlight": discount_highlight,
                "cta_text": cta_text,
                "cta_url": cta_url,
                "background_image_url": background_image_url,
                "theme_color": theme_color,
                "background_opacity": background_opacity,
                "outer_blur": outer_blur,
                "invert_logo": invert_logo,
            },
        })

    def enqueue_sms_campaign(
        self,
        log_id: int,
        recipients: list[str],
        *,
        message: str,
        promo_code: str | None = None,
    ) -> None:
        """Enqueue an SMS campaign for background dispatch (ready for future SMS integration)."""
        self._start_worker()
        self._queue.put({
            "channel": "SMS",
            "log_id": log_id,
            "recipients": recipients,
            "payload": {
                "message": message,
                "promo_code": promo_code,
            },
        })

    def _worker_loop(self) -> None:
        """Continuously pulls campaigns from the queue and processes them sequentially."""
        while True:
            try:
                task = self._queue.get()
                if task is None:
                    break

                channel = task.get("channel", "EMAIL")
                log_id = task.get("log_id")
                recipients = task.get("recipients", [])
                payload = task.get("payload", {})

                if channel == "EMAIL":
                    self._process_email_campaign(log_id, recipients, payload)
                elif channel == "SMS":
                    self._process_sms_campaign(log_id, recipients, payload)

                self._queue.task_done()
            except Exception as exc:
                logger.exception("Unexpected error in campaign dispatcher loop: %s", exc)
                time.sleep(1.0)

    def _create_smtp_connection(self) -> smtplib.SMTP | None:
        """Open and authenticate an SMTP connection."""
        if not settings.smtp_password:
            return None
        try:
            client = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=25)
            client.starttls()
            client.login(settings.smtp_username, settings.smtp_password)
            return client
        except Exception as exc:
            logger.error("Failed to connect to SMTP server: %s", exc)
            return None

    def _update_progress(self, log_id: int, channel: str, sent_count: int, total_recipients: int, final_status: str | None = None) -> None:
        """Persist current campaign progress into database."""
        try:
            with SessionLocal() as db:
                log = db.get(OfferLog, log_id)
                if not log:
                    return
                counts = json.loads(json.dumps(log.delivery_counts or {}))
                if channel not in counts or not isinstance(counts[channel], dict):
                    counts[channel] = {"recipient_count": total_recipients, "sent_count": sent_count}
                else:
                    counts[channel]["sent_count"] = sent_count
                    counts[channel]["recipient_count"] = total_recipients

                log.delivery_counts = counts
                from sqlalchemy.orm.attributes import flag_modified
                flag_modified(log, "delivery_counts")

                if final_status:
                    log.status = final_status
                elif log.status != "SENDING":
                    log.status = "SENDING"

                db.commit()
        except Exception as exc:
            logger.error("Failed to update OfferLog %s progress: %s", log_id, exc)

    def _process_email_campaign(self, log_id: int, recipients: list[str], payload: dict[str, Any]) -> None:
        valid_recipients = [r.strip() for r in recipients if r and "@" in r.strip()]
        total = len(valid_recipients)
        if total == 0:
            self._update_progress(log_id, "EMAIL", 0, 0, final_status="SENT")
            return

        subject = payload.get("subject", "A little something from KebabZilla")
        message_text = payload.get("message", "")
        promo_code = payload.get("promo_code")

        # 1. Pre-render HTML and plain text ONCE for the entire campaign
        plain_text = f"Hi,\n\n{message_text}\n\nKebabZilla"
        if promo_code:
            plain_text += f"\n\nUse Promo Code: {promo_code}"

        html_content = render_offer_email(
            subject=subject,
            message=message_text,
            headline=payload.get("headline"),
            subheading=payload.get("subheading"),
            promo_code=promo_code,
            discount_highlight=payload.get("discount_highlight"),
            cta_text=payload.get("cta_text"),
            cta_url=payload.get("cta_url"),
            background_image_url=payload.get("background_image_url"),
            theme_color=payload.get("theme_color"),
            background_opacity=payload.get("background_opacity", 0.35),
            outer_blur=payload.get("outer_blur", 70),
            invert_logo=payload.get("invert_logo", False),
        )

        # Mark campaign as SENDING
        self._update_progress(log_id, "EMAIL", 0, total, final_status="SENDING")

        # Chunk recipients into BCC batches (e.g. 50 recipients per email)
        batches = [
            valid_recipients[i:i + self.bcc_batch_size]
            for i in range(0, total, self.bcc_batch_size)
        ]

        # In local dev without SMTP configured, simulate paced batch sending
        if not settings.smtp_password:
            logger.info(
                "[DEV OFFER SIMULATION] Simulating campaign %s for %d recipients in %d BCC batch(es) of %d",
                log_id,
                total,
                len(batches),
                self.bcc_batch_size,
            )
            sent = 0
            for batch in batches:
                sent += len(batch)
                self._update_progress(log_id, "EMAIL", sent, total)
                time.sleep(0.05)  # fast simulation in dev
            self._update_progress(log_id, "EMAIL", sent, total, final_status="SENT")
            return

        client: smtplib.SMTP | None = self._create_smtp_connection()
        sent = 0

        try:
            for batch in batches:
                # Build BCC EmailMessage
                msg = EmailMessage()
                msg["Subject"] = subject
                msg["From"] = f"{settings.smtp_from_name} <{settings.smtp_from_email}>"
                msg["To"] = f"{settings.smtp_from_name} Customers <{settings.smtp_from_email}>"
                msg["Bcc"] = ", ".join(batch)
                msg["Date"] = email.utils.formatdate(localtime=True)
                msg["Message-ID"] = email.utils.make_msgid(domain="kebabzilla.in")
                msg.set_content(plain_text)
                msg.add_alternative(html_content, subtype="html")

                send_success = False
                try:
                    if client is not None:
                        client.send_message(msg, to_addrs=batch)
                        send_success = True
                    else:
                        client = self._create_smtp_connection()
                        if client is not None:
                            client.send_message(msg, to_addrs=batch)
                            send_success = True
                except (smtplib.SMTPException, OSError) as exc:
                    logger.warning("SMTP BCC batch send error (%d recipients): %s; reconnecting...", len(batch), exc)
                    try:
                        if client is not None:
                            client.close()
                    except Exception:
                        pass
                    client = self._create_smtp_connection()
                    if client is not None:
                        try:
                            client.send_message(msg, to_addrs=batch)
                            send_success = True
                        except Exception as retry_exc:
                            logger.error("Failed retry for BCC batch (%d recipients): %s", len(batch), retry_exc)

                if send_success:
                    sent += len(batch)

                # Update progress in DB after each BCC batch completes
                self._update_progress(log_id, "EMAIL", sent, total)

                # Throttle delay between BCC batches
                if self.batch_interval > 0:
                    time.sleep(self.batch_interval)

        finally:
            if client is not None:
                try:
                    client.quit()
                except Exception:
                    pass

        # Final status calculation
        if sent == total:
            final_status = "SENT"
        elif sent > 0:
            final_status = "PARTIAL"
        else:
            final_status = "FAILED"

        self._update_progress(log_id, "EMAIL", sent, total, final_status=final_status)
        logger.info("Campaign %s completed: %d/%d sent via BCC batches (status: %s)", log_id, sent, total, final_status)

        # Log system event
        try:
            with SessionLocal() as db:
                db.add(AdminEvent(
                    event_type="offer_dispatched",
                    message=f"Campaign #{log_id} dispatch completed: {sent}/{total} sent ({final_status})",
                    details={"log_id": log_id, "channel": "EMAIL", "sent": sent, "total": total, "status": final_status},
                ))
                db.commit()
        except Exception:
            pass

    def _process_sms_campaign(self, log_id: int, recipients: list[str], payload: dict[str, Any]) -> None:
        """Paced SMS campaign dispatch (structured identically for future SMS gateway integration)."""
        total = len(recipients)
        if total == 0:
            self._update_progress(log_id, "SMS", 0, 0, final_status="SENT")
            return

        self._update_progress(log_id, "SMS", 0, total, final_status="SENDING")
        logger.info("SMS campaign queued for %d recipients (SMS gateway integration hook)", total)
        # Placeholder for SMS gateway integration: will pace SMS delivery cleanly via same worker
        self._update_progress(log_id, "SMS", 0, total, final_status="NOT_CONFIGURED")


campaign_dispatcher = CampaignDispatcher()
