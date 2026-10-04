from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import admin, auth, cart, delivery, menu, orders, payments, staff
from app.services import restaurant_settings
from app.dependencies import CurrentAccount, DbSession
from app.models import Account, Role
from sqlalchemy import select

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

for route_module in (auth, menu, cart, orders, staff, delivery, admin, payments):
    app.include_router(route_module.router, prefix=settings.api_prefix)


@app.get(f"{settings.api_prefix}/restaurant", tags=["restaurant"])
def public_restaurant(db: DbSession):
    config = restaurant_settings(db)
    return {
        "restaurant_name": config.restaurant_name,
        "tagline": config.tagline,
        "phone": config.phone,
        "address": config.address,
        "tax_percent": config.tax_percent,
        "minimum_order_paise": config.minimum_order_paise,
        "delivery_radius_km": config.delivery_radius_km,
        "free_delivery_radius_km": config.free_delivery_radius_km,
        "delivery_fee_per_km_paise": config.delivery_fee_per_km_paise,
        "accepting_orders": config.accepting_orders,
        "weekly_schedule": config.weekly_schedule or {},
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
