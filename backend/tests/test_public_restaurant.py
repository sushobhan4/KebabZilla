import unittest
from fastapi.testclient import TestClient
from app.main import app
from app.cache import cache

class TestPublicRestaurantEndpoint(unittest.TestCase):
    def setUp(self):
        cache.clear()
        self.client = TestClient(app)

    def test_public_restaurant_schema_excludes_sensitive_keys(self):
        response = self.client.get("/api/v1/restaurant")
        self.assertEqual(response.status_code, 200)
        data = response.json()

        # Keys that SHOULD be present
        expected_keys = {
            "restaurant_name",
            "tagline",
            "phone",
            "email",
            "address",
            "latitude",
            "longitude",
            "is_restaurant_open",
            "is_delivery_open",
            "weekly_schedule",
        }
        for k in expected_keys:
            self.assertIn(k, data, f"Expected key '{k}' to be in public restaurant response")

        # Keys that MUST NOT be present
        forbidden_keys = [
            "google_client_id",
            "google_maps_api_key",
            "minimum_order_paise",
            "delivery_radius_km",
            "free_delivery_radius_km",
            "delivery_fee_per_km_paise",
            "accepting_orders",
            "order_cutoff_minutes_before_closing",
            "delivery_status",
            "delivery_status_heading",
            "delivery_status_message",
            "closing_in_minutes",
            "cutoff_in_minutes",
            "closing_time",
            "charge_from_zero_beyond_free_radius",
            "phones",  # only phone is shown, not both
        ]
        for k in forbidden_keys:
            self.assertNotIn(k, data, f"Forbidden key '{k}' must not be exposed in public restaurant response")

        # Verify only phone field is present, not both
        self.assertIn("phone", data)
        self.assertNotIn("phones", data)


if __name__ == "__main__":
    unittest.main()
