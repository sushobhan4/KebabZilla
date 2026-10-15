"""
Unit tests for KebabZilla ALNS route optimization and dispatch engine.
"""

import math
import unittest
from app.clustering import (
    haversine_distance_km,
    calculate_bearing,
    angular_difference,
    circular_mean_bearing,
    travel_time_minutes,
    RouteMatrix,
    build_fallback_route_matrix,
    solve_optimal_trip,
    solve_alns,
    optimize_fleet_trips,
)

RESTAURANT = {
    "lat": 22.369219,
    "lng": 88.271773,
    "name": "KebabZilla (Amtala Hub)",
}

SAMPLE_ORDERS = [
    {"id": "ORD-1", "name": "Stop 1", "lat": 22.375000, "lng": 88.280000},
    {"id": "ORD-2", "name": "Stop 2", "lat": 22.382000, "lng": 88.275000},
    {"id": "ORD-3", "name": "Stop 3", "lat": 22.365000, "lng": 88.290000},
]


class TestClusteringMath(unittest.TestCase):
    def test_haversine_distance(self):
        d = haversine_distance_km(22.369219, 88.271773, 22.380000, 88.290000)
        self.assertAlmostEqual(d, 2.2247, places=3)
        # Distance to same coordinate is 0.0
        self.assertEqual(haversine_distance_km(22.369219, 88.271773, 22.369219, 88.271773), 0.0)

    def test_calculate_bearing(self):
        b = calculate_bearing(0.0, 0.0, 1.0, 0.0)
        self.assertAlmostEqual(b, 0.0, places=1)  # Due North
        b_east = calculate_bearing(0.0, 0.0, 0.0, 1.0)
        self.assertAlmostEqual(b_east, 90.0, places=1)  # Due East

    def test_angular_difference(self):
        self.assertAlmostEqual(angular_difference(10.0, 350.0), 20.0, places=2)
        self.assertAlmostEqual(angular_difference(45.0, 90.0), 45.0, places=2)

    def test_circular_mean_bearing(self):
        # 10 deg and 350 deg average should be 0 deg (wrapping North)
        avg = circular_mean_bearing([10.0, 350.0])
        self.assertTrue(abs(avg) < 1e-4 or abs(avg - 360.0) < 1e-4)

    def test_travel_time(self):
        # At 30 km/h, 5 km takes 10 mins
        t = travel_time_minutes(5.0, 30.0)
        self.assertAlmostEqual(t, 10.0, places=2)


class TestRouteMatrix(unittest.TestCase):
    def test_matrix_lookup(self):
        nodes = [RESTAURANT, SAMPLE_ORDERS[0], SAMPLE_ORDERS[1]]
        distances = [
            [0.0, 1.85, 2.45],
            [1.95, 0.0, 1.30],
            [2.60, 1.35, 0.0],
        ]
        durations = [
            [0.0, 4.2, 5.5],
            [4.5, 0.0, 3.1],
            [5.8, 3.2, 0.0],
        ]
        matrix = RouteMatrix(nodes, distances, durations)

        self.assertEqual(matrix.get_distance(RESTAURANT, SAMPLE_ORDERS[0]), 1.85)
        self.assertEqual(matrix.get_duration(RESTAURANT, SAMPLE_ORDERS[0]), 4.2)
        # Asymmetric return
        self.assertEqual(matrix.get_distance(SAMPLE_ORDERS[0], RESTAURANT), 1.95)
        self.assertEqual(matrix.get_duration(SAMPLE_ORDERS[0], RESTAURANT), 4.5)


class TestTripOptimization(unittest.TestCase):
    def test_single_order_trip(self):
        trip = solve_optimal_trip(RESTAURANT, [SAMPLE_ORDERS[0]], speed_kmh=30.0, service_time_mins=3.0)
        self.assertEqual(len(trip["orderedStops"]), 1)
        self.assertGreater(trip["roundTripDistanceKm"], 0.0)
        self.assertGreater(trip["roundTripTimeMinutes"], 3.0)
        self.assertEqual(len(trip["legs"]), 2)
        self.assertEqual(trip["legs"][0]["type"], "OUTBOUND")
        self.assertEqual(trip["legs"][1]["type"], "RETURN")

    def test_multiple_orders_alns(self):
        res = solve_alns(
            RESTAURANT,
            SAMPLE_ORDERS,
            rider_count="AUTO",
            max_drivers=2,
            max_cluster_length=2,
            max_iterations=100,
        )
        self.assertGreater(len(res["trips"]), 0)
        for t in res["trips"]:
            # Strictly constrained by max_cluster_length
            self.assertLessEqual(len(t["orders"]), 2)
        self.assertGreater(res["totalDistanceKm"], 0.0)


if __name__ == "__main__":
    unittest.main()
