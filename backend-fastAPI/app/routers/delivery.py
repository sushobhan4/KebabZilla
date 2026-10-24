from collections import defaultdict
from datetime import datetime, timezone
import logging

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.orm import joinedload, selectinload

from app.dependencies import CurrentAccount, CurrentAccountModel, DbSession, require_roles
from app.integrations import customer_notifier
from app.models import (
    Account,
    DeliveryBatch,
    DeliveryBatchOrder,
    StaffInfo,
    Order,
    OrderItem,
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
    recalculate_and_update_delivery_speed,
    restaurant_settings,
    transition_order,
    verify_delivery_otp,
)
from app.clustering import optimize_fleet_trips, solve_optimal_trip
from app.cache import (
    KEY_ADMIN_SETTINGS,
    PREFIX_DELIVERY,
    cache,
    invalidate_auth_cache,
    invalidate_delivery_cache,
    invalidate_orders_cache,
)

router = APIRouter(prefix="/delivery", tags=["delivery"], dependencies=[Depends(require_roles(Role.ADMIN, Role.DELIVERY))])


class OrderNode:
    """Wrapper holding Order reference and geographic coordinates for ALNS dispatch engine."""

    def __init__(self, order: Order, lat: float, lng: float):
        self.order = order
        self.id = order.order_id
        self.lat = lat
        self.lng = lng
        self.name = f"Order #{order.order_id}"


def _order_coords(o: Order, default_lat: float, default_lng: float) -> tuple[float, float]:
    if o.latitude is not None and o.longitude is not None:
        return o.latitude, o.longitude
    if o.customer and o.customer.addresses:
        addr = next((a for a in o.customer.addresses if a.is_default), o.customer.addresses[0])
        if addr.latitude is not None and addr.longitude is not None:
            return addr.latitude, addr.longitude
    return default_lat, default_lng


def cluster_orders(
    orders: list[Order],
    k: int,
    restaurant_lat: float,
    restaurant_lng: float,
    speed_kmh: float = 30.0,
    factor: float = 1.3627,
    max_cluster_length: int = 5,
    customer_sla_mins: float = 36.0,
    max_iterations: int = 220,
) -> list[list[Order]]:
    """Cluster orders geographically into k clusters using the ALNS optimization engine."""
    if not orders:
        return []
    rest_node = {"lat": restaurant_lat, "lng": restaurant_lng, "name": "Restaurant"}
    nodes = [OrderNode(o, *_order_coords(o, restaurant_lat, restaurant_lng)) for o in orders]
    res = optimize_fleet_trips(
        rest_node,
        nodes,
        rider_count=k,
        speed_kmh=speed_kmh,
        factor=factor,
        max_drivers=max(1, k),
        max_iterations=max_iterations,
        max_cluster_length=max_cluster_length,
        customer_sla_mins=customer_sla_mins,
    )
    return [[node.order for node in trip["orders"]] for trip in res["trips"] if trip.get("orders")]


def compute_round_trip_km(restaurant, orders: list[Order]) -> float:
    """Calculate the total round-trip distance (restaurant -> stop_1 -> ... -> stop_k -> restaurant)."""
    if not orders or restaurant.latitude is None or restaurant.longitude is None:
        return 0.0

    rest_node = {"lat": restaurant.latitude, "lng": restaurant.longitude, "name": "Restaurant"}
    factor = float(getattr(restaurant, "haversine_routing_factor", None) or 1.3627)
    speed_kmh = float(getattr(restaurant, "average_delivery_speed_kmh", None) or 30.0)
    customer_sla = float(getattr(restaurant, "customer_sla_minutes", None) or 36.0)

    nodes = [OrderNode(o, *_order_coords(o, restaurant.latitude, restaurant.longitude)) for o in orders]
    trip = solve_optimal_trip(
        rest_node,
        nodes,
        speed_kmh=speed_kmh,
        factor=factor,
        customer_sla_mins=customer_sla,
        preserve_order=True,
    )
    return round(float(trip["roundTripDistanceKm"]), 1)


def _count_active_riders(db: DbSession) -> int:
    cache_key = f"{PREFIX_DELIVERY}active_riders"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    count = db.scalar(
        select(func.count(StaffInfo.account_id))
        .join(Account, Account.id == StaffInfo.account_id)
        .where(
            Account.role.in_([Role.DELIVERY, Role.ADMIN]),
            StaffInfo.is_accepting_deliveries == True,
        )
    ) or 0
    cache.set(cache_key, count, ttl_seconds=5.0)
    return count


@router.get("/duty-status")
def get_duty_status(account: CurrentAccount, db: DbSession):
    restaurant = restaurant_settings(db)
    is_open, schedule_status = is_restaurant_open(restaurant)

    is_accepting = bool(account.is_accepting_deliveries)
    if not is_open:
        if is_accepting:
            db.execute(
                update(StaffInfo)
                .where(StaffInfo.is_accepting_deliveries == True)
                .values(is_accepting_deliveries=False)
            )
            db.commit()
            invalidate_auth_cache(account_id=account.id)
            is_accepting = False

    active_riders = _count_active_riders(db)
    return {
        "is_accepting_deliveries": is_accepting,
        "is_restaurant_open": is_open,
        "schedule_status": schedule_status,
        "enforce_geofence": bool(restaurant.enforce_driver_geofence),
        "geofence_meters": restaurant.driver_geofence_meters or 500,
        "restaurant_latitude": restaurant.latitude,
        "restaurant_longitude": restaurant.longitude,
        "active_riders": active_riders,
    }


@router.post("/duty-status")
def update_duty_status(data: DriverDutyInput, account: CurrentAccountModel, db: DbSession):
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
    invalidate_delivery_cache()
    cache.delete(KEY_ADMIN_SETTINGS)
    invalidate_auth_cache(account_id=account.id)

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
        .options(
            joinedload(Order.customer),
            joinedload(Order.payment),
            joinedload(Order.delivery),
            selectinload(Order.items).joinedload(OrderItem.menu_item),
        )
        .order_by(Order.created_at)
    ).all()
    payloads = []
    for order in orders:
        data = order_payload(order, include_customer_email=False)
        data["address"] = None
        data["customer_phone"] = None
        payloads.append(data)
    return payloads


@router.get("/available")
def available_orders(account: CurrentAccount, db: DbSession):
    if account.role == Role.DELIVERY and not account.is_accepting_deliveries:
        return []
    orders = db.scalars(
        select(Order)
        .where(Order.status == OrderStatus.READY, Order.assigned_delivery_id.is_(None))
        .options(
            joinedload(Order.customer),
            joinedload(Order.payment),
            joinedload(Order.delivery),
            selectinload(Order.items).joinedload(OrderItem.menu_item),
        )
        .order_by(Order.created_at)
    ).all()
    return [order_payload(order, include_customer_email=False) for order in orders]


@router.get("/history")
def delivery_history(account: CurrentAccount, db: DbSession):
    orders = db.scalars(
        select(Order)
        .where(Order.assigned_delivery_id == account.id, Order.status == OrderStatus.DELIVERED)
        .options(
            joinedload(Order.customer),
            joinedload(Order.payment),
            joinedload(Order.delivery),
            selectinload(Order.items).joinedload(OrderItem.menu_item),
        )
        .order_by(Order.delivered_at.desc(), Order.created_at.desc())
        .limit(100)
    ).all()
    return [order_payload(order, include_customer_email=False) for order in orders]


@router.get("/recommended-batches")
def recommended_batches(account: CurrentAccount, db: DbSession):
    restaurant = restaurant_settings(db)
    is_open, schedule_status = is_restaurant_open(restaurant)

    if not is_open:
        db.execute(
            update(StaffInfo)
            .where(StaffInfo.is_accepting_deliveries == True)
            .values(is_accepting_deliveries=False)
        )
        db.commit()
        invalidate_auth_cache(account_id=account.id)
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

    cache_key = f"{PREFIX_DELIVERY}recommended_batches"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    orders = db.scalars(
        select(Order)
        .where(Order.status == OrderStatus.READY, Order.assigned_delivery_id.is_(None))
        .order_by(Order.created_at)
    ).all()

    if not orders:
        empty_res = {
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
        cache.set(cache_key, empty_res, ttl_seconds=5.0)
        return empty_res

    try:
        routing_factor = float(getattr(restaurant, "haversine_routing_factor", None) or 1.3627)
        speed_kmh = float(getattr(restaurant, "average_delivery_speed_kmh", None) or 30.0)
        customer_sla = float(getattr(restaurant, "customer_sla_minutes", None) or 36.0)
        max_orders = int(getattr(restaurant, "max_orders_per_driver", None) or 5)
        max_iters = (
            int(getattr(restaurant, "alns_max_iterations", None) or 220)
            if getattr(restaurant, "alns_max_iterations_mode", "AUTO") == "MANUAL"
            else 220
        )
        max_drivers = max(1, active_riders)

        rest_node = {
            "lat": float(restaurant.latitude or 0.0),
            "lng": float(restaurant.longitude or 0.0),
            "name": restaurant.restaurant_name or "Restaurant",
        }

        # If there is a single order at the moment, show only that order directly
        if len(orders) == 1:
            order_obj = orders[0]
            node = OrderNode(order_obj, *_order_coords(order_obj, rest_node["lat"], rest_node["lng"]))
            trip = solve_optimal_trip(
                rest_node,
                [node],
                speed_kmh=speed_kmh,
                factor=routing_factor,
                customer_sla_mins=customer_sla,
            )
            payload = order_payload(order_obj, include_customer_email=False)
            rt_km = trip.get("roundTripDistanceKm", 0.0)
            rt_mins = trip.get("roundTripTimeMinutes", 0.0)
            payload["round_trip_km"] = rt_km
            payload["round_trip_time_minutes"] = rt_mins
            single_res = {
                "is_accepting_deliveries": True,
                "active_riders": active_riders,
                "is_restaurant_open": is_open,
                "schedule_status": schedule_status,
                "single_order": True,
                "order": payload,
                "round_trip_km": rt_km,
                "round_trip_time_minutes": rt_mins,
                "clusters": [
                    {
                        "id": str(order_obj.order_id),
                        "route_label": f"Single delivery · Order #{order_obj.order_id}",
                        "orders": [payload],
                        "round_trip_km": rt_km,
                        "round_trip_time_minutes": rt_mins,
                        "legs": trip.get("legs", []),
                    }
                ],
                "restaurant_latitude": restaurant.latitude,
                "restaurant_longitude": restaurant.longitude,
            }
            cache.set(cache_key, single_res, ttl_seconds=5.0)
            return single_res

        # Multiple orders: optimize fleet dispatch using the ALNS metaheuristic engine
        nodes = [
            OrderNode(o, *_order_coords(o, rest_node["lat"], rest_node["lng"]))
            for o in orders
        ]
        alns_result = optimize_fleet_trips(
            rest_node,
            nodes,
            rider_count="AUTO",
            speed_kmh=speed_kmh,
            factor=routing_factor,
            max_drivers=max_drivers,
            max_iterations=max_iters,
            max_cluster_length=max_orders,
            customer_sla_mins=customer_sla,
        )

        clusters_payload = [
            {
                "id": "-".join(str(getattr(node, "id", None) or getattr(getattr(node, "order", None), "order_id", idx)) for node in trip.get("orders", [])),
                "route_label": f"Delivery {idx + 1} · {len(trip['orders'])} stop{'s' if len(trip['orders']) != 1 else ''}",
                "orders": [order_payload(node.order, include_customer_email=False) for node in trip.get("orders", []) if hasattr(node, "order")],
                "round_trip_km": trip.get("roundTripDistanceKm", 0.0),
                "round_trip_time_minutes": trip.get("roundTripTimeMinutes", 0.0),
                "legs": trip.get("legs", []),
            }
            for idx, trip in enumerate(alns_result.get("trips") or [])
            if trip.get("orders")
        ]

        fleet_res = {
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
        cache.set(cache_key, fleet_res, ttl_seconds=5.0)
        return fleet_res
    except Exception as exc:
        logger.exception("Failed to calculate recommended delivery batches: %s", exc)
        # Resilient fallback: present each ready order as an individual available delivery
        fallback_clusters = [
            {
                "id": str(o.order_id),
                "route_label": f"Delivery · Order #{o.order_id}",
                "orders": [order_payload(o, include_customer_email=False)],
                "round_trip_km": 0.0,
                "round_trip_time_minutes": 0.0,
                "legs": [],
            }
            for o in orders
        ]
        return {
            "is_accepting_deliveries": True,
            "active_riders": active_riders,
            "is_restaurant_open": is_open,
            "schedule_status": schedule_status,
            "single_order": len(orders) == 1,
            "order": order_payload(orders[0], include_customer_email=False) if len(orders) == 1 else None,
            "clusters": fallback_clusters,
            "restaurant_latitude": restaurant.latitude,
            "restaurant_longitude": restaurant.longitude,
        }


@router.post("/recommended-batches/claim", status_code=status.HTTP_201_CREATED)
async def claim_recommended_batch(data: BatchClaimInput, account: CurrentAccount, db: DbSession):
    try:
        orders = db.scalars(
            select(Order).where(Order.order_id.in_(data.order_ids), Order.status == OrderStatus.READY, Order.assigned_delivery_id.is_(None))
        ).all()
        if len(orders) != len(data.order_ids):
            raise HTTPException(status_code=409, detail="This batch was already claimed or has changed. Refresh to see the remaining deliveries.")
        
        notifications_to_send = []
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
            otp = create_delivery_otp(order, db)
            customer_email = order.customer.email if order.customer else None
            notifications_to_send.append({
                "phone": order.customer_phone or (order.customer.phone if order.customer else None),
                "order_number": order.order_id,
                "otp": otp,
                "email": customer_email,
                "customer_name": order.customer_name or (order.customer.name if order.customer else None),
            })
        batch = DeliveryBatch(delivery_id=account.id, route_label=f"Nearby delivery route · {len(orders)} stop{'s' if len(orders) != 1 else ''}")
        batch.orders = [DeliveryBatchOrder(order_id=order.order_id) for order in orders]
        db.add(batch)
        db.add(AdminEvent(event_type="delivery_batch_claimed", message=f"{account.name} took a {len(orders)}-stop delivery batch", actor_id=account.id, details={"order_ids": data.order_ids, "delivery_id": account.id}))
        db.commit()

        # Dispatch notifications only after transaction is successfully committed
        for notif in notifications_to_send:
            try:
                await customer_notifier.send_delivery_otp(**notif)
            except Exception as exc:
                logger.warning("[CustomerNotifier] Could not send batch delivery OTP: %s", exc)

        invalidate_delivery_cache()
        invalidate_orders_cache()
        return {"order_ids": data.order_ids, "route_label": batch.route_label}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to claim delivery batch: %s", exc)
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to claim delivery batch: {exc}")


@router.post("/orders/{order_id}/claim")
async def claim_order(order_id: str, account: CurrentAccount, db: DbSession):
    try:
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
        otp = create_delivery_otp(order, db)

        # Create a single-order batch entry so the driver map and batches stay in sync
        batch = DeliveryBatch(delivery_id=account.id, route_label=f"Single delivery route · 1 stop")
        batch.orders = [DeliveryBatchOrder(order_id=order.order_id)]
        db.add(batch)

        db.commit()

        # Dispatch notification after successful transaction commit
        customer_email = order.customer.email if order.customer else None
        try:
            await customer_notifier.send_delivery_otp(
                phone=order.customer_phone or (order.customer.phone if order.customer else None),
                order_number=order.order_id,
                otp=otp,
                email=customer_email,
                customer_name=order.customer_name or (order.customer.name if order.customer else None),
            )
        except Exception as exc:
            logger.warning("[CustomerNotifier] Could not send delivery OTP notification: %s", exc)

        invalidate_delivery_cache()
        invalidate_orders_cache()
        return order_payload(order, include_customer_email=False)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to claim order %s: %s", order_id, exc)
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to claim delivery: {exc}")


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
    invalidate_delivery_cache()
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
    if order.delivery_otp_attempts >= 5:
        raise HTTPException(status_code=429, detail="Too many incorrect delivery code attempts. Please contact the customer or dispatch.")
    if not verify_delivery_otp(order, data.otp, db=db):
        order.delivery_otp_attempts += 1
        db.commit()
        raise HTTPException(status_code=400, detail="The delivery code is incorrect or expired")
    order.delivery_otp_attempts = 0
    transition_order(order, OrderStatus.DELIVERED)
    db.add(AdminEvent(event_type="order_delivered", message=f"Order {order.order_id} delivered by {account.name}", actor_id=account.id, details={"order_id": order.order_id, "delivery_id": account.id, "delivery_name": account.name}))
    order.delivered_at = datetime.now(timezone.utc)
    recalculate_and_update_delivery_speed(db)
    payment = db.get(Payment, order.order_id)
    if payment and payment.method == PaymentMethod.CASH:
        payment.status = PaymentStatus.PAID
    db.commit()
    invalidate_orders_cache()
    invalidate_delivery_cache()
    return order_payload(order, include_customer_email=False)
