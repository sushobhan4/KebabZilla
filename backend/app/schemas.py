from datetime import datetime
import re

from email_validator import EmailNotValidError, validate_email
from pydantic import AliasChoices, BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from app.config import settings
from app.models import OrderStatus, PaymentMethod, PaymentStatus, Role


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class AccountCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    phone: str | None = Field(default=None, max_length=32)
    password: str = Field(min_length=10, max_length=128)


class AdminAccountCreate(AccountCreate):
    role: Role


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    password: str

    @field_validator("email")
    @classmethod
    def valid_login_email(cls, value: str) -> str:
        email = value.strip().lower()
        # The local seed account uses a .local address, which is intentionally
        # accepted for development only. Public registration still requires a
        # standard email address, and production login rejects special-use TLDs.
        if settings.environment.casefold() != "production" and re.fullmatch(r"[^@\s]+@[a-z0-9-]+\.local", email):
            return email
        try:
            return validate_email(email, check_deliverability=False).normalized
        except EmailNotValidError as exc:
            raise ValueError("Enter a valid email address") from exc


class AccountOut(ORMModel):
    id: int
    name: str
    # Account emails were validated when accepted. Keep the output as text so
    # development-only .local seed addresses can be returned to the client.
    email: str
    phone: str | None
    addresses: list[dict] = Field(default_factory=list)
    role: Role
    is_active: bool
    created_at: datetime


class SavedAddressInput(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    label: str = Field(min_length=1, max_length=40)
    house_number: str = Field(default="", max_length=120)
    area: str = Field(default="", max_length=160)
    road: str = Field(default="", max_length=160)
    landmark: str = Field(default="", max_length=200)
    city: str = Field(default="", max_length=120)
    pincode: str = Field(default="", max_length=20, validation_alias=AliasChoices("pincode", "postal_code"))
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    is_default: bool = False

    @field_validator("house_number", "road", "area", "city", "pincode", "landmark")
    @classmethod
    def trim_address_parts(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def pinned_address_is_complete(self):
        has_latitude = self.latitude is not None
        has_longitude = self.longitude is not None
        if has_latitude != has_longitude:
            raise ValueError("Save both map coordinates together")
        if has_latitude and any(not getattr(self, field) for field in ("house_number", "road", "area", "city", "pincode")):
            raise ValueError("Complete the house or flat, road, area, city, and PIN code for a pinned address")
        return self


class AccountProfileUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    phone: str | None = Field(default=None, max_length=32)
    addresses: list[SavedAddressInput] | None = Field(default=None, max_length=12)


class PasswordUpdate(BaseModel):
    current_password: str
    new_password: str = Field(min_length=10, max_length=128)


class CartItemUpdate(BaseModel):
    quantity: int = Field(ge=0, le=99)


class CartItemOut(ORMModel):
    menu_item_id: int
    quantity: int


class AccountsPageOut(BaseModel):
    items: list[AccountOut]
    total: int
    limit: int
    offset: int
    role_counts: dict[str, int]
    active_total: int


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    account: AccountOut


class MenuItemInput(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    description: str = Field(default="", max_length=2000)
    category: str = Field(default="", max_length=80)
    price_paise: int = Field(gt=0, le=10_000_000)
    discount_percent: int = Field(default=0, ge=0, le=100)
    discounted_price_paise: int | None = Field(default=None, gt=0, le=10_000_000)
    tax_percent: int = Field(default=18, ge=0, le=30)
    image_url: str | None = Field(default=None, max_length=500)
    image_urls: list[str] = Field(default_factory=list, max_length=20)
    is_vegetarian: bool = False
    is_available: bool = True
    is_featured: bool = False


class MenuItemOut(ORMModel):
    id: int
    name: str
    description: str
    category: str
    price_paise: int
    discount_percent: int
    discounted_price_paise: int | None
    tax_percent: int
    image_url: str | None
    image_urls: list[str]
    is_vegetarian: bool
    is_available: bool
    is_featured: bool
    discount_campaign_name: str | None = None
    popularity_count: int = 0


class MenuCategoryInput(BaseModel):
    name: str = Field(min_length=2, max_length=80)


class MenuCategoryOut(ORMModel):
    id: int
    name: str


class MenuCategoryDeleteOut(BaseModel):
    affected_menus: int


class OrderLineInput(BaseModel):
    menu_item_id: int
    quantity: int = Field(gt=0, le=30)


class OrderCreate(BaseModel):
    items: list[OrderLineInput] = Field(min_length=1, max_length=40)
    payment_method: PaymentMethod
    address: str = Field(default="", max_length=500)
    notes: str = Field(default="", max_length=500)
    scheduled_for: datetime | None = None

    @field_validator("items")
    @classmethod
    def unique_items(cls, items: list[OrderLineInput]) -> list[OrderLineInput]:
        ids = [item.menu_item_id for item in items]
        if len(ids) != len(set(ids)):
            raise ValueError("Each menu item can only appear once; set its quantity instead.")
        return items


class OrderStatusUpdate(BaseModel):
    status: OrderStatus


class OrderOut(BaseModel):
    id: int
    public_id: str
    customer_id: int | None
    customer_name: str
    customer_email: str
    customer_phone: str | None
    status: OrderStatus
    order_type: str
    payment_method: PaymentMethod
    payment_status: PaymentStatus
    subtotal_paise: int
    tax_paise: int
    delivery_fee_paise: int
    total_paise: int
    address: str
    notes: str
    assigned_delivery_id: int | None
    created_at: datetime
    items: list[dict]


class AdminOrdersPageOut(BaseModel):
    items: list[OrderOut]
    total: int
    limit: int
    offset: int
    status_counts: dict[str, int]
    paid_revenue_paise: int


class RestaurantSettingsInput(BaseModel):
    restaurant_name: str = Field(min_length=2, max_length=120)
    tagline: str = Field(max_length=200)
    phone: str = Field(max_length=32)
    address: str = Field(max_length=300)
    weekly_schedule: dict[str, dict[str, str | bool]] = Field(default_factory=dict)
    tax_percent: int = Field(ge=0, le=30)
    delivery_fee_paise: int = Field(ge=0, le=1_000_000)
    minimum_order_paise: int = Field(ge=0, le=10_000_000)
    delivery_radius_km: float = Field(ge=0.1, le=500)
    accepting_orders: bool


class RestaurantSettingsOut(ORMModel):
    id: int
    restaurant_name: str
    tagline: str
    phone: str
    address: str
    weekly_schedule: dict
    tax_percent: int
    delivery_fee_paise: int
    minimum_order_paise: int
    delivery_radius_km: float
    accepting_orders: bool


class DispatchInput(BaseModel):
    delivery_id: int


class BatchCreate(BaseModel):
    order_ids: list[int] = Field(min_length=1, max_length=12)
    route_label: str = Field(default="Nearby route", min_length=2, max_length=120)


class VerifyOtpInput(BaseModel):
    otp: str = Field(pattern=r"^\d{6}$")


class DraftInput(BaseModel):
    customer_name: str = Field(default="Walk-in", max_length=120)
    payload: dict = Field(default_factory=dict)


class MenuPauseInput(BaseModel):
    mode: str = Field(pattern=r"^(today|manual)$")


class OfferInput(BaseModel):
    audience: str = Field(pattern=r"^(ALL|NEW|RETURNING)$")
    channels: list[str] = Field(min_length=1)
    message: str = Field(min_length=2, max_length=1000)

    @field_validator("channels")
    @classmethod
    def valid_channels(cls, value: list[str]) -> list[str]:
        if not value or any(channel not in {"SMS", "EMAIL"} for channel in value):
            raise ValueError("Choose SMS, email, or both")
        return list(dict.fromkeys(value))


class MenuDiscountInput(BaseModel):
    menu_item_ids: list[int] = Field(min_length=1)
    campaign_name: str | None = Field(default=None, max_length=80)
    discount_percent: int = Field(ge=1, le=99)
    starts_at: datetime
    ends_at: datetime

    @model_validator(mode="after")
    def valid_range(self):
        if self.starts_at.tzinfo is None or self.ends_at.tzinfo is None:
            raise ValueError("Discount start and end times must include a timezone")
        if self.ends_at <= self.starts_at:
            raise ValueError("Discount end time must be after its start time")
        if self.campaign_name is not None:
            self.campaign_name = self.campaign_name.strip() or None
        return self
