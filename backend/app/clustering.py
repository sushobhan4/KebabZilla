"""
KebabZilla Fleet Dispatch & ALNS Route Optimization Engine
Direct Python implementation of clusteringNew.js.
Supports:
- Haversine & Google Routes Road Matrix
- SLA-aware Multi-Trip Vehicle Routing
- Adaptive Large Neighborhood Search (ALNS)
- Max Drivers & Max Cluster Length constraints
"""

import math
import random
from typing import Any, Dict, List, Optional, Tuple

EARTH_RADIUS_KM = 6371.0
DEFAULT_ROUTING_FACTOR = 1.3627
DEFAULT_SPEED_KMH = 30.0          # Urban 2-wheeler average speed (km/h)
DEFAULT_SERVICE_TIME_MINS = 3.0   # Delivery handoff / customer wait time (mins per stop)
DEFAULT_MAX_DRIVERS = 5           # Default maximum drivers limit
DEFAULT_MAX_CLUSTER_LENGTH = 5    # Default maximum stops per rider trip
CUSTOMER_SLA_MINS = 36.0          # Target max customer wait time (mins)
DRIVER_TRIP_SLA_MINS = 45.0       # Target max driver round-trip time (mins)


def haversine_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Exact Haversine great-circle distance between two GPS coordinates in kilometers."""
    if lat1 == lat2 and lon1 == lon2:
        return 0.0
    lat_a = math.radians(lat1)
    lat_b = math.radians(lat2)
    delta_lat = math.radians(lat2 - lat1)
    delta_lon = math.radians(lon2 - lon1)

    haversine = (
        math.sin(delta_lat / 2.0) ** 2
        + math.cos(lat_a) * math.cos(lat_b) * math.sin(delta_lon / 2.0) ** 2
    )
    clamped = min(1.0, max(0.0, haversine))
    return EARTH_RADIUS_KM * 2.0 * math.atan2(math.sqrt(clamped), math.sqrt(1.0 - clamped))


def calculate_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculates geographic bearing in degrees from point 1 to point 2 (0 to 360)."""
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_lambda = math.radians(lon2 - lon1)

    y = math.sin(delta_lambda) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(delta_lambda)

    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def angular_difference(theta_a: float, theta_b: float) -> float:
    """Circular angular difference between two bearings (0 to 180)."""
    diff = abs(theta_a - theta_b)
    return min(diff, 360.0 - diff)


def circular_mean_bearing(bearings: list[float]) -> float:
    """True circular mean of an array of bearings in degrees (0 to 360)."""
    if not bearings:
        return 0.0
    sin_sum = sum(math.sin(math.radians(b)) for b in bearings)
    cos_sum = sum(math.cos(math.radians(b)) for b in bearings)
    return (math.degrees(math.atan2(sin_sum, cos_sum)) + 360.0) % 360.0


def travel_time_minutes(distance_km: float, speed_kmh: float = DEFAULT_SPEED_KMH) -> float:
    """Calculates 2-wheeler travel time in minutes for a given road distance."""
    safe_speed = speed_kmh if speed_kmh > 0 else 30.0
    return (distance_km / safe_speed) * 60.0


class RouteMatrix:
    """
    RouteMatrix: Encapsulates Road Distance and Duration Matrix.
    Supports O(1) lookup with safe Haversine fallback.
    """

    def __init__(
        self,
        nodes: Optional[List[Any]] = None,
        distances: Optional[List[List[float]]] = None,
        durations: Optional[List[List[float]]] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ):
        self.nodes = nodes or []
        self.distances = distances or []
        self.durations = durations or []
        self.metadata = metadata or {}
        self.source = self.metadata.get("source", "UNKNOWN")
        self.travel_mode = self.metadata.get("travelMode", "TWO_WHEELER")

        self._index_map: Dict[str, int] = {}
        for idx, n in enumerate(self.nodes):
            lat = getattr(n, "lat", None) if hasattr(n, "lat") else (n.get("lat") if isinstance(n, dict) else None)
            lng = getattr(n, "lng", None) if hasattr(n, "lng") else (n.get("lng") if isinstance(n, dict) else None)
            nid = getattr(n, "id", None) if hasattr(n, "id") else (n.get("id") if isinstance(n, dict) else None)

            if lat is not None and lng is not None:
                coord_key = f"{float(lat):.6f},{float(lng):.6f}"
                self._index_map[coord_key] = idx
                if nid is not None:
                    self._index_map[f"id:{nid}"] = idx

    def find_index(self, node: Any) -> int:
        if isinstance(node, int):
            return node
        if node is None:
            return -1

        nid = getattr(node, "id", None) if hasattr(node, "id") else (node.get("id") if isinstance(node, dict) else None)
        if nid is not None and f"id:{nid}" in self._index_map:
            return self._index_map[f"id:{nid}"]

        lat = getattr(node, "lat", None) if hasattr(node, "lat") else (node.get("lat") if isinstance(node, dict) else None)
        lng = getattr(node, "lng", None) if hasattr(node, "lng") else (node.get("lng") if isinstance(node, dict) else None)
        if lat is not None and lng is not None:
            coord_key = f"{float(lat):.6f},{float(lng):.6f}"
            if coord_key in self._index_map:
                return self._index_map[coord_key]
            for idx, n in enumerate(self.nodes):
                n_lat = getattr(n, "lat", None) if hasattr(n, "lat") else (n.get("lat") if isinstance(n, dict) else None)
                n_lng = getattr(n, "lng", None) if hasattr(n, "lng") else (n.get("lng") if isinstance(n, dict) else None)
                if n_lat is not None and n_lng is not None:
                    if abs(float(n_lat) - float(lat)) < 0.0001 and abs(float(n_lng) - float(lng)) < 0.0001:
                        return idx
        return -1

    def get_distance(self, from_node: Any, to_node: Any, fallback_factor: float = DEFAULT_ROUTING_FACTOR) -> float:
        idx_a = self.find_index(from_node)
        idx_b = self.find_index(to_node)
        if (
            idx_a >= 0
            and idx_b >= 0
            and idx_a < len(self.distances)
            and idx_b < len(self.distances[idx_a])
            and self.distances[idx_a][idx_b] is not None
        ):
            return self.distances[idx_a][idx_b]

        lat_a = getattr(from_node, "lat", None) if hasattr(from_node, "lat") else (from_node.get("lat") if isinstance(from_node, dict) else None)
        lng_a = getattr(from_node, "lng", None) if hasattr(from_node, "lng") else (from_node.get("lng") if isinstance(from_node, dict) else None)
        lat_b = getattr(to_node, "lat", None) if hasattr(to_node, "lat") else (to_node.get("lat") if isinstance(to_node, dict) else None)
        lng_b = getattr(to_node, "lng", None) if hasattr(to_node, "lng") else (to_node.get("lng") if isinstance(to_node, dict) else None)

        if lat_a is not None and lng_a is not None and lat_b is not None and lng_b is not None:
            return round(haversine_distance_km(float(lat_a), float(lng_a), float(lat_b), float(lng_b)) * fallback_factor, 3)
        return 0.0

    def get_duration(
        self,
        from_node: Any,
        to_node: Any,
        speed_kmh: float = DEFAULT_SPEED_KMH,
        fallback_factor: float = DEFAULT_ROUTING_FACTOR,
    ) -> float:
        idx_a = self.find_index(from_node)
        idx_b = self.find_index(to_node)
        if (
            idx_a >= 0
            and idx_b >= 0
            and idx_a < len(self.durations)
            and idx_b < len(self.durations[idx_a])
            and self.durations[idx_a][idx_b] is not None
        ):
            return self.durations[idx_a][idx_b]

        dist = self.get_distance(from_node, to_node, fallback_factor)
        return round(travel_time_minutes(dist, speed_kmh), 2)


def build_fallback_route_matrix(
    nodes: List[Any],
    speed_kmh: float = DEFAULT_SPEED_KMH,
    factor: float = DEFAULT_ROUTING_FACTOR,
) -> RouteMatrix:
    """Builds a local fallback RouteMatrix using Haversine distance * routing factor."""
    n = len(nodes)
    distances: List[List[float]] = [[0.0] * n for _ in range(n)]
    durations: List[List[float]] = [[0.0] * n for _ in range(n)]

    for i in range(n):
        lat_i = getattr(nodes[i], "lat", None) if hasattr(nodes[i], "lat") else (nodes[i].get("lat") if isinstance(nodes[i], dict) else None)
        lng_i = getattr(nodes[i], "lng", None) if hasattr(nodes[i], "lng") else (nodes[i].get("lng") if isinstance(nodes[i], dict) else None)
        for j in range(n):
            if i == j:
                continue
            lat_j = getattr(nodes[j], "lat", None) if hasattr(nodes[j], "lat") else (nodes[j].get("lat") if isinstance(nodes[j], dict) else None)
            lng_j = getattr(nodes[j], "lng", None) if hasattr(nodes[j], "lng") else (nodes[j].get("lng") if isinstance(nodes[j], dict) else None)
            if lat_i is not None and lng_i is not None and lat_j is not None and lng_j is not None:
                d = round(haversine_distance_km(float(lat_i), float(lng_i), float(lat_j), float(lng_j)) * factor, 3)
                t = round(travel_time_minutes(d, speed_kmh), 2)
                distances[i][j] = d
                durations[i][j] = t

    return RouteMatrix(nodes, distances, durations, {"source": "FALLBACK", "travelMode": "TWO_WHEELER"})


def _get_node_name(node: Any, default: str) -> str:
    if hasattr(node, "name") and node.name:
        return str(node.name)
    if isinstance(node, dict) and node.get("name"):
        return str(node["name"])
    nid = getattr(node, "id", None) if hasattr(node, "id") else (node.get("id") if isinstance(node, dict) else None)
    if nid:
        return f"{default} (#{nid})"
    return default


def solve_optimal_trip(
    restaurant: Any,
    stops: List[Any],
    speed_kmh: float = DEFAULT_SPEED_KMH,
    service_time_mins: float = DEFAULT_SERVICE_TIME_MINS,
    factor: float = DEFAULT_ROUTING_FACTOR,
    route_matrix: Optional[RouteMatrix] = None,
    preserve_order: bool = False,
    customer_sla_mins: float = CUSTOMER_SLA_MINS,
) -> Dict[str, Any]:
    """
    Solves the optimal TSP sequence for visiting n delivery nodes from the Restaurant and returning.
    Respects asymmetric road distances and prioritizes customer SLA compliance.
    """
    if not stops:
        return {
            "orderedStops": [],
            "xDistanceKm": 0.0,
            "txTimeMinutes": 0.0,
            "yDistanceKm": 0.0,
            "tyTimeMinutes": 0.0,
            "roundTripDistanceKm": 0.0,
            "roundTripTimeMinutes": 0.0,
            "legs": [],
        }

    def get_dist(a: Any, b: Any) -> float:
        if route_matrix:
            return route_matrix.get_distance(a, b, factor)
        lat_a = getattr(a, "lat", None) if hasattr(a, "lat") else a.get("lat")
        lng_a = getattr(a, "lng", None) if hasattr(a, "lng") else a.get("lng")
        lat_b = getattr(b, "lat", None) if hasattr(b, "lat") else b.get("lat")
        lng_b = getattr(b, "lng", None) if hasattr(b, "lng") else b.get("lng")
        return haversine_distance_km(float(lat_a), float(lng_a), float(lat_b), float(lng_b)) * factor

    def get_dur(a: Any, b: Any) -> float:
        if route_matrix:
            return route_matrix.get_duration(a, b, speed_kmh, factor)
        d = get_dist(a, b)
        return travel_time_minutes(d, speed_kmh)

    if len(stops) == 1:
        s = stops[0]
        x_dist = round(get_dist(restaurant, s), 2)
        y_dist = round(get_dist(s, restaurant), 2)
        x_travel_time = get_dur(restaurant, s)
        tx = round(x_travel_time + service_time_mins, 1)
        ty = round(get_dur(s, restaurant), 1)
        round_trip_dist = round(x_dist + y_dist, 2)
        round_trip_time = round(tx + ty, 1)

        s_name = _get_node_name(s, "Stop 1")
        legs = [
            {
                "type": "OUTBOUND",
                "from": "Restaurant",
                "to": s_name,
                "stop": s,
                "distanceKm": x_dist,
                "travelTimeMinutes": round(x_travel_time, 1),
                "serviceTimeMinutes": service_time_mins,
                "totalTimeMinutes": tx,
            },
            {
                "type": "RETURN",
                "from": s_name,
                "to": "Restaurant",
                "stop": None,
                "distanceKm": y_dist,
                "travelTimeMinutes": ty,
                "serviceTimeMinutes": 0.0,
                "totalTimeMinutes": ty,
            },
        ]

        return {
            "orderedStops": [s],
            "xDistanceKm": x_dist,
            "txTimeMinutes": tx,
            "yDistanceKm": y_dist,
            "tyTimeMinutes": ty,
            "roundTripDistanceKm": round_trip_dist,
            "roundTripTimeMinutes": round_trip_time,
            "legs": legs,
        }

    def score_tour(p: List[Any]) -> Dict[str, Any]:
        d = get_dist(restaurant, p[0])
        t = get_dur(restaurant, p[0])
        cum_wait = t
        max_drop_time = t
        inversions = 0
        inv_dist_sum = 0.0

        first_depot_dist = get_dist(restaurant, p[0])
        last_depot_dist = get_dist(restaurant, p[-1])

        for i in range(len(p) - 1):
            leg_dist = get_dist(p[i], p[i + 1])
            leg_dur = get_dur(p[i], p[i + 1])
            d += leg_dist
            t += service_time_mins + leg_dur
            cum_wait += t
            if t > max_drop_time:
                max_drop_time = t

            d_cur = get_dist(restaurant, p[i])
            d_next = get_dist(restaurant, p[i + 1])
            if d_cur > d_next + 1e-4:
                inversions += 1
                inv_dist_sum += (d_cur - d_next)

        d += get_dist(p[-1], restaurant)
        t += service_time_mins + get_dur(p[-1], restaurant)

        sla_excess = max(0.0, max_drop_time - customer_sla_mins)

        return {
            "order": p,
            "totalDist": d,
            "totalTime": t,
            "cumWait": cum_wait,
            "maxDropTime": max_drop_time,
            "slaExcess": sla_excess,
            "firstDepotDist": first_depot_dist,
            "lastDepotDist": last_depot_dist,
            "inversions": inversions,
            "invDistSum": inv_dist_sum,
        }

    best_order = list(stops)

    if not preserve_order:
        if len(stops) <= 7:
            from itertools import permutations

            scored_perms = [score_tour(list(p)) for p in permutations(stops)]
            min_dist = min(sp["totalDist"] for sp in scored_perms)
            dist_tolerance = min(0.08, max(0.02, min_dist * 0.01))
            viable_perms = [sp for sp in scored_perms if sp["totalDist"] <= min_dist + dist_tolerance]

            def perm_cmp(a: Dict[str, Any], b: Dict[str, Any]) -> int:
                # 1. Prioritize keeping all customers within customer SLA window
                if abs(a["slaExcess"] - b["slaExcess"]) > 0.1:
                    return -1 if a["slaExcess"] < b["slaExcess"] else 1
                # 2. Lower cumulative customer wait time
                wait_diff = a["cumWait"] - b["cumWait"]
                if abs(wait_diff) > 0.25:
                    return -1 if wait_diff < 0 else 1
                # 3. First stop closest to restaurant
                first_diff = a["firstDepotDist"] - b["firstDepotDist"]
                if abs(first_diff) > 0.05:
                    return -1 if first_diff < 0 else 1
                # 4. Last stop farthest from restaurant
                last_diff = b["lastDepotDist"] - a["lastDepotDist"]
                if abs(last_diff) > 0.05:
                    return -1 if last_diff < 0 else 1
                # 5. Fewer inward inversions
                if a["inversions"] != b["inversions"]:
                    return -1 if a["inversions"] < b["inversions"] else 1
                if abs(a["invDistSum"] - b["invDistSum"]) > 0.05:
                    return -1 if a["invDistSum"] < b["invDistSum"] else 1
                # 6. Total distance tie-breaker
                return -1 if a["totalDist"] < b["totalDist"] else 1

            from functools import cmp_to_key

            viable_perms.sort(key=cmp_to_key(perm_cmp))
            best_order = viable_perms[0]["order"]
        else:
            # Nearest neighbor + 2-opt refinement for > 7 stops
            remaining = list(stops)
            best_order = []
            cur_node = restaurant

            while remaining:
                nearest_idx = 0
                nearest_dist = float("inf")
                for i, cand in enumerate(remaining):
                    dist = get_dist(cur_node, cand)
                    if dist < nearest_dist:
                        nearest_dist = dist
                        nearest_idx = i
                next_stop = remaining.pop(nearest_idx)
                best_order.append(next_stop)
                cur_node = next_stop

            current_score = score_tour(best_order)
            improved = True
            it = 0
            while improved and it < 50:
                improved = False
                it += 1
                for i in range(len(best_order) - 1):
                    for j in range(i + 1, len(best_order)):
                        candidate = (
                            best_order[:i]
                            + list(reversed(best_order[i : j + 1]))
                            + best_order[j + 1 :]
                        )
                        cand_score = score_tour(candidate)
                        if cand_score["totalDist"] < current_score["totalDist"] - 1e-6:
                            best_order = candidate
                            current_score = cand_score
                            improved = True

            if len(best_order) > 1:
                score_forward = score_tour(best_order)
                score_reverse = score_tour(list(reversed(best_order)))
                dist_tolerance = min(0.08, max(0.02, score_forward["totalDist"] * 0.01))

                if (
                    score_reverse["totalDist"] <= score_forward["totalDist"] + dist_tolerance
                    and score_reverse["slaExcess"] <= score_forward["slaExcess"] + 0.1
                ):
                    if (
                        score_reverse["firstDepotDist"] < score_forward["firstDepotDist"] - 0.05
                        or (
                            abs(score_reverse["firstDepotDist"] - score_forward["firstDepotDist"]) <= 0.05
                            and score_reverse["lastDepotDist"] > score_forward["lastDepotDist"] + 0.05
                        )
                    ):
                        best_order = score_reverse["order"]

    legs = []
    prev_node = restaurant
    x_dist_sum = 0.0
    x_travel_time_mins = 0.0

    for idx, s in enumerate(best_order):
        leg_road_km = round(get_dist(prev_node, s), 2)
        leg_travel_time = get_dur(prev_node, s)
        leg_total_time = round(leg_travel_time + service_time_mins, 1)

        from_label = "Restaurant" if idx == 0 else _get_node_name(best_order[idx - 1], f"Stop {idx}")
        to_label = _get_node_name(s, f"Stop {idx + 1}")

        legs.append({
            "type": "OUTBOUND",
            "from": from_label,
            "to": to_label,
            "stop": s,
            "distanceKm": leg_road_km,
            "travelTimeMinutes": round(leg_travel_time, 1),
            "serviceTimeMinutes": service_time_mins,
            "totalTimeMinutes": leg_total_time,
        })

        x_dist_sum += leg_road_km
        x_travel_time_mins += leg_travel_time
        prev_node = s

    x_dist = round(x_dist_sum, 2)
    tx = round(x_travel_time_mins + len(best_order) * service_time_mins, 1)

    last_stop = best_order[-1]
    y_dist = round(get_dist(last_stop, restaurant), 2)
    ty = round(get_dur(last_stop, restaurant), 1)

    legs.append({
        "type": "RETURN",
        "from": _get_node_name(last_stop, f"Stop {len(best_order)}"),
        "to": "Restaurant",
        "stop": None,
        "distanceKm": y_dist,
        "travelTimeMinutes": ty,
        "serviceTimeMinutes": 0.0,
        "totalTimeMinutes": ty,
    })

    round_trip_dist = round(x_dist + y_dist, 2)
    round_trip_time = round(tx + ty, 1)

    return {
        "orderedStops": best_order,
        "xDistanceKm": x_dist,
        "txTimeMinutes": tx,
        "yDistanceKm": y_dist,
        "tyTimeMinutes": ty,
        "roundTripDistanceKm": round_trip_dist,
        "roundTripTimeMinutes": round_trip_time,
        "legs": legs,
    }


def _shuffle_in_place(arr: List[Any]) -> List[Any]:
    for i in range(len(arr) - 1, 0, -1):
        j = random.randint(0, i)
        arr[i], arr[j] = arr[j], arr[i]
    return arr


def solve_alns(
    restaurant: Any,
    orders: List[Any],
    rider_count: Any = "AUTO",
    speed_kmh: float = DEFAULT_SPEED_KMH,
    service_time_mins: float = DEFAULT_SERVICE_TIME_MINS,
    factor: float = DEFAULT_ROUTING_FACTOR,
    max_drivers: int = DEFAULT_MAX_DRIVERS,
    max_iterations: int = 220,
    route_matrix: Optional[RouteMatrix] = None,
    max_cluster_length: int = DEFAULT_MAX_CLUSTER_LENGTH,
    customer_sla_mins: float = CUSTOMER_SLA_MINS,
) -> Dict[str, Any]:
    """
    Adaptive Large Neighborhood Search (ALNS) Metaheuristic Solver.
    Minimizes makespan (max trip time) and total distance subject to driver SLA and customer SLA.
    Strictly constrained by max_cluster_length and max_drivers.
    """
    def _is_valid(o: Any) -> bool:
        lat = getattr(o, "lat", None) if hasattr(o, "lat") else (o.get("lat") if isinstance(o, dict) else None)
        lng = getattr(o, "lng", None) if hasattr(o, "lng") else (o.get("lng") if isinstance(o, dict) else None)
        return lat is not None and lng is not None

    valid_orders = [o for o in (orders or []) if _is_valid(o)]
    if not valid_orders:
        return {
            "trips": [],
            "totalDistanceKm": 0.0,
            "maxTimeMinutes": 0.0,
            "totalTripTimeMinutes": 0.0,
            "activeRidersCount": 0,
            "averageTripDistanceKm": 0.0,
            "averageTripTimeMinutes": 0.0,
        }

    n = len(valid_orders)
    km_per_min = (speed_kmh if speed_kmh > 0 else 30.0) / 60.0
    effective_max_drivers = max(1, int(max_drivers) if max_drivers else DEFAULT_MAX_DRIVERS)
    requested_cluster_cap = max(1, int(max_cluster_length) if max_cluster_length else DEFAULT_MAX_CLUSTER_LENGTH)

    if n == 1 or rider_count == 1 or rider_count == "1" or effective_max_drivers == 1:
        single_trip = solve_optimal_trip(
            restaurant,
            valid_orders,
            speed_kmh,
            service_time_mins,
            factor,
            route_matrix,
            customer_sla_mins=customer_sla_mins,
        )
        return {
            "trips": [
                {
                    "riderIndex": 0,
                    "riderName": "Delivery Person 1",
                    "orders": single_trip["orderedStops"],
                    **single_trip,
                }
            ],
            "totalDistanceKm": single_trip["roundTripDistanceKm"],
            "maxTimeMinutes": single_trip["roundTripTimeMinutes"],
            "totalTripTimeMinutes": single_trip["roundTripTimeMinutes"],
            "activeRidersCount": 1,
            "averageTripDistanceKm": single_trip["roundTripDistanceKm"],
            "averageTripTimeMinutes": single_trip["roundTripTimeMinutes"],
        }

    all_nodes = [restaurant] + valid_orders
    num_nodes = len(all_nodes)
    dist_matrix: List[List[float]] = [[0.0] * num_nodes for _ in range(num_nodes)]
    duration_matrix: List[List[float]] = [[0.0] * num_nodes for _ in range(num_nodes)]
    max_graph_dist = 1.0

    for i in range(num_nodes):
        for j in range(num_nodes):
            if i == j:
                continue
            if route_matrix:
                d = route_matrix.get_distance(all_nodes[i], all_nodes[j], factor)
                t = route_matrix.get_duration(all_nodes[i], all_nodes[j], speed_kmh, factor)
            else:
                lat_i = getattr(all_nodes[i], "lat", None) if hasattr(all_nodes[i], "lat") else all_nodes[i].get("lat")
                lng_i = getattr(all_nodes[i], "lng", None) if hasattr(all_nodes[i], "lng") else all_nodes[i].get("lng")
                lat_j = getattr(all_nodes[j], "lat", None) if hasattr(all_nodes[j], "lat") else all_nodes[j].get("lat")
                lng_j = getattr(all_nodes[j], "lng", None) if hasattr(all_nodes[j], "lng") else all_nodes[j].get("lng")
                d = round(haversine_distance_km(float(lat_i), float(lng_i), float(lat_j), float(lng_j)) * factor, 3)
                t = round(travel_time_minutes(d, speed_kmh), 2)
            dist_matrix[i][j] = d
            duration_matrix[i][j] = t
            if d > max_graph_dist:
                max_graph_dist = d

    rest_lat = getattr(restaurant, "lat", None) if hasattr(restaurant, "lat") else restaurant.get("lat")
    rest_lng = getattr(restaurant, "lng", None) if hasattr(restaurant, "lng") else restaurant.get("lng")

    bearings_from_depot: List[float] = [0.0] * n
    sin_bearings: List[float] = [0.0] * n
    cos_bearings: List[float] = [0.0] * n

    for i in range(n):
        o_lat = getattr(valid_orders[i], "lat", None) if hasattr(valid_orders[i], "lat") else valid_orders[i].get("lat")
        o_lng = getattr(valid_orders[i], "lng", None) if hasattr(valid_orders[i], "lng") else valid_orders[i].get("lng")
        b = calculate_bearing(float(rest_lat), float(rest_lng), float(o_lat), float(o_lng))
        bearings_from_depot[i] = b
        rad = math.radians(b)
        sin_bearings[i] = math.sin(rad)
        cos_bearings[i] = math.cos(rad)

    def route_distance_only(route: List[int]) -> float:
        l = len(route)
        if l == 0:
            return 0.0
        d = dist_matrix[0][route[0]]
        for i in range(l - 1):
            d += dist_matrix[route[i]][route[i + 1]]
        return d + dist_matrix[route[-1]][0]

    def eval_route(route: List[int]) -> Dict[str, Any]:
        l = len(route)
        if l == 0:
            return {
                "dist": 0.0,
                "time": 0.0,
                "maxDropTime": 0.0,
                "sumDropTime": 0.0,
                "stopsCount": 0,
                "spreadPenalty": 0.0,
                "meanBearing": 0.0,
                "minDepotDist": 0.0,
                "maxDepotDist": 0.0,
            }

        first_node = route[0]
        d = dist_matrix[0][first_node]
        t = duration_matrix[0][first_node]
        max_drop = t
        sum_drop = t

        sin_sum = sin_bearings[first_node - 1]
        cos_sum = cos_bearings[first_node - 1]
        min_depot_d = d
        max_depot_d = d

        for i in range(l - 1):
            next_node = route[i + 1]
            t += service_time_mins
            d += dist_matrix[route[i]][next_node]
            t += duration_matrix[route[i]][next_node]
            sum_drop += t
            if t > max_drop:
                max_drop = t

            sin_sum += sin_bearings[next_node - 1]
            cos_sum += cos_bearings[next_node - 1]
            depot_d = dist_matrix[0][next_node]
            if depot_d < min_depot_d:
                min_depot_d = depot_d
            if depot_d > max_depot_d:
                max_depot_d = depot_d

        t += service_time_mins
        d += dist_matrix[route[-1]][0]
        t += duration_matrix[route[-1]][0]

        max_spread = 0.0
        if l > 1:
            for a in range(l):
                b_a = bearings_from_depot[route[a] - 1]
                for b in range(a + 1, l):
                    spread = angular_difference(b_a, bearings_from_depot[route[b] - 1])
                    if spread > max_spread:
                        max_spread = spread

        spread_penalty = (max_spread - 65.0) * 0.45 if max_spread > 65.0 else 0.0
        mean_bearing = (math.degrees(math.atan2(sin_sum, cos_sum)) + 360.0) % 360.0

        return {
            "dist": d,
            "time": t,
            "maxDropTime": max_drop,
            "sumDropTime": sum_drop,
            "stopsCount": l,
            "spreadPenalty": spread_penalty,
            "meanBearing": mean_bearing,
            "minDepotDist": min_depot_d,
            "maxDepotDist": max_depot_d,
        }

    def run_2opt(route: List[int]) -> List[int]:
        if len(route) <= 2:
            return list(route)
        best = list(route)
        best_dist = route_distance_only(best)
        improved = True
        it = 0

        while improved and it < 20:
            improved = False
            it += 1
            l = len(best)
            for i in range(l - 1):
                for j in range(i + 1, l):
                    candidate = best[:i] + list(reversed(best[i : j + 1])) + best[j + 1 :]
                    cand_dist = route_distance_only(candidate)
                    if cand_dist < best_dist - 1e-6:
                        best = candidate
                        best_dist = cand_dist
                        improved = True

        if len(best) > 1 and dist_matrix[0][best[0]] > dist_matrix[0][best[-1]]:
            rev = list(reversed(best))
            m_orig = eval_route(best)
            m_rev = eval_route(rev)
            if m_rev["dist"] <= m_orig["dist"] + 0.05 and m_rev["maxDropTime"] <= max(m_orig["maxDropTime"], customer_sla_mins):
                best = rev
        return best

    def combine_route_metrics(metrics: List[Dict[str, Any]]) -> Dict[str, Any]:
        m_count = len(metrics)
        max_t = 0.0
        total_d = 0.0
        max_customer_wait = 0.0
        total_customer_wait = 0.0
        total_stops = 0
        angular_penalty = 0.0

        for m in metrics:
            if m["time"] > max_t:
                max_t = m["time"]
            if m["maxDropTime"] > max_customer_wait:
                max_customer_wait = m["maxDropTime"]
            total_d += m["dist"]
            total_customer_wait += m["sumDropTime"]
            total_stops += m["stopsCount"]
            if m_count > 1:
                angular_penalty += m["spreadPenalty"]

        corridor_overlap_penalty = 0.0
        if m_count > 1:
            for r1 in range(m_count):
                m1 = metrics[r1]
                if m1["stopsCount"] == 0:
                    continue
                for r2 in range(r1 + 1, m_count):
                    m2 = metrics[r2]
                    if m2["stopsCount"] == 0:
                        continue
                    if angular_difference(m1["meanBearing"], m2["meanBearing"]) < 35.0:
                        overlap = max(
                            0.0,
                            min(m1["maxDepotDist"], m2["maxDepotDist"])
                            - max(m1["minDepotDist"], m2["minDepotDist"]),
                        )
                        if overlap > 0.4:
                            corridor_overlap_penalty += overlap * 5.0

        avg_customer_wait = total_customer_wait / total_stops if total_stops > 0 else 0.0

        customer_sla_excess = max(0.0, max_customer_wait - customer_sla_mins)
        customer_sla_penalty = (customer_sla_excess ** 1.4) * km_per_min * 3.0

        driver_trip_excess = max(0.0, max_t - DRIVER_TRIP_SLA_MINS)
        driver_trip_penalty = (driver_trip_excess ** 1.4) * km_per_min * 2.5

        cost = (
            total_d
            + 0.3 * (avg_customer_wait * km_per_min)
            + 0.1 * (max_t * km_per_min)
            + angular_penalty
            + corridor_overlap_penalty
            + customer_sla_penalty
            + driver_trip_penalty
        )

        return {
            "cost": cost,
            "maxT": max_t,
            "totalD": total_d,
            "maxCustomerWait": max_customer_wait,
            "avgCustomerWait": avg_customer_wait,
            "metrics": metrics,
        }

    def eval_solution(routes: List[List[int]]) -> Dict[str, Any]:
        metrics = [eval_route(r) for r in routes]
        return combine_route_metrics(metrics)

    def execute_alns_for_m(m_val: int, iters: int) -> Tuple[List[List[int]], Dict[str, Any]]:
        effective_max_cluster_len = max(requested_cluster_cap, math.ceil(n / m_val))

        sector_size_deg = 20.0
        sorted_order_indices = sorted(
            list(range(1, n + 1)),
            key=lambda idx: (
                math.floor(bearings_from_depot[idx - 1] / sector_size_deg),
                dist_matrix[0][idx],
            ),
        )

        def get_contiguous_partitions(arr: List[int], k: int) -> List[List[List[int]]]:
            if k == 1:
                return [[arr]]
            arr_len = len(arr)
            results: List[List[List[int]]] = []
            base = arr_len // k

            def search(idx: int, rem_k: int, current: List[List[int]]):
                if rem_k == 1:
                    tail = arr[idx:]
                    if len(tail) <= effective_max_cluster_len:
                        results.append(current + [tail])
                    return
                min_take = max(1, arr_len - idx - (rem_k - 1) * effective_max_cluster_len)
                max_take = min(effective_max_cluster_len, arr_len - idx - (rem_k - 1))
                for take in range(min_take, max_take + 1):
                    if arr_len > 12 and abs(take - base) > 2:
                        continue
                    search(idx + take, rem_k - 1, current + [arr[idx : idx + take]])

            search(0, k, [])
            return results

        best_sector_routes = None
        best_sector_cost = float("inf")
        rotations = min(n, 6)

        for rot in range(rotations):
            rotated = sorted_order_indices[rot:] + sorted_order_indices[:rot]
            candidate_partitions = get_contiguous_partitions(rotated, m_val)
            for part in candidate_partitions:
                optimized_part = [run_2opt(rt) for rt in part]
                eval_res = eval_solution(optimized_part)
                if eval_res["cost"] < best_sector_cost:
                    best_sector_cost = eval_res["cost"]
                    best_sector_routes = optimized_part

        if best_sector_routes:
            current_routes = best_sector_routes
        else:
            current_routes = [
                run_2opt(sorted_order_indices[math.floor((r * n) / m_val) : math.floor(((r + 1) * n) / m_val)])
                for r in range(m_val)
            ]

        current_eval = eval_solution(current_routes)
        best_routes = [list(r) for r in current_routes]
        best_eval = {
            **current_eval,
            "metrics": [dict(m) for m in current_eval["metrics"]],
        }

        d_weights = [1.0, 1.0, 1.0]  # Shaw, Worst, Random
        d_scores = [0, 0, 0]
        d_calls = [0, 0, 0]

        r_weights = [1.0, 1.0]  # Regret-2, Greedy
        r_scores = [0, 0]
        r_calls = [0, 0]

        def pick_op(weights: List[float]) -> int:
            total_w = sum(weights)
            rand = random.random() * total_w
            for idx, w in enumerate(weights):
                if rand <= w:
                    return idx
                rand -= w
            return len(weights) - 1

        temp = max(12.0, current_eval["cost"] * 0.12)
        cooling_rate = 0.965

        for iter_count in range(iters):
            q = max(1, min(math.floor(n * 0.35), 3))
            d_op = pick_op(d_weights)
            r_op = pick_op(r_weights)
            d_calls[d_op] += 1
            r_calls[r_op] += 1

            working_routes = [list(r) for r in current_routes]
            removed: List[int] = []

            # DESTROY OPERATORS
            if d_op == 0:
                # Shaw Removal (Relatedness)
                bottleneck_idx = max(range(len(current_eval["metrics"])), key=lambda idx: current_eval["metrics"][idx]["time"])
                b_route = working_routes[bottleneck_idx]
                seed = random.choice(b_route) if b_route else random.randint(1, n)
                seed_bearing = bearings_from_depot[seed - 1]
                candidates = []

                for r_idx, route in enumerate(working_routes):
                    for node in route:
                        if node == seed:
                            continue
                        d = dist_matrix[seed][node]
                        b_d = angular_difference(seed_bearing, bearings_from_depot[node - 1])
                        rel = 0.65 * (d / max_graph_dist) + 0.35 * (b_d / 180.0)
                        candidates.append((rel, r_idx, node))

                candidates.sort(key=lambda c: c[0])

                for route in working_routes:
                    if seed in route:
                        route.remove(seed)
                        removed.append(seed)
                        break

                while len(removed) < q and candidates:
                    _, cand_r, cand_node = candidates.pop(0)
                    if cand_node in working_routes[cand_r]:
                        working_routes[cand_r].remove(cand_node)
                        removed.append(cand_node)

            elif d_op == 1:
                # Worst Removal
                savings_list = []
                for r_idx, route in enumerate(working_routes):
                    r_metrics = eval_route(route)
                    for node in route:
                        test_r = [nd for nd in route if nd != node]
                        test_m = eval_route(test_r)
                        saving = r_metrics["dist"] - test_m["dist"]
                        if r_metrics["time"] >= current_eval["maxT"] - 1e-4:
                            saving *= 2.0
                        savings_list.append((saving, r_idx, node))

                savings_list.sort(key=lambda s: s[0], reverse=True)
                while len(removed) < q and savings_list:
                    _, pick_r, pick_node = savings_list.pop(0)
                    if pick_node in working_routes[pick_r]:
                        working_routes[pick_r].remove(pick_node)
                        removed.append(pick_node)
            else:
                # Random Removal
                flat = []
                for r_idx, route in enumerate(working_routes):
                    for node in route:
                        flat.append((r_idx, node))
                _shuffle_in_place(flat)
                for pick_r, pick_node in flat[:q]:
                    if pick_node in working_routes[pick_r]:
                        working_routes[pick_r].remove(pick_node)
                        removed.append(pick_node)

            working_metrics = [eval_route(r) for r in working_routes]

            # REPAIR OPERATORS
            if r_op == 0:
                # Regret-2 Insertion
                while removed:
                    max_regret = -float("inf")
                    best_cand_idx = 0
                    best_r = 0
                    best_pos = 0

                    for u, node in enumerate(removed):
                        route_insertions = []
                        for r_idx, base_route in enumerate(working_routes):
                            if len(base_route) >= effective_max_cluster_len:
                                continue
                            min_route_cost = float("inf")
                            best_p = 0
                            orig_metric = working_metrics[r_idx]

                            for p in range(len(base_route) + 1):
                                test_r = base_route[:p] + [node] + base_route[p:]
                                working_metrics[r_idx] = eval_route(test_r)
                                eval_temp = combine_route_metrics(working_metrics)
                                if eval_temp["cost"] < min_route_cost:
                                    min_route_cost = eval_temp["cost"]
                                    best_p = p
                            working_metrics[r_idx] = orig_metric
                            route_insertions.append({"routeIdx": r_idx, "bestP": best_p, "cost": min_route_cost})

                        if not route_insertions:
                            min_r = min(range(len(working_routes)), key=lambda idx: len(working_routes[idx]))
                            route_insertions.append({"routeIdx": min_r, "bestP": len(working_routes[min_r]), "cost": 99999.0})

                        route_insertions.sort(key=lambda x: x["cost"])
                        c1 = route_insertions[0]["cost"]
                        c2 = route_insertions[1]["cost"] if len(route_insertions) > 1 else c1 + 200.0
                        regret = c2 - c1

                        if regret > max_regret:
                            max_regret = regret
                            best_cand_idx = u
                            best_r = route_insertions[0]["routeIdx"]
                            best_pos = route_insertions[0]["bestP"]

                    node_to_insert = removed.pop(best_cand_idx)
                    working_routes[best_r].insert(best_pos, node_to_insert)
                    working_metrics[best_r] = eval_route(working_routes[best_r])
            else:
                # Greedy Min-Cost Insertion
                while removed:
                    min_global_cost = float("inf")
                    best_cand_idx = 0
                    best_r = 0
                    best_pos = 0

                    for u, node in enumerate(removed):
                        for r_idx, base_route in enumerate(working_routes):
                            if len(base_route) >= effective_max_cluster_len:
                                continue
                            orig_metric = working_metrics[r_idx]
                            for p in range(len(base_route) + 1):
                                test_r = base_route[:p] + [node] + base_route[p:]
                                working_metrics[r_idx] = eval_route(test_r)
                                eval_temp = combine_route_metrics(working_metrics)
                                if eval_temp["cost"] < min_global_cost:
                                    min_global_cost = eval_temp["cost"]
                                    best_cand_idx = u
                                    best_r = r_idx
                                    best_pos = p
                            working_metrics[r_idx] = orig_metric

                    if min_global_cost == float("inf"):
                        best_r = min(range(len(working_routes)), key=lambda idx: len(working_routes[idx]))
                        best_cand_idx = 0
                        best_pos = len(working_routes[best_r])

                    node_to_insert = removed.pop(best_cand_idx)
                    working_routes[best_r].insert(best_pos, node_to_insert)
                    working_metrics[best_r] = eval_route(working_routes[best_r])

            # LOCAL SEARCH (2-Opt & Bottleneck Relocate)
            for r_idx in range(len(working_routes)):
                working_routes[r_idx] = run_2opt(working_routes[r_idx])
                working_metrics[r_idx] = eval_route(working_routes[r_idx])

            intermediate_eval = combine_route_metrics(working_metrics)
            bottleneck_r = max(range(len(intermediate_eval["metrics"])), key=lambda idx: intermediate_eval["metrics"][idx]["time"])

            if len(working_routes[bottleneck_r]) > 1:
                relocated = False
                for i in range(len(working_routes[bottleneck_r])):
                    if relocated:
                        break
                    move_node = working_routes[bottleneck_r][i]
                    source_test = [nd for idx, nd in enumerate(working_routes[bottleneck_r]) if idx != i]
                    source_metric = eval_route(source_test)
                    orig_bottleneck_metric = working_metrics[bottleneck_r]

                    for target_r in range(len(working_routes)):
                        if target_r == bottleneck_r or len(working_routes[target_r]) >= effective_max_cluster_len:
                            continue
                        target_test = run_2opt(working_routes[target_r] + [move_node])
                        orig_target_metric = working_metrics[target_r]

                        working_metrics[bottleneck_r] = source_metric
                        working_metrics[target_r] = eval_route(target_test)
                        test_eval = combine_route_metrics(working_metrics)

                        if test_eval["cost"] < intermediate_eval["cost"] - 1e-4:
                            working_routes[bottleneck_r] = source_test
                            working_routes[target_r] = target_test
                            intermediate_eval = test_eval
                            relocated = True
                            break
                        else:
                            working_metrics[bottleneck_r] = orig_bottleneck_metric
                            working_metrics[target_r] = orig_target_metric

            # SIMULATED ANNEALING
            new_eval = intermediate_eval
            delta = new_eval["cost"] - current_eval["cost"]

            accepted = False
            if delta < -1e-6:
                accepted = True
                if new_eval["cost"] < best_eval["cost"] - 1e-6:
                    best_routes = [list(r) for r in working_routes]
                    best_eval = {
                        **new_eval,
                        "metrics": [dict(m) for m in new_eval["metrics"]],
                    }
                    d_scores[d_op] += 33
                    r_scores[r_op] += 33
                else:
                    d_scores[d_op] += 20
                    r_scores[r_op] += 20
            else:
                p = math.exp(-delta / temp)
                if random.random() < p:
                    accepted = True
                    d_scores[d_op] += 9
                    r_scores[r_op] += 9

            if accepted:
                current_routes = [list(r) for r in working_routes]
                current_eval = {
                    **new_eval,
                    "metrics": [dict(m) for m in new_eval["metrics"]],
                }

            temp *= cooling_rate

            if (iter_count + 1) % 25 == 0:
                alpha = 0.8
                for idx in range(len(d_weights)):
                    s = d_scores[idx] / d_calls[idx] if d_calls[idx] > 0 else 0.0
                    d_weights[idx] = max(0.1, alpha * d_weights[idx] + (1 - alpha) * s)
                    d_scores[idx] = 0
                    d_calls[idx] = 0
                for idx in range(len(r_weights)):
                    s = r_scores[idx] / r_calls[idx] if r_calls[idx] > 0 else 0.0
                    r_weights[idx] = max(0.1, alpha * r_weights[idx] + (1 - alpha) * s)
                    r_scores[idx] = 0
                    r_calls[idx] = 0

        return best_routes, best_eval

    # Fleet size M selection
    chosen_m = 1
    final_routes = []

    if rider_count == "AUTO" or rider_count is None:
        min_required_by_bag = math.ceil(n / requested_cluster_cap)
        max_m = min(n, effective_max_drivers)
        min_m = min(max_m, max(1, min_required_by_bag))

        best_composite_score = float("inf")
        sub_iters = min(120, max_iterations)

        for candidate_m in range(min_m, max_m + 1):
            res_routes, res_eval = execute_alns_for_m(candidate_m, sub_iters)
            dist_cost = res_eval["totalD"]
            driver_cost = (candidate_m - 1) * 7.0
            avg_wait_cost = (res_eval.get("avgCustomerWait") or 0.0) * km_per_min * 0.25

            cust_excess = max(0.0, (res_eval.get("maxCustomerWait") or 0.0) - customer_sla_mins)
            cust_penalty = (cust_excess ** 1.4) * km_per_min * 3.0

            trip_excess = max(0.0, res_eval["maxT"] - DRIVER_TRIP_SLA_MINS)
            trip_penalty = (trip_excess ** 1.4) * km_per_min * 2.5

            fleet_score = dist_cost + driver_cost + avg_wait_cost + cust_penalty + trip_penalty
            if fleet_score < best_composite_score:
                best_composite_score = fleet_score
                chosen_m = candidate_m
                final_routes = res_routes
    else:
        user_m = int(rider_count) if str(rider_count).isdigit() else 1
        chosen_m = min(max(1, user_m), min(n, effective_max_drivers))
        final_routes, _ = execute_alns_for_m(chosen_m, max_iterations)

    trips = []
    total_d = 0.0
    max_t = 0.0
    sum_t = 0.0

    for r_idx, route_indices in enumerate(final_routes):
        if not route_indices:
            continue
        stops = [valid_orders[idx - 1] for idx in route_indices]
        trip = solve_optimal_trip(
            restaurant,
            stops,
            speed_kmh,
            service_time_mins,
            factor,
            route_matrix,
            customer_sla_mins=customer_sla_mins,
        )

        total_d += trip["roundTripDistanceKm"]
        sum_t += trip["roundTripTimeMinutes"]
        if trip["roundTripTimeMinutes"] > max_t:
            max_t = trip["roundTripTimeMinutes"]

        trips.append({
            "riderIndex": len(trips),
            "riderName": f"Delivery Person {len(trips) + 1}",
            "orders": trip["orderedStops"],
            "xDistanceKm": trip["xDistanceKm"],
            "txTimeMinutes": trip["txTimeMinutes"],
            "yDistanceKm": trip["yDistanceKm"],
            "tyTimeMinutes": trip["tyTimeMinutes"],
            "roundTripDistanceKm": trip["roundTripDistanceKm"],
            "roundTripTimeMinutes": trip["roundTripTimeMinutes"],
            "legs": trip["legs"],
        })

    return {
        "trips": trips,
        "totalDistanceKm": round(total_d, 2),
        "maxTimeMinutes": round(max_t, 1),
        "totalTripTimeMinutes": round(sum_t, 1),
        "activeRidersCount": len(trips),
        "averageTripDistanceKm": round(total_d / len(trips), 2) if trips else 0.0,
        "averageTripTimeMinutes": round(sum_t / len(trips), 1) if trips else 0.0,
    }


def optimize_fleet_trips(
    restaurant: Any,
    orders: List[Any],
    rider_count: Any = "AUTO",
    speed_kmh: float = DEFAULT_SPEED_KMH,
    service_time_mins: float = DEFAULT_SERVICE_TIME_MINS,
    factor: float = DEFAULT_ROUTING_FACTOR,
    max_drivers: int = DEFAULT_MAX_DRIVERS,
    max_iterations: int = 220,
    route_matrix: Optional[RouteMatrix] = None,
    max_cluster_length: int = DEFAULT_MAX_CLUSTER_LENGTH,
    customer_sla_mins: float = CUSTOMER_SLA_MINS,
) -> Dict[str, Any]:
    """Top-level fleet multi-trip dispatch optimization wrapper."""
    return solve_alns(
        restaurant,
        orders,
        rider_count=rider_count,
        speed_kmh=speed_kmh,
        service_time_mins=service_time_mins,
        factor=factor,
        max_drivers=max_drivers,
        max_iterations=max_iterations,
        route_matrix=route_matrix,
        max_cluster_length=max_cluster_length,
        customer_sla_mins=customer_sla_mins,
    )
