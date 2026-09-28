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
    addresses: Mapped[list[dict]] = mapped_column(JSON, default=list)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[Role] = mapped_column(Enum(Role, native_enum=False, length=16), default=Role.USER, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class MenuItem(Base):
    __tablename__ = "menu_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(80), index=True)
    price_paise: Mapped[int] = mapped_column(Integer)
    tax_percent: Mapped[int] = mapped_column(Integer, default=18)
    image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    image_urls: Mapped[list[str]] = mapped_column(JSON, default=list)
    is_vegetarian: Mapped[bool] = mapped_column(Boolean, default=False)
    is_available: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    is_featured: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class MenuCategory(Base):
    __tablename__ = "menu_categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True, index=True)


class RestaurantSettings(Base):
    __tablename__ = "restaurant_settings"

    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    restaurant_name: Mapped[str] = mapped_column(String(120), default="KebabZilla")
    tagline: Mapped[str] = mapped_column(String(200), default="Fire up your cravings.")
    phone: Mapped[str] = mapped_column(String(32), default="")
    address: Mapped[str] = mapped_column(String(300), default="")
    opening_hours: Mapped[str] = mapped_column(String(120), default="")
    tax_percent: Mapped[int] = mapped_column(Integer, default=18)
    delivery_fee_paise: Mapped[int] = mapped_column(Integer, default=3500)
    minimum_order_paise: Mapped[int] = mapped_column(Integer, default=19900)
    delivery_radius_km: Mapped[float] = mapped_column(Float, default=10.0, server_default="10")
    accepting_orders: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(primary_key=True)
    public_id: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"), nullable=True, index=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"), nullable=True)
    assigned_delivery_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"), nullable=True, index=True)
    status: Mapped[OrderStatus] = mapped_column(Enum(OrderStatus, native_enum=False, length=24), default=OrderStatus.PLACED, index=True)
    order_type: Mapped[str] = mapped_column(String(16), default="DELIVERY")
    payment_method: Mapped[PaymentMethod] = mapped_column(Enum(PaymentMethod, native_enum=False, length=16))
    payment_status: Mapped[PaymentStatus] = mapped_column(Enum(PaymentStatus, native_enum=False, length=16), default=PaymentStatus.PENDING)
    subtotal_paise: Mapped[int] = mapped_column(Integer)
    tax_paise: Mapped[int] = mapped_column(Integer)
    delivery_fee_paise: Mapped[int] = mapped_column(Integer, default=0)
    total_paise: Mapped[int] = mapped_column(Integer)
    address: Mapped[str] = mapped_column(String(500), default="")
    notes: Mapped[str] = mapped_column(String(500), default="")
    customer_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    customer_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    customer_phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    delivery_otp_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    delivery_otp_ciphertext: Mapped[str | None] = mapped_column(String(500), nullable=True)
    delivery_otp_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    customer: Mapped[Account | None] = relationship(foreign_keys=[customer_id])
    items: Mapped[list["OrderItem"]] = relationship(cascade="all, delete-orphan", lazy="selectin")


class OrderItem(Base):
    __tablename__ = "order_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    menu_item_id: Mapped[int | None] = mapped_column(ForeignKey("menu_items.id", ondelete="SET NULL"), nullable=True)
    menu_item: Mapped[MenuItem | None] = relationship(lazy="joined")
    item_name: Mapped[str] = mapped_column(String(120))
    unit_price_paise: Mapped[int] = mapped_column(Integer)
    tax_percent: Mapped[int] = mapped_column(Integer, default=18)
    quantity: Mapped[int] = mapped_column(Integer)


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
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), unique=True, index=True)
    method: Mapped[PaymentMethod] = mapped_column(Enum(PaymentMethod, native_enum=False, length=16))
    status: Mapped[PaymentStatus] = mapped_column(Enum(PaymentStatus, native_enum=False, length=16), default=PaymentStatus.PENDING)
    amount_paise: Mapped[int] = mapped_column(Integer)
    gateway_order_id: Mapped[str | None] = mapped_column(String(120), unique=True, nullable=True)
    gateway_payment_id: Mapped[str | None] = mapped_column(String(120), unique=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
