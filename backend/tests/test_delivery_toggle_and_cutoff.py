import unittest
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo
from fastapi import HTTPException

from app.models import RestaurantSettings
from app.services import (
    evaluate_restaurant_and_delivery_status,
    get_current_closing_time,
    is_restaurant_open,
)
from app.config import settings


class TestDeliveryToggleAndCutoff(unittest.TestCase):
    def setUp(self):
        self.tz = ZoneInfo(settings.business_timezone)
        # Create a sample settings object with 10:00 to 22:00 schedule
        self.config = RestaurantSettings(
            id=1,
            restaurant_name="KebabZilla",
            accepting_orders=True,
            is_delivery_open=True,
            order_cutoff_minutes_before_closing=30,
            weekly_schedule={
                "custom_schedules": [
                    {
                        "id": "sched_1",
                        "start_time": "10:00",
                        "end_time": "22:00",
                        "days": ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
                    }
                ]
            },
        )

    def test_both_toggled_on_normal_hours(self):
        # 14:00 (2:00 PM) - well within open hours
        local_dt = datetime.combine(datetime.now(self.tz).date(), time(14, 0), tzinfo=self.tz)
        utc_dt = local_dt.astimezone(timezone.utc)

        status = evaluate_restaurant_and_delivery_status(self.config, utc_dt)
        self.assertTrue(status["is_restaurant_open"])
        self.assertTrue(status["is_delivery_open"])
        self.assertEqual(status["delivery_status"], "OPEN")
        self.assertEqual(status["delivery_status_heading"], "Menu")
        self.assertEqual(status["delivery_status_message"], "Choose what you’d like to order.")

    def test_delivery_toggled_off_while_restaurant_open(self):
        # Admin turns off online delivery
        self.config.is_delivery_open = False
        local_dt = datetime.combine(datetime.now(self.tz).date(), time(14, 0), tzinfo=self.tz)
        utc_dt = local_dt.astimezone(timezone.utc)

        status = evaluate_restaurant_and_delivery_status(self.config, utc_dt)
        self.assertTrue(status["is_restaurant_open"])
        self.assertFalse(status["is_delivery_open"])
        self.assertEqual(status["delivery_status"], "DELIVERY_PAUSED")
        self.assertEqual(status["delivery_status_heading"], "Currently not delivering")
        self.assertIn("walk-in orders", status["delivery_status_message"].lower())

    def test_approaching_closing_warning_window(self):
        # Shop closes at 22:00 (10:00 PM). Cutoff is 30 mins (21:30).
        # Warning starts 30 mins before cutoff -> 21:00 (9:00 PM).
        # At 21:15 (9:15 PM): within warning window! (45 mins until close)
        local_dt = datetime.combine(datetime.now(self.tz).date(), time(21, 15), tzinfo=self.tz)
        utc_dt = local_dt.astimezone(timezone.utc)

        status = evaluate_restaurant_and_delivery_status(self.config, utc_dt)
        self.assertTrue(status["is_restaurant_open"])
        self.assertTrue(status["is_delivery_open"])
        self.assertEqual(status["delivery_status"], "CLOSING_SOON")
        self.assertEqual(status["delivery_status_heading"], "Hurry up closing soon")
        self.assertEqual(status["delivery_status_message"], "The restaurant is closing in 15 minutes.")
        self.assertEqual(status["cutoff_in_minutes"], 15)
        self.assertEqual(status["closing_in_minutes"], 45)

    def test_past_cutoff_time(self):
        # At 21:35 (9:35 PM): past 21:30 cutoff, but before 22:00 closing!
        local_dt = datetime.combine(datetime.now(self.tz).date(), time(21, 35), tzinfo=self.tz)
        utc_dt = local_dt.astimezone(timezone.utc)

        status = evaluate_restaurant_and_delivery_status(self.config, utc_dt)
        self.assertTrue(status["is_restaurant_open"])
        self.assertFalse(status["is_delivery_open"])
        self.assertEqual(status["delivery_status"], "DELIVERY_CUTOFF")
        self.assertEqual(status["delivery_status_heading"], "Currently not delivering")
        self.assertIn("walk-in orders", status["delivery_status_message"].lower())
        self.assertIn("closing in 25 minutes", status["delivery_status_message"].lower())
        self.assertEqual(status["closing_in_minutes"], 25)

    def test_restaurant_closed(self):
        # At 22:30 (10:30 PM): restaurant closed!
        local_dt = datetime.combine(datetime.now(self.tz).date(), time(22, 30), tzinfo=self.tz)
        utc_dt = local_dt.astimezone(timezone.utc)

        status = evaluate_restaurant_and_delivery_status(self.config, utc_dt)
        self.assertFalse(status["is_restaurant_open"])
        self.assertFalse(status["is_delivery_open"])
        self.assertEqual(status["delivery_status"], "RESTAURANT_CLOSED")
        self.assertEqual(status["delivery_status_heading"], "Sorry, we are closed")
        self.assertIn("shop is currently closed", status["delivery_status_message"].lower())

    def test_admin_pause_override(self):
        # Admin explicitly pauses restaurant (override_state=False)
        self.config.admin_override_state = False
        self.config.admin_override_until = datetime.now(timezone.utc) + timedelta(hours=2)
        local_dt = datetime.combine(datetime.now(self.tz).date(), time(14, 0), tzinfo=self.tz)
        utc_dt = local_dt.astimezone(timezone.utc)

        status = evaluate_restaurant_and_delivery_status(self.config, utc_dt)
        self.assertFalse(status["is_restaurant_open"])
        self.assertFalse(status["is_delivery_open"])
        self.assertEqual(status["delivery_status"], "RESTAURANT_CLOSED")
        self.assertEqual(status["delivery_status_heading"], "Sorry, we are closed")


if __name__ == "__main__":
    unittest.main()
