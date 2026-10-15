"""
Unit tests for delivery fee calculations and dynamic delivery speed recalibration.
"""

from datetime import datetime, timezone, timedelta
import unittest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import Base, RestaurantSettings, Order, OrderStatus
from app.services import _delivery_fee_paise, recalculate_and_update_delivery_speed


class TestDeliveryFeeCalculations(unittest.TestCase):
    def setUp(self):
        self.settings = RestaurantSettings(
            id=1,
            latitude=22.369219,
            longitude=88.271773,
            delivery_radius_km=10.0,
            free_delivery_radius_km=1.0,
            delivery_fee_per_km_paise=1000,  # 10 INR per km
            distance_calculation_mode="HAVERSINE",
            haversine_routing_factor=1.0,
            charge_from_zero_beyond_free_radius=False,
            average_delivery_speed_kmh=30.0,
        )

    def test_fee_within_free_radius(self):
        # Coordinates very close (~0.2 km away)
        lat = 22.370000
        lng = 88.272000
        self.settings.charge_from_zero_beyond_free_radius = False
        fee_false = _delivery_fee_paise(self.settings, lat, lng)
        self.assertEqual(fee_false, 0)

        self.settings.charge_from_zero_beyond_free_radius = True
        fee_true = _delivery_fee_paise(self.settings, lat, lng)
        self.assertEqual(fee_true, 0)

    def test_fee_beyond_free_radius_incremental(self):
        # ~2.22 km away
        lat = 22.380000
        lng = 88.290000
        self.settings.charge_from_zero_beyond_free_radius = False
        fee = _delivery_fee_paise(self.settings, lat, lng)
        # distance ~ 2.22 km, excess ~ 1.22 km @ ₹10/km => ceil(12.2) = ₹13 => 1300 paise
        self.assertGreater(fee, 0)
        self.assertLess(fee, 2000)

    def test_fee_beyond_free_radius_charge_from_zero(self):
        # ~2.22 km away
        lat = 22.380000
        lng = 88.290000
        self.settings.charge_from_zero_beyond_free_radius = True
        fee = _delivery_fee_paise(self.settings, lat, lng)
        # distance ~ 2.22 km @ ₹10/km from zero => ceil(22.2) = ₹23 => 2300 paise
        self.assertGreater(fee, 2000)


class TestDeliverySpeedRecalibration(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()

        self.settings = RestaurantSettings(
            id=1,
            latitude=22.369219,
            longitude=88.271773,
            delivery_radius_km=10.0,
            free_delivery_radius_km=1.0,
            delivery_fee_per_km_paise=1000,
            average_delivery_speed_kmh=30.0,
        )
        self.db.add(self.settings)
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_recalculate_delivery_speed_updates_settings(self):
        now = datetime.now(timezone.utc)
        # Order 1: ~2.22 km away, took 5 minutes (300 seconds) -> speed = 2.22 / (5/60) = 26.64 km/h
        o1 = Order(
            order_id="KZ-1001",
            status=OrderStatus.DELIVERED,
            address="Near test point",
            latitude=22.380000,
            longitude=88.290000,
            delivery_started_at=now - timedelta(minutes=15),
            delivered_at=now - timedelta(minutes=10),
            delivery_fee_paise=2000,
        )
        self.db.add(o1)
        self.db.commit()

        new_speed = recalculate_and_update_delivery_speed(self.db)
        self.assertIsNotNone(new_speed)
        self.db.commit()
        self.db.refresh(self.settings)
        self.assertAlmostEqual(self.settings.average_delivery_speed_kmh, new_speed, places=1)
        self.assertGreater(new_speed, 10.0)
        self.assertLess(new_speed, 50.0)


if __name__ == "__main__":
    unittest.main()
