import time
import unittest
from unittest.mock import MagicMock, patch

from sqlalchemy import select

from app.campaign_dispatcher import CampaignDispatcher
from app.db import Base, SessionLocal, engine
import app.models
from app.models import Account, OfferLog, Role


class TestCampaignDispatcher(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        Base.metadata.create_all(bind=engine)
        with SessionLocal() as db:
            admin = db.scalars(select(Account).where(Account.role == Role.ADMIN)).first()
            if not admin:
                admin = Account(
                    name="Admin Test",
                    email="admin_test@kebabzilla.local",
                    phone="+919999999999",
                    password_hash="test",
                    role=Role.ADMIN,
                )
                db.add(admin)
                db.commit()

    def setUp(self):
        self.dispatcher = CampaignDispatcher(email_interval=0.01, batch_size=5)

    def test_campaign_dispatcher_email_simulation(self):
        """Verify that when SMTP is not configured or in dev, dispatcher processes and finishes campaign."""
        with SessionLocal() as db:
            admin = db.scalars(select(Account).where(Account.role == Role.ADMIN)).first()
            self.assertIsNotNone(admin)

            log = OfferLog(
                actor_id=admin.id,
                audience="ALL",
                channels=["EMAIL"],
                subject="Test Subject",
                message="Test Message",
                delivery_counts={"EMAIL": {"recipient_count": 3, "sent_count": 0}},
                status="QUEUED",
            )
            db.add(log)
            db.commit()
            db.refresh(log)
            log_id = log.id

        recipients = ["test1@kebabzilla.local", "test2@kebabzilla.local", "test3@kebabzilla.local"]

        with patch("app.campaign_dispatcher.settings.smtp_password", None):
            self.dispatcher.enqueue_email_campaign(
                log_id,
                recipients,
                subject="Test Flash Deal",
                message="Come try our delicious kebabs!",
                promo_code="TESTDEAL",
            )

            timeout = time.time() + 5.0
            final_status = "QUEUED"
            while time.time() < timeout:
                with SessionLocal() as db:
                    updated_log = db.get(OfferLog, log_id)
                    if updated_log and updated_log.status in ("SENT", "PARTIAL", "FAILED"):
                        final_status = updated_log.status
                        break
                time.sleep(0.05)

        self.assertEqual(final_status, "SENT")
        with SessionLocal() as db:
            updated_log = db.get(OfferLog, log_id)
            self.assertIsNotNone(updated_log)
            self.assertEqual(updated_log.delivery_counts["EMAIL"]["sent_count"], 3)
            db.delete(updated_log)
            db.commit()

    def test_campaign_dispatcher_with_mocked_smtp(self):
        """Verify SMTP sending loop with connection reuse and proper message delivery."""
        with SessionLocal() as db:
            admin = db.scalars(select(Account).where(Account.role == Role.ADMIN)).first()
            self.assertIsNotNone(admin)

            log = OfferLog(
                actor_id=admin.id,
                audience="ALL",
                channels=["EMAIL"],
                subject="Test SMTP Loop",
                message="Delicious discount inside",
                delivery_counts={"EMAIL": {"recipient_count": 2, "sent_count": 0}},
                status="QUEUED",
            )
            db.add(log)
            db.commit()
            db.refresh(log)
            log_id = log.id

        recipients = ["user1@kebabzilla.local", "user2@kebabzilla.local"]
        mock_smtp = MagicMock()

        with patch("app.campaign_dispatcher.settings.smtp_password", "fake-password"):
            with patch.object(self.dispatcher, "_create_smtp_connection", return_value=mock_smtp):
                self.dispatcher.enqueue_email_campaign(
                    log_id,
                    recipients,
                    subject="Test SMTP Loop",
                    message="Delicious discount inside",
                    promo_code="YUMMY",
                )

                timeout = time.time() + 5.0
                final_status = "QUEUED"
                while time.time() < timeout:
                    with SessionLocal() as db:
                        updated_log = db.get(OfferLog, log_id)
                        if updated_log and updated_log.status in ("SENT", "PARTIAL", "FAILED"):
                            final_status = updated_log.status
                            break
                    time.sleep(0.05)

        self.assertEqual(final_status, "SENT")
        self.assertEqual(mock_smtp.send_message.call_count, 1)
        args, kwargs = mock_smtp.send_message.call_args
        sent_msg = args[0]
        self.assertEqual(kwargs.get("to_addrs"), recipients)
        self.assertIn("user1@kebabzilla.local", sent_msg["Bcc"])
        self.assertIn("user2@kebabzilla.local", sent_msg["Bcc"])
        self.assertIn("KebabZilla Customers", sent_msg["To"])

        with SessionLocal() as db:
            updated_log = db.get(OfferLog, log_id)
            self.assertIsNotNone(updated_log)
            self.assertEqual(updated_log.delivery_counts["EMAIL"]["sent_count"], 2)
            db.delete(updated_log)
            db.commit()

    def test_campaign_dispatcher_sms_enqueue(self):
        """Verify SMS campaign enqueuing and placeholder hook."""
        with SessionLocal() as db:
            admin = db.scalars(select(Account).where(Account.role == Role.ADMIN)).first()
            self.assertIsNotNone(admin)

            log = OfferLog(
                actor_id=admin.id,
                audience="ALL",
                channels=["SMS"],
                subject="SMS Campaign",
                message="Get 10% off using SMS10",
                delivery_counts={"SMS": {"recipient_count": 2, "sent_count": 0}},
                status="QUEUED",
            )
            db.add(log)
            db.commit()
            db.refresh(log)
            log_id = log.id

        recipients = ["+919876543210", "+919876543211"]

        self.dispatcher.enqueue_sms_campaign(
            log_id,
            recipients,
            message="Get 10% off using SMS10",
            promo_code="SMS10",
        )

        timeout = time.time() + 3.0
        while time.time() < timeout:
            with SessionLocal() as db:
                updated_log = db.get(OfferLog, log_id)
                if updated_log and updated_log.status != "QUEUED":
                    break
            time.sleep(0.05)

        with SessionLocal() as db:
            updated_log = db.get(OfferLog, log_id)
            self.assertIsNotNone(updated_log)
            self.assertIn(updated_log.status, ("NOT_CONFIGURED", "SENT", "SENDING"))
            db.delete(updated_log)
            db.commit()


if __name__ == "__main__":
    unittest.main()
