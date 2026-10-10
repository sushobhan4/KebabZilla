from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import admin, auth, cart, custom_menu, delivery, menu, orders, payments, staff
from app.services import is_restaurant_open, restaurant_settings
from app.dependencies import CurrentAccount, DbSession
from app.models import Account, Role
from sqlalchemy import select

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    description="Role-secured restaurant ordering, payments, and operations API.",
)

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), payment=(self)"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        return response

app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=r"^https://.*\.trycloudflare\.com$",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Razorpay-Signature"],
)

for route_module in (auth, menu, cart, orders, staff, delivery, admin, payments, custom_menu):
    app.include_router(route_module.router, prefix=settings.api_prefix)



@app.get(f"{settings.api_prefix}/restaurant", tags=["restaurant"])
def public_restaurant(db: DbSession):
    config = restaurant_settings(db)
    is_open, sched_status = is_restaurant_open(config)
    return {
        "restaurant_name": config.restaurant_name,
        "tagline": config.tagline,
        "phone": config.phone,
        "address": config.address,
        "latitude": config.latitude,
        "longitude": config.longitude,
        "minimum_order_paise": config.minimum_order_paise,
        "delivery_radius_km": config.delivery_radius_km,
        "free_delivery_radius_km": config.free_delivery_radius_km,
        "delivery_fee_per_km_paise": config.delivery_fee_per_km_paise,
        "accepting_orders": is_open,
        "is_restaurant_open": is_open,
        "schedule_status": sched_status,
        "weekly_schedule": config.weekly_schedule or {},
        "distance_calculation_mode": getattr(config, "distance_calculation_mode", "AUTO") or "AUTO",
        "enforce_driver_geofence": getattr(config, "enforce_driver_geofence", False) or False,
        "driver_geofence_meters": getattr(config, "driver_geofence_meters", 500) or 500,
        "haversine_routing_factor": getattr(config, "haversine_routing_factor", 1.3) or 1.3,
    }


@app.get(f"{settings.api_prefix}/restaurant/delivery-estimate", tags=["restaurant"])
def estimate_delivery(latitude: float, longitude: float, db: DbSession):
    import math
    from app.services import calculate_delivery_distance
    config = restaurant_settings(db)
    if config.latitude is None or config.longitude is None:
        raise HTTPException(status_code=503, detail="The restaurant delivery location is not configured")
    distance_km, method = calculate_delivery_distance(config, latitude, longitude)
    within_radius = distance_km <= config.delivery_radius_km
    if distance_km <= config.free_delivery_radius_km:
        fee_paise = 0
        raw_fee_inr = 0.0
        raw_fee_paise = 0
        round_off_inr = 0.0
        round_off_paise = 0
    else:
        billable_km = distance_km - config.free_delivery_radius_km
        raw_fee_inr = round(billable_km * (config.delivery_fee_per_km_paise / 100.0), 2)
        rounded_fee_inr = math.ceil(raw_fee_inr)
        round_off_inr = round(rounded_fee_inr - raw_fee_inr, 2)
        raw_fee_paise = round(raw_fee_inr * 100)
        fee_paise = int(rounded_fee_inr * 100)
        round_off_paise = int(round_off_inr * 100)

    return {
        "distance_km": round(distance_km, 2),
        "method": method,
        "delivery_fee_paise": fee_paise,
        "delivery_fee_inr": fee_paise / 100,
        "raw_delivery_fee_inr": raw_fee_inr,
        "raw_delivery_fee_paise": raw_fee_paise,
        "round_off_inr": round_off_inr,
        "round_off_paise": round_off_paise,
        "within_radius": within_radius,
        "max_radius_km": config.delivery_radius_km,
        "free_radius_km": config.free_delivery_radius_km,
        "fee_per_km_paise": config.delivery_fee_per_km_paise,
    }



@app.get("/health", tags=["health"])
def health():
    return {"status": "ok", "service": "kebabzilla-api"}


@app.get(f"{settings.api_prefix}/admin-preview/delivery", tags=["administration"])
def admin_delivery_preview(db: DbSession, account: CurrentAccount):
    """Admin-only read of delivery staff for role preview; enforcement is explicit here."""
    if account.role != Role.ADMIN:
        raise HTTPException(status_code=403, detail="You do not have access to this action")
    people = db.scalars(select(Account).where(Account.role == Role.DELIVERY).order_by(Account.name)).all()
    return [{"id": person.id, "name": person.name, "phone": person.phone} for person in people]
