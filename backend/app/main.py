from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

import math
from sqlalchemy import select

from app.config import settings
from app.routers import admin, auth, cart, custom_menu, delivery, menu, orders, payments, staff
from app.schemas import PublicRestaurantOut
from app.services import calculate_delivery_distance, is_restaurant_open, restaurant_settings
from app.dependencies import CurrentAccount, DbSession
from app.models import Account, Role

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
is_dev = settings.environment.casefold() != "production"
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=r"^https://.*\.trycloudflare\.com$" if is_dev else None,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Razorpay-Signature", "X-CSRF-Token"],
    expose_headers=["X-CSRF-Token"],
)

for route_module in (auth, menu, cart, orders, staff, delivery, admin, payments, custom_menu):
    app.include_router(route_module.router, prefix=settings.api_prefix)



def format_public_weekly_schedule(raw_schedule: dict | None) -> dict:
    if not isinstance(raw_schedule, dict):
        return {}
    all_days = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
    clean = {}
    custom_schedules = raw_schedule.get("custom_schedules")
    for day in all_days:
        day_data = raw_schedule.get(day)
        if isinstance(day_data, dict) and "open" in day_data:
            clean[day] = {
                "open": bool(day_data.get("open", False)),
                "opens": str(day_data.get("opens", "10:00")),
                "closes": str(day_data.get("closes", "22:00")),
            }
        elif isinstance(custom_schedules, list):
            matching = [s for s in custom_schedules if isinstance(s, dict) and day in (s.get("days") or [])]
            if matching:
                clean[day] = {
                    "open": True,
                    "opens": str(matching[0].get("start_time", "10:00")),
                    "closes": str(matching[0].get("end_time", "22:00")),
                }
            else:
                clean[day] = {
                    "open": False,
                    "opens": "10:00",
                    "closes": "22:00",
                }
    return clean


from app.cache import KEY_PUBLIC_RESTAURANT, cache


@app.get(f"{settings.api_prefix}/restaurant", tags=["restaurant"], response_model=PublicRestaurantOut)
def public_restaurant(db: DbSession, response: Response):
    cached = cache.get(KEY_PUBLIC_RESTAURANT)
    if cached is not None:
        response.headers["Cache-Control"] = "public, max-age=10, stale-while-revalidate=30"
        return cached

    config = restaurant_settings(db)
    is_open, _ = is_restaurant_open(config)
    phones = [p.strip() for p in (config.phone or "").split(",") if p.strip()]
    data = {
        "restaurant_name": config.restaurant_name,
        "tagline": config.tagline,
        "phone": config.phone,
        "phones": phones,
        "address": config.address,
        "latitude": config.latitude,
        "longitude": config.longitude,
        "minimum_order_paise": config.minimum_order_paise,
        "delivery_radius_km": config.delivery_radius_km,
        "free_delivery_radius_km": config.free_delivery_radius_km,
        "delivery_fee_per_km_paise": config.delivery_fee_per_km_paise,
        "charge_from_zero_beyond_free_radius": getattr(config, "charge_from_zero_beyond_free_radius", False) or False,
        "accepting_orders": is_open,
        "is_restaurant_open": is_open,
        "weekly_schedule": format_public_weekly_schedule(config.weekly_schedule),
        "google_client_id": settings.google_client_id,
        "google_maps_api_key": settings.google_maps_api_key,
    }
    cache.set(KEY_PUBLIC_RESTAURANT, data, ttl_seconds=15.0)
    response.headers["Cache-Control"] = "public, max-age=10, stale-while-revalidate=30"
    return data


@app.get(f"{settings.api_prefix}/restaurant/delivery-estimate", tags=["restaurant"])
def estimate_delivery(latitude: float, longitude: float, db: DbSession):
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
        charge_from_zero = getattr(config, "charge_from_zero_beyond_free_radius", False)
        billable_km = distance_km if charge_from_zero else (distance_km - config.free_delivery_radius_km)
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
