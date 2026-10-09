from datetime import datetime, timezone
from enum import StrEnum

from sqlalchemy import Boolean, DateTime, Enum, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Role(StrEnum):
    ADMIN = "ADMIN"
    EMPLOYEE = "EMPLOYEE"
    DELIVERY = "DELIVERY"
    USER = "USER"


class OrderStatus(StrEnum):
    PLACED = "PLACED"
    ACCEPTED = "ACCEPTED"
    PREPARING = "PREPARING"
    READY = "READY"
    OUT_FOR_DELIVERY = "OUT_FOR_DELIVERY"
    DELIVERED = "DELIVERED"
    REJECTED = "REJECTED"
    CANCELLED = "CANCELLED"


class PaymentMethod(StrEnum):
    CASH = "CASH"
    RAZORPAY = "RAZORPAY"


class PaymentStatus(StrEnum):
    PENDING = "PENDING"
    PAID = "PAID"
    FAILED = "FAILED"
    REFUND_PENDING = "REFUND_PENDING"
    REFUNDED = "REFUNDED"


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[Role] = mapped_column(Enum(Role, native_enum=False, length=16), default=Role.USER, index=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    addresses: Mapped[list["AccountAddress"]] = relationship(cascade="all, delete-orphan", lazy="selectin")
    sessions: Mapped[list["UserSession"]] = relationship("UserSession", back_populates="account", cascade="all, delete-orphan", lazy="selectin")


class AccountAddress(Base):
    __tablename__ = "account_addresses"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    address_id: Mapped[str] = mapped_column(String(64))
    label: Mapped[str] = mapped_column(String(40))
    house_number: Mapped[str] = mapped_column(String(120), default="")
    area: Mapped[str] = mapped_column(String(160), default="")
    road: Mapped[str] = mapped_column(String(160), default="")
    landmark: Mapped[str] = mapped_column(String(200), default="")
    city: Mapped[str] = mapped_column(String(120), default="")
    pincode: Mapped[str] = mapped_column(String(20), default="")
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    __table_args__ = (UniqueConstraint("account_id", "address_id"),)


class PasswordResetCode(Base):
    __tablename__ = "password_reset_codes"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    otp_hash: Mapped[str] = mapped_column(String(255))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    account: Mapped[Account] = relationship()


class UserSession(Base):
    __tablename__ = "user_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    user_agent: Mapped[str] = mapped_column(String(512), default="")
    ip_address: Mapped[str] = mapped_column(String(64), default="")
    device_fingerprint: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_active_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    is_revoked: Mapped[bool] = mapped_column(Boolean, default=False, index=True)

    account: Mapped[Account] = relationship("Account", back_populates="sessions", lazy="joined")


class MenuItem(Base):
    __tablename__ = "menu_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    category_id: Mapped[int | None] = mapped_column(ForeignKey("menu_categories.id", ondelete="SET NULL"), nullable=True, index=True)
    price_paise: Mapped[int] = mapped_column(Integer)
    paused_by_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True, index=True)
    image_urls: Mapped[list[str]] = mapped_column(JSON, default=list)
    is_vegetarian: Mapped[bool] = mapped_column(Boolean, default=False)
    is_available: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    is_featured: Mapped[bool] = mapped_column(Boolean, default=False)
    is_custom: Mapped[bool] = mapped_column(Boolean, default=False)
    custom_sections: Mapped[list[dict]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    category: Mapped["MenuCategory | None"] = relationship(lazy="joined")


class CustomMenuItem(Base):
    __tablename__ = "custom_menu_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    category_id: Mapped[int | None] = mapped_column(ForeignKey("menu_categories.id", ondelete="SET NULL"), nullable=True, index=True)
    base_price_paise: Mapped[int] = mapped_column(Integer)
    image_urls: Mapped[list[str]] = mapped_column(JSON, default=list)
    is_vegetarian: Mapped[bool] = mapped_column(Boolean, default=False)
    is_available: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    is_featured: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    category: Mapped["MenuCategory | None"] = relationship(lazy="joined")
    sections: Mapped[list["CustomMenuSection"]] = relationship(cascade="all, delete-orphan", order_by="CustomMenuSection.position", lazy="selectin")


class CustomMenuSection(Base):
    __tablename__ = "custom_menu_sections"

    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("custom_menu_items.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))  # e.g. "Kebab Selection"
    position: Mapped[int] = mapped_column(Integer, default=0)
    options: Mapped[list[dict]] = mapped_column(JSON, default=list)  # [{"name": "Chicken Tikka", "extra_paise": 4000}]


class MenuCategory(Base):
    __tablename__ = "menu_categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True, index=True)


class MenuDiscount(Base):
    __tablename__ = "menu_discounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    campaign_name: Mapped[str | None] = mapped_column(String(80), nullable=True)
    discount_percent: Mapped[int] = mapped_column(Integer)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    items: Mapped[list["MenuDiscountItem"]] = relationship(cascade="all, delete-orphan", lazy="selectin")


class MenuDiscountItem(Base):
    __tablename__ = "menu_discount_items"
    __table_args__ = (UniqueConstraint("discount_id", "menu_item_id"),)

    discount_id: Mapped[int] = mapped_column(ForeignKey("menu_discounts.id", ondelete="CASCADE"), primary_key=True)
    menu_item_id: Mapped[int] = mapped_column(ForeignKey("menu_items.id", ondelete="CASCADE"), primary_key=True)


class RestaurantSettings(Base):
    __tablename__ = "restaurant_settings"

    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    restaurant_name: Mapped[str] = mapped_column(String(120), default="KebabZilla")
    tagline: Mapped[str] = mapped_column(String(200), default="Fire up your cravings.")
    phone: Mapped[str] = mapped_column(String(32), default="")
    address: Mapped[str] = mapped_column(String(300), default="")
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    weekly_schedule: Mapped[dict] = mapped_column(JSON, default=dict)
    tax_percent: Mapped[int] = mapped_column(Integer, default=18)
    minimum_order_paise: Mapped[int] = mapped_column(Integer, default=19900)
    delivery_radius_km: Mapped[float] = mapped_column(Float, default=10.0, server_default="10")
    free_delivery_radius_km: Mapped[float] = mapped_column(Float, default=3.0, server_default="3")
    delivery_fee_per_km_paise: Mapped[int] = mapped_column(Integer, default=1000, server_default="1000")
    accepting_orders: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class Order(Base):
    __tablename__ = "orders"

    order_id: Mapped[str] = mapped_column(String(20), primary_key=True)
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"), nullable=True, index=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"), nullable=True)
    assigned_delivery_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"), nullable=True, index=True)
    status: Mapped[OrderStatus] = mapped_column(Enum(OrderStatus, native_enum=False, length=24), default=OrderStatus.PLACED, index=True)
    order_type: Mapped[str] = mapped_column(String(16), default="DELIVERY")
    delivery_fee_paise: Mapped[int] = mapped_column(Integer, default=0)
    scheduled_for: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[str] = mapped_column(String(500), default="")
    customer_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    customer_phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    delivery_otp_ciphertext: Mapped[str | None] = mapped_column(String(500), nullable=True)
    delivery_otp_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    customer: Mapped[Account | None] = relationship(foreign_keys=[customer_id])
    delivery: Mapped[Account | None] = relationship(foreign_keys=[assigned_delivery_id])
    items: Mapped[list["OrderItem"]] = relationship(cascade="all, delete-orphan", lazy="selectin")
    payment: Mapped["Payment | None"] = relationship(back_populates="order", uselist=False, cascade="all, delete-orphan")


class OrderItem(Base):
    __tablename__ = "order_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.order_id", ondelete="CASCADE"), index=True)
    menu_item_id: Mapped[int | None] = mapped_column(ForeignKey("menu_items.id", ondelete="SET NULL"), nullable=True)
    menu_item: Mapped[MenuItem | None] = relationship(lazy="joined")
    quantity: Mapped[int] = mapped_column(Integer)
    customizations: Mapped[list[dict]] = mapped_column(JSON, default=list)
    unit_price_paise: Mapped[int | None] = mapped_column(Integer, nullable=True)


class CartItem(Base):
    __tablename__ = "cart_items"
    __table_args__ = (UniqueConstraint("customer_id", "menu_item_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    menu_item_id: Mapped[int] = mapped_column(ForeignKey("menu_items.id", ondelete="CASCADE"), index=True)
    quantity: Mapped[int] = mapped_column(Integer)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    menu_item: Mapped[MenuItem] = relationship(lazy="joined")


class DraftOrder(Base):
    __tablename__ = "draft_orders"

    id: Mapped[int] = mapped_column(primary_key=True)
    created_by_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), index=True)
    customer_name: Mapped[str] = mapped_column(String(120), default="Walk-in")
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class DeliveryBatch(Base):
    __tablename__ = "delivery_batches"

    id: Mapped[int] = mapped_column(primary_key=True)
    delivery_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), index=True)
    route_label: Mapped[str] = mapped_column(String(120), default="Nearby route")
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    orders: Mapped[list["DeliveryBatchOrder"]] = relationship(cascade="all, delete-orphan", lazy="selectin")


class DeliveryBatchOrder(Base):
    __tablename__ = "delivery_batch_orders"
    __table_args__ = (UniqueConstraint("batch_id", "order_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int] = mapped_column(ForeignKey("delivery_batches.id", ondelete="CASCADE"), index=True)
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.order_id", ondelete="CASCADE"), index=True)


class Payment(Base):
    __tablename__ = "payments"

    order_id: Mapped[str] = mapped_column(ForeignKey("orders.order_id", ondelete="CASCADE"), primary_key=True)
    method: Mapped[PaymentMethod] = mapped_column(Enum(PaymentMethod, native_enum=False, length=16))
    status: Mapped[PaymentStatus] = mapped_column(Enum(PaymentStatus, native_enum=False, length=16), default=PaymentStatus.PENDING)
    amount_paise: Mapped[int] = mapped_column(Integer)
    gateway_order_id: Mapped[str | None] = mapped_column(String(120), unique=True, nullable=True)
    gateway_payment_id: Mapped[str | None] = mapped_column(String(120), unique=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    order: Mapped[Order] = relationship(back_populates="payment")


class AdminEvent(Base):
    __tablename__ = "admin_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    event_type: Mapped[str] = mapped_column(String(40), index=True)
    message: Mapped[str] = mapped_column(String(500))
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    actor: Mapped[Account | None] = relationship(lazy="joined")


class OfferLog(Base):
    __tablename__ = "offer_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    actor_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"))
    audience: Mapped[str] = mapped_column(String(40))
    channels: Mapped[list[str]] = mapped_column(JSON, default=list)
    subject: Mapped[str] = mapped_column(String(160), default="A little something from KebabZilla")
    message: Mapped[str] = mapped_column(Text)
    delivery_counts: Mapped[dict] = mapped_column(JSON, default=dict)
    recipient_count: Mapped[int] = mapped_column(Integer, default=0)
    sent_count: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(30), default="PENDING")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
