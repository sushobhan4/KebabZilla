from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import admin, auth, delivery, menu, orders, payments, staff
from app.services import restaurant_settings
from app.dependencies import DbSession

app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    description="Role-secured restaurant ordering, payments, and operations API.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Razorpay-Signature"],
)

for route_module in (auth, menu, orders, staff, delivery, admin, payments):
    app.include_router(route_module.router, prefix=settings.api_prefix)


@app.get(f"{settings.api_prefix}/restaurant", tags=["restaurant"])
def public_restaurant(db: DbSession):
    config = restaurant_settings(db)
    return {
        "restaurant_name": config.restaurant_name,
        "tagline": config.tagline,
        "phone": config.phone,
        "address": config.address,
        "opening_hours": config.opening_hours,
        "tax_percent": config.tax_percent,
        "delivery_fee_paise": config.delivery_fee_paise,
        "minimum_order_paise": config.minimum_order_paise,
        "delivery_radius_km": config.delivery_radius_km,
        "accepting_orders": config.accepting_orders,
    }


@app.get("/health", tags=["health"])
def health():
    return {"status": "ok", "service": "kebabzilla-api"}
