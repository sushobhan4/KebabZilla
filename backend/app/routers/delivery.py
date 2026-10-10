from collections import defaultdict
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select, update

from app.dependencies import CurrentAccount, DbSession, require_roles
from app.integrations import customer_notifier
from app.models import (
    Account,
    DeliveryBatch,
    DeliveryBatchOrder,
    DeliveryDuty,
    Order,
    AdminEvent,
    OrderStatus,
    Payment,
    PaymentMethod,
    PaymentStatus,
    Role,
)
from app.schemas import BatchClaimInput, BatchCreate, DriverDutyInput, VerifyOtpInput
from app.services import (
    _distance_km,
    calculate_delivery_distance,
    create_delivery_otp,
    is_restaurant_open,
    order_payload,
    restaurant_settings,
    transition_order,
    verify_delivery_otp,
)

router = APIRouter(prefix="/delivery", tags=["delivery"], dependencies=[Depends(require_roles(Role.ADMIN, Role.DELIVERY))])

_failed_otp_attempts: dict[str, int] = defaultdict(int)


def _order_coords(o: Order, default_lat: float, default_lng: float) -> tuple[float, float]:
    if o.customer and o.customer.addresses:
        addr = next((a for a in o.customer.addresses if a.is_default), o.customer.addresses[0])
        if addr.latitude is not None and addr.longitude is not None:
            return addr.latitude, addr.longitude
    return default_lat, default_lng


def cluster_orders(orders: list[Order], k: int, restaurant_lat: float, restaurant_lng: float) -> list[list[Order]]:
    """Cluster orders geographically into k clusters based on delivery coordinates."""
    if not orders:
        return []
    k = max(1, min(k, len(orders)))
    if k == 1:
        # Sort single cluster orders by distance from restaurant for an efficient route
        sorted_orders = sorted(
            orders,
            key=lambda o: _distance_km(
                restaurant_lat,
                restaurant_lng,
                *_order_coords(o, restaurant_lat, restaurant_lng),
            ),
        )
        return [sorted_orders]

    points = []
    for o in orders:
        lat, lng = _order_coords(o, restaurant_lat, restaurant_lng)
        points.append((lat, lng, o))

    # Initialize k centroids using farthest point sampling
    centroids = [(points[0][0], points[0][1])]
    for _ in range(1, k):
        def dist_to_nearest_c(p):
            return min(_distance_km(p[0], p[1], c[0], c[1]) for c in centroids)
        next_c = max(points, key=dist_to_nearest_c)
        centroids.append((next_c[0], next_c[1]))

    # K-means iterations
    for _ in range(10):
        clusters_map = [[] for _ in range(k)]
        for p in points:
            c_idx = min(range(k), key=lambda i: _distance_km(p[0], p[1], centroids[i][0], centroids[i][1]))
            clusters_map[c_idx].append(p)

        new_centroids = []
        for i, cluster_pts in enumerate(clusters_map):
            if cluster_pts:
                avg_lat = sum(p[0] for p in cluster_pts) / len(cluster_pts)
                avg_lng = sum(p[1] for p in cluster_pts) / len(cluster_pts)
                new_centroids.append((avg_lat, avg_lng))
            else:
                new_centroids.append(centroids[i])
        centroids = new_centroids

    # Final assignment
    clusters = [[] for _ in range(k)]
    for p in points:
        c_idx = min(range(k), key=lambda i: _distance_km(p[0], p[1], centroids[i][0], centroids[i][1]))
        clusters[c_idx].append(p[2])

    result = []
    for cl in clusters:
        if cl:
            cl.sort(
                key=lambda o: _distance_km(
                    restaurant_lat,
                    restaurant_lng,
                    *_order_coords(o, restaurant_lat, restaurant_lng),
                )
            )
            result.append(cl)
    return result


def compute_round_trip_km(restaurant, orders: list[Order]) -> float:
    """Calculate the total round-trip distance (restaurant -> stop_1 -> ... -> stop_k -> restaurant)."""
    if not orders or restaurant.latitude is None or restaurant.longitude is None:
        return 0.0

    rest_lat = restaurant.latitude
    rest_lng = restaurant.longitude

    total_km = 0.0
    curr_lat, curr_lng = rest_lat, rest_lng
    factor = float(getattr(restaurant, "haversine_routing_factor", None) or 1.3)

    for o in orders:
        dest_lat, dest_lng = _order_coords(o, rest_lat, rest_lng)
        try:
            if curr_lat == rest_lat and curr_lng == rest_lng:
                leg_km, _ = calculate_delivery_distance(restaurant, dest_lat, dest_lng)
            else:
                leg_km = _distance_km(curr_lat, curr_lng, dest_lat, dest_lng) * factor
        except Exception:
            leg_km = _distance_km(curr_lat, curr_lng, dest_lat, dest_lng) * factor
        total_km += leg_km
        curr_lat, curr_lng = dest_lat, dest_lng

    try:
        return_km, _ = calculate_delivery_distance(restaurant, curr_lat, curr_lng)
    except Exception:
        return_km = _distance_km(curr_lat, curr_lng, rest_lat, rest_lng) * factor
    total_km += return_km

    return round(total_km, 1)


def _count_active_riders(db: DbSession) -> int:
    return db.scalar(
        select(func.count(DeliveryDuty.account_id))
        .join(Account, Account.id == DeliveryDuty.account_id)
        .where(
            Account.role.in_([Role.DELIVERY, Role.ADMIN]),
            DeliveryDuty.is_accepting_deliveries == True,
        )
    ) or 0


@router.get("/duty-status")
def get_duty_status(account: CurrentAccount, db: DbSession):
    restaurant = restaurant_settings(db)
    is_open, schedule_status = is_restaurant_open(restaurant)

    if not is_open:
        if account.is_accepting_deliveries:
            account.is_accepting_deliveries = False
        db.execute(
            update(DeliveryDuty)
            .where(DeliveryDuty.is_accepting_deliveries == True)
            .values(is_accepting_deliveries=False)
        )
        db.commit()

    active_riders = _count_active_riders(db)
    return {
        "is_accepting_deliveries": bool(account.is_accepting_deliveries),
        "is_restaurant_open": is_open,
        "schedule_status": schedule_status,
        "enforce_geofence": bool(restaurant.enforce_driver_geofence),
        "geofence_meters": restaurant.driver_geofence_meters or 500,
        "restaurant_latitude": restaurant.latitude,
        "restaurant_longitude": restaurant.longitude,
        "active_riders": active_riders,
    }


@router.post("/duty-status")
def update_duty_status(data: DriverDutyInput, account: CurrentAccount, db: DbSession):
    restaurant = restaurant_settings(db)
    is_open, schedule_status = is_restaurant_open(restaurant)

    if data.accepting:
        if not is_open:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot start accepting deliveries outside restaurant operating hours ({schedule_status}).",
            )
        if restaurant.enforce_driver_geofence:
            if data.latitude is None or data.longitude is None:
                raise HTTPException(
                    status_code=400,
                    detail="GPS location access is required to verify you are at the restaurant before accepting deliveries.",
                )
            if restaurant.latitude is not None and restaurant.longitude is not None:
                dist_m = _distance_km(restaurant.latitude, restaurant.longitude, data.latitude, data.longitude) * 1000.0
                max_m = restaurant.driver_geofence_meters or 500
                if dist_m > max_m:
                    raise HTTPException(
                        status_code=400,
                        detail=f"You are currently {int(dist_m)} meters away from the restaurant. You must be within {max_m} meters to accept deliveries.",
                    )

    account.is_accepting_deliveries = data.accepting
    db.commit()

    active_riders = _count_active_riders(db)

    return {
        "is_accepting_deliveries": account.is_accepting_deliveries,
        "is_restaurant_open": is_open,
        "schedule_status": schedule_status,
        "enforce_geofence": bool(restaurant.enforce_driver_geofence),
        "geofence_meters": restaurant.driver_geofence_meters or 500,
        "restaurant_latitude": restaurant.latitude,
        "restaurant_longitude": restaurant.longitude,
        "active_riders": active_riders,
    }


@router.get("/queue")
def queue(account: CurrentAccount, db: DbSession):
    orders = db.scalars(
        select(Order)
        .where(Order.assigned_delivery_id == account.id, Order.status == OrderStatus.OUT_FOR_DELIVERY)
        .order_by(Order.created_at)
    ).all()
    return [order_payload(order) for order in orders]


@router.get("/available")
def available_orders(db: DbSession):
    orders = db.scalars(
        select(Order).where(Order.status == OrderStatus.READY, Order.assigned_delivery_id.is_(None)).order_by(Order.created_at)
    ).all()
    return [order_payload(order) for order in orders]


@router.get("/history")
def delivery_history(account: CurrentAccount, db: DbSession):
    orders = db.scalars(
        select(Order)
        .where(Order.assigned_delivery_id == account.id, Order.status == OrderStatus.DELIVERED)
        .order_by(Order.delivered_at.desc(), Order.created_at.desc())
        .limit(100)
    ).all()
    return [order_payload(order) for order in orders]


@router.get("/recommended-batches")
def recommended_batches(account: CurrentAccount, db: DbSession):
    restaurant = restaurant_settings(db)
    is_open, schedule_status = is_restaurant_open(restaurant)

    if not is_open:
        if account.is_accepting_deliveries:
            account.is_accepting_deliveries = False
        db.execute(
            update(DeliveryDuty)
            .where(DeliveryDuty.is_accepting_deliveries == True)
            .values(is_accepting_deliveries=False)
        )
        db.commit()
        return {
            "is_accepting_deliveries": False,
            "active_riders": 0,
            "is_restaurant_open": False,
            "schedule_status": schedule_status,
            "single_order": False,
            "order": None,
            "clusters": [],
            "restaurant_latitude": restaurant.latitude,
            "restaurant_longitude": restaurant.longitude,
        }

    active_riders = _count_active_riders(db)

    # If the current driver is not accepting deliveries, do not show available orders
    if not account.is_accepting_deliveries:
        return {
            "is_accepting_deliveries": False,
            "active_riders": active_riders,
            "is_restaurant_open": is_open,
            "schedule_status": schedule_status,
            "single_order": False,
            "order": None,
            "clusters": [],
            "restaurant_latitude": restaurant.latitude,
            "restaurant_longitude": restaurant.longitude,
        }

    orders = db.scalars(
        select(Order)
        .where(Order.status == OrderStatus.READY, Order.assigned_delivery_id.is_(None))
        .order_by(Order.created_at)
    ).all()

    if not orders:
        return {
            "is_accepting_deliveries": True,
            "active_riders": active_riders,
            "is_restaurant_open": is_open,
            "schedule_status": schedule_status,
            "single_order": False,
            "order": None,
            "clusters": [],
            "restaurant_latitude": restaurant.latitude,
            "restaurant_longitude": restaurant.longitude,
        }

    # If there is a single order at the moment, show only that order directly
    if len(orders) == 1:
        payload = order_payload(orders[0])
        rt_km = compute_round_trip_km(restaurant, [orders[0]])
        payload["round_trip_km"] = rt_km
        return {
            "is_accepting_deliveries": True,
            "active_riders": active_riders,
            "is_restaurant_open": is_open,
            "schedule_status": schedule_status,
            "single_order": True,
            "order": payload,
            "round_trip_km": rt_km,
            "clusters": [
                {
                    "id": orders[0].order_id,
                    "route_label": f"Single delivery · Order #{orders[0].order_id}",
                    "orders": [payload],
                    "round_trip_km": rt_km,
                }
            ],
            "restaurant_latitude": restaurant.latitude,
            "restaurant_longitude": restaurant.longitude,
        }

    # Multiple orders: form n clusters, where n is active delivery persons (at least 1)
    n_clusters = max(1, active_riders)
    clustered = cluster_orders(
        orders,
        k=n_clusters,
        restaurant_lat=restaurant.latitude or 0.0,
        restaurant_lng=restaurant.longitude or 0.0,
    )

    clusters_payload = [
        {
            "id": "-".join(order.order_id for order in cl),
            "route_label": f"Delivery {idx + 1} · {len(cl)} stop{'s' if len(cl) != 1 else ''}",
            "orders": [order_payload(order) for order in cl],
            "round_trip_km": compute_round_trip_km(restaurant, cl),
        }
        for idx, cl in enumerate(clustered)
    ]

    return {
        "is_accepting_deliveries": True,
        "active_riders": active_riders,
        "is_restaurant_open": is_open,
        "schedule_status": schedule_status,
        "single_order": False,
        "order": None,
        "clusters": clusters_payload,
        "restaurant_latitude": restaurant.latitude,
        "restaurant_longitude": restaurant.longitude,
    }


@router.post("/recommended-batches/claim", status_code=status.HTTP_201_CREATED)
async def claim_recommended_batch(data: BatchClaimInput, account: CurrentAccount, db: DbSession):
    orders = db.scalars(
        select(Order).where(Order.order_id.in_(data.order_ids), Order.status == OrderStatus.READY, Order.assigned_delivery_id.is_(None))
    ).all()
    if len(orders) != len(data.order_ids):
        raise HTTPException(status_code=409, detail="This batch was already claimed or has changed. Refresh to see the remaining deliveries.")
    for order in orders:
        claimed = db.execute(
            update(Order)
            .where(Order.order_id == order.order_id, Order.status == OrderStatus.READY, Order.assigned_delivery_id.is_(None))
            .values(assigned_delivery_id=account.id)
        )
        if claimed.rowcount != 1:
            db.rollback()
            raise HTTPException(status_code=409, detail="This batch was just claimed by another rider. Refresh to see the remaining deliveries.")
        transition_order(order, OrderStatus.OUT_FOR_DELIVERY)
        otp = create_delivery_otp(order)
        await customer_notifier.send_delivery_otp(
            phone=order.customer_phone or (order.customer.phone if order.customer else None),
            order_number=order.order_id,
            otp=otp,
        )
    batch = DeliveryBatch(delivery_id=account.id, route_label=f"Nearby delivery route · {len(orders)} stop{'s' if len(orders) != 1 else ''}")
    batch.orders = [DeliveryBatchOrder(order_id=order.order_id) for order in orders]
    db.add(batch)
    db.add(AdminEvent(event_type="delivery_batch_claimed", message=f"{account.name} took a {len(orders)}-stop delivery batch", actor_id=account.id, details={"order_ids": data.order_ids, "delivery_id": account.id}))
    db.commit()
    return {"order_ids": data.order_ids, "route_label": batch.route_label}


@router.post("/orders/{order_id}/claim")
async def claim_order(order_id: str, account: CurrentAccount, db: DbSession):
    claimed = db.execute(
        update(Order)
        .where(Order.order_id == order_id, Order.status == OrderStatus.READY, Order.assigned_delivery_id.is_(None))
        .values(assigned_delivery_id=account.id)
    )
    if claimed.rowcount != 1:
        db.rollback()
        raise HTTPException(status_code=409, detail="This delivery was already taken or is no longer available")
    order = db.get(Order, order_id)
    if order is None:
        db.rollback()
        raise HTTPException(status_code=404, detail="Delivery not found")
    transition_order(order, OrderStatus.OUT_FOR_DELIVERY)
    db.add(AdminEvent(event_type="delivery_claimed", message=f"{account.name} picked order {order.order_id}", actor_id=account.id, details={"order_id": order.order_id, "delivery_id": account.id, "delivery_name": account.name}))
    otp = create_delivery_otp(order)
    await customer_notifier.send_delivery_otp(
        phone=order.customer_phone or (order.customer.phone if order.customer else None),
        order_number=order.order_id,
        otp=otp,
    )
    db.commit()
    return order_payload(order)


@router.post("/batches", status_code=status.HTTP_201_CREATED)
def create_batch(data: BatchCreate, account: CurrentAccount, db: DbSession):
    if len(set(data.order_ids)) != len(data.order_ids):
        raise HTTPException(status_code=400, detail="A delivery may only appear once in a route")
    orders = db.scalars(
        select(Order).where(
            Order.order_id.in_(data.order_ids),
            Order.assigned_delivery_id == account.id,
            Order.status == OrderStatus.OUT_FOR_DELIVERY,
        )
    ).all()
    if len(orders) != len(data.order_ids):
        raise HTTPException(status_code=400, detail="All selected orders must be in your active delivery queue")
    batch = DeliveryBatch(delivery_id=account.id, route_label=data.route_label)
    batch.orders = [DeliveryBatchOrder(order_id=order.order_id) for order in orders]
    db.add(batch)
    db.commit()
    db.refresh(batch)
    return {"id": batch.id, "route_label": batch.route_label, "order_ids": data.order_ids, "created_at": batch.created_at}


@router.get("/batches")
def list_batches(account: CurrentAccount, db: DbSession):
    batches = db.scalars(
        select(DeliveryBatch).where(DeliveryBatch.delivery_id == account.id).order_by(DeliveryBatch.created_at.desc()).limit(50)
    ).all()
    return [
        {"id": batch.id, "route_label": batch.route_label, "order_ids": [entry.order_id for entry in batch.orders], "created_at": batch.created_at}
        for batch in batches
    ]


@router.post("/orders/{order_id}/verify-otp")
def deliver(order_id: str, data: VerifyOtpInput, account: CurrentAccount, db: DbSession):
    order = db.get(Order, order_id)
    if order is None or order.assigned_delivery_id != account.id or order.status != OrderStatus.OUT_FOR_DELIVERY:
        raise HTTPException(status_code=404, detail="Active delivery not found")
    if _failed_otp_attempts[order_id] >= 5:
        raise HTTPException(status_code=429, detail="Too many incorrect delivery code attempts. Please contact the customer or dispatch.")
    if not verify_delivery_otp(order, data.otp):
        _failed_otp_attempts[order_id] += 1
        raise HTTPException(status_code=400, detail="The delivery code is incorrect or expired")
    _failed_otp_attempts.pop(order_id, None)
    transition_order(order, OrderStatus.DELIVERED)
    db.add(AdminEvent(event_type="order_delivered", message=f"Order {order.order_id} delivered by {account.name}", actor_id=account.id, details={"order_id": order.order_id, "delivery_id": account.id, "delivery_name": account.name}))
    order.delivered_at = datetime.now(timezone.utc)
    payment = db.get(Payment, order.order_id)
    if payment and payment.method == PaymentMethod.CASH:
        payment.status = PaymentStatus.PAID
    db.commit()
    return order_payload(order)
