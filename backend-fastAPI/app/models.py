from datetime import datetime, timezone
from enum import StrEnum

from sqlalchemy import Boolean, Column, DateTime, Enum, Float, ForeignKey, Integer, JSON, String, Table, Text, UniqueConstraint, and_
from sqlalchemy.orm import Mapped, foreign, mapped_column, relationship

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
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[Role] = mapped_column(Enum(Role, native_enum=False, length=16), default=Role.USER, index=True)
    promotional_consent: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    addresses: Mapped[list["AccountAddress"]] = relationship(cascade="all, delete-orphan", lazy="selectin")
    sessions: Mapped[list["UserSession"]] = relationship("UserSession", back_populates="account", cascade="all, delete-orphan", lazy="selectin")
    staff_info: Mapped["StaffInfo | None"] = relationship(back_populates="account", uselist=False, cascade="all, delete-orphan", lazy="joined")

    @property
    def delivery_duty(self) -> "StaffInfo | None":
        return self.staff_info

    @delivery_duty.setter
    def delivery_duty(self, value: "StaffInfo | None") -> None:
        self.staff_info = value

    @property
    def is_accepting_deliveries(self) -> bool:
        if self.role not in (Role.ADMIN, Role.DELIVERY):
            return False
        return bool(self.staff_info and self.staff_info.is_accepting_deliveries)

    @is_accepting_deliveries.setter
    def is_accepting_deliveries(self, value: bool) -> None:
        if self.role not in (Role.ADMIN, Role.DELIVERY):
            return
        if self.staff_info is None:
            self.staff_info = StaffInfo(account_id=self.id, role=self.role, is_accepting_deliveries=bool(value), must_change_password=False)
        else:
            self.staff_info.is_accepting_deliveries = bool(value)

    @property
    def must_change_password(self) -> bool:
        if self.role == Role.USER:
            return False
        return bool(self.staff_info and self.staff_info.must_change_password)

    @must_change_password.setter
    def must_change_password(self, value: bool) -> None:
        if self.role == Role.USER:
            return
        if self.staff_info is None:
            self.staff_info = StaffInfo(account_id=self.id, role=self.role, is_accepting_deliveries=False, must_change_password=bool(value))
        else:
            self.staff_info.must_change_password = bool(value)


class StaffInfo(Base):
    __tablename__ = "staff_info"

    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True)
    role: Mapped[Role | None] = mapped_column(Enum(Role, native_enum=False, length=16), nullable=True)
    is_accepting_deliveries: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0", nullable=False)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0", nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    account: Mapped["Account"] = relationship(back_populates="staff_info")


# Backward compatibility alias
DeliveryDuty = StaffInfo


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
    distance_meters: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    __table_args__ = (UniqueConstraint("account_id", "address_id"),)


class AllOtp(Base):
    __tablename__ = "all_otp"

    id: Mapped[int] = mapped_column(primary_key=True)
    purpose: Mapped[str] = mapped_column(String(32), default="2fa", index=True)  # "2fa", "forgot_password", "delivery", "register"
    otp_code: Mapped[str] = mapped_column(String(255))
    token_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True, index=True)
    account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), nullable=True, index=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    order_id: Mapped[str | None] = mapped_column(ForeignKey("orders.order_id", ondelete="CASCADE"), nullable=True, index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    account: Mapped["Account | None"] = relationship()
    order: Mapped["Order | None"] = relationship("Order", back_populates="delivery_otp_record")

    # Backward compatibility properties
    @property
    def code_hash(self) -> str:
        return self.otp_code

    @code_hash.setter
    def code_hash(self, val: str) -> None:
        self.otp_code = val

    @property
    def otp_hash(self) -> str:
        return self.otp_code

    @otp_hash.setter
    def otp_hash(self, val: str) -> None:
        self.otp_code = val


# Compatibility aliases
TwoFactorChallenge = AllOtp
EmailVerificationCode = AllOtp
PasswordResetCode = AllOtp


class UserSession(Base):
    __tablename__ = "user_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    previous_token_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    grace_period_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    user_agent: Mapped[str] = mapped_column(String(512), default="")
    ip_address: Mapped[str] = mapped_column(String(64), default="")
    device_fingerprint: Mapped[str] = mapped_column(String(64), default="")
    device_name: Mapped[str] = mapped_column(String(128), default="")
    country: Mapped[str] = mapped_column(String(64), default="")
    region: Mapped[str] = mapped_column(String(64), default="")
    city: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_active_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    is_revoked: Mapped[bool] = mapped_column(Boolean, default=False, index=True)

    account: Mapped[Account] = relationship("Account", back_populates="sessions", lazy="joined")


menu_item_categories = Table(
    "menu_item_categories",
    Base.metadata,
    Column("menu_item_id", Integer, primary_key=True),
    Column("category_id", Integer, ForeignKey("menu_categories.id", ondelete="CASCADE"), primary_key=True),
)


class MenuItem(Base):
    __tablename__ = "menu_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    price_paise: Mapped[int] = mapped_column(Integer)
    paused_by_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True, index=True)
    paused_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    image_urls: Mapped[list[str]] = mapped_column(JSON, default=list)
    is_vegetarian: Mapped[bool] = mapped_column(Boolean, default=False)
    is_available: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    is_featured: Mapped[bool] = mapped_column(Boolean, default=False)
    is_customizable: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    variations: Mapped[list[dict]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    @property
    def category_id(self) -> int | None:
        return self.categories[0].id if self.categories else None

    @property
    def category(self) -> "MenuCategory | None":
        return self.categories[0] if self.categories else None

    @property
    def base_price_paise(self) -> int:
        return self.price_paise

    @base_price_paise.setter
    def base_price_paise(self, value: int) -> None:
        self.price_paise = value
    categories: Mapped[list["MenuCategory"]] = relationship(
        secondary=menu_item_categories,
        primaryjoin="MenuItem.id == menu_item_categories.c.menu_item_id",
        secondaryjoin="MenuCategory.id == menu_item_categories.c.category_id",
        lazy="selectin",
        overlaps="categories",
    )
    sections: Mapped[list["MenuSection"]] = relationship("MenuSection", back_populates="menu_item", cascade="all, delete-orphan", order_by="MenuSection.position", lazy="selectin")


class MenuSection(Base):
    __tablename__ = "menu_sections"

    id: Mapped[int] = mapped_column(primary_key=True)
    menu_item_id: Mapped[int] = mapped_column(ForeignKey("menu_items.id", ondelete="CASCADE"), index=True)
    section_type: Mapped[str] = mapped_column(String(20), default="CUSTOM")  # "VARIATION" or "CUSTOM"
    name: Mapped[str] = mapped_column(String(120))  # e.g. "Kebab Selection"
    position: Mapped[int] = mapped_column(Integer, default=0)
    required: Mapped[bool] = mapped_column(Boolean, default=True)
    options: Mapped[list[dict]] = mapped_column(JSON, default=list)

    menu_item: Mapped[MenuItem] = relationship("MenuItem", back_populates="sections")

    @property
    def item_id(self) -> int:
        return self.menu_item_id

    @item_id.setter
    def item_id(self, val: int) -> None:
        self.menu_item_id = val


# Compatibility alias
CustomMenuItem = MenuItem
CustomMenuSection = MenuSection


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

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    discount_id: Mapped[int] = mapped_column(ForeignKey("menu_discounts.id", ondelete="CASCADE"), index=True)
    menu_item_id: Mapped[int] = mapped_column(ForeignKey("menu_items.id", ondelete="CASCADE"), index=True)

    menu_item: Mapped[MenuItem | None] = relationship(foreign_keys=[menu_item_id], lazy="joined")

    @property
    def custom_menu_item_id(self) -> int | None:
        return None


class RestaurantSettings(Base):
    __tablename__ = "restaurant_settings"

    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    restaurant_name: Mapped[str] = mapped_column(String(120), default="KebabZilla")
    tagline: Mapped[str] = mapped_column(String(200), default="Fire up your cravings.")
    phone: Mapped[str] = mapped_column(String(300), default="")
    email: Mapped[str] = mapped_column(String(255), default="support@kebabzilla.in", server_default="support@kebabzilla.in")
    address: Mapped[str] = mapped_column(String(300), default="")
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    weekly_schedule: Mapped[dict] = mapped_column(JSON, default=dict)
    minimum_order_paise: Mapped[int] = mapped_column(Integer, default=19900)
    delivery_radius_km: Mapped[float] = mapped_column(Float, default=10.0, server_default="10")
    free_delivery_radius_km: Mapped[float] = mapped_column(Float, default=3.0, server_default="3")
    free_delivery_threshold_paise: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    delivery_fee_per_km_paise: Mapped[int] = mapped_column(Integer, default=1000, server_default="1000")
    accepting_orders: Mapped[bool] = mapped_column(Boolean, default=True)
    is_delivery_open: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
    order_cutoff_minutes_before_closing: Mapped[int] = mapped_column(Integer, default=30, server_default="30")
    delivery_paused_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, default=None)
    admin_override_state: Mapped[bool | None] = mapped_column(Boolean, nullable=True, default=None)
    admin_override_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, default=None)

    @property
    def admin_override_open(self) -> bool:
        return self.admin_override_state is True

    @property
    def is_restaurant_open(self) -> bool:
        return self.accepting_orders

    @is_restaurant_open.setter
    def is_restaurant_open(self, val: bool) -> None:
        self.accepting_orders = val

    @property
    def delivery_paused_reason(self) -> str:
        if isinstance(self.weekly_schedule, dict) and self.weekly_schedule.get("delivery_paused_reason"):
            return str(self.weekly_schedule["delivery_paused_reason"]).strip() or "Delivery is currently unavailable"
        return "Delivery is currently unavailable"

    @delivery_paused_reason.setter
    def delivery_paused_reason(self, val: str | None) -> None:
        if not isinstance(self.weekly_schedule, dict):
            self.weekly_schedule = {}
        sched = dict(self.weekly_schedule)
        if val is not None:
            cleaned = str(val).strip()
            sched["delivery_paused_reason"] = cleaned if cleaned else "Delivery is currently unavailable"
        else:
            sched["delivery_paused_reason"] = "Delivery is currently unavailable"
        self.weekly_schedule = sched

    enforce_driver_geofence: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    driver_geofence_meters: Mapped[int] = mapped_column(Integer, default=500, server_default="500")
    haversine_routing_factor: Mapped[float] = mapped_column(Float, default=1.3627, server_default="1.3627")
    average_delivery_speed_kmh: Mapped[float] = mapped_column(Float, default=30.0, server_default="30.0")
    customer_sla_minutes: Mapped[float] = mapped_column(Float, default=36.0, server_default="36.0")
    alns_max_iterations_mode: Mapped[str] = mapped_column(String(10), default="AUTO", server_default="AUTO")
    alns_max_iterations: Mapped[int] = mapped_column(Integer, default=220, server_default="220")
    max_orders_per_driver: Mapped[int] = mapped_column(Integer, default=5, server_default="5")
    charge_from_zero_beyond_free_radius: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
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
    address: Mapped[str] = mapped_column(Text, default="", server_default="")
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    customer_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    customer_phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    delivery_otp_ciphertext: Mapped[str | None] = mapped_column(String(500), nullable=True)
    delivery_otp_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    delivery_otp_attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    delivery_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    customer: Mapped[Account | None] = relationship(foreign_keys=[customer_id], lazy="selectin")
    delivery: Mapped[Account | None] = relationship(foreign_keys=[assigned_delivery_id], lazy="selectin")
    items: Mapped[list["OrderItem"]] = relationship(cascade="all, delete-orphan", lazy="selectin")
    payment: Mapped["Payment | None"] = relationship(back_populates="order", uselist=False, cascade="all, delete-orphan", lazy="selectin")
    delivery_otp_record: Mapped["AllOtp | None"] = relationship(
        "AllOtp",
        primaryjoin="and_(foreign(AllOtp.order_id) == Order.order_id, AllOtp.purpose == 'delivery')",
        uselist=False,
        cascade="all, delete-orphan",
        lazy="selectin",
        back_populates="order",
    )

    @property
    def payment_method(self) -> "PaymentMethod | None":
        return self.payment.method if self.payment else None

    @property
    def payment_status(self) -> "PaymentStatus | None":
        return self.payment.status if self.payment else None

    @property
    def customer_email(self) -> str | None:
        return self.customer.email if self.customer else None


class OrderItem(Base):
    __tablename__ = "order_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.order_id", ondelete="CASCADE"), index=True)
    menu_item_id: Mapped[int | None] = mapped_column(ForeignKey("menu_items.id", ondelete="SET NULL"), nullable=True, index=True)
    menu_item: Mapped[MenuItem | None] = relationship(foreign_keys=[menu_item_id], lazy="joined")
    variation_name: Mapped[str | None] = mapped_column(String(60), nullable=True)
    quantity: Mapped[int] = mapped_column(Integer)
    unit_price_paise: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    customizations: Mapped[list[dict]] = mapped_column(JSON, default=list)

    @property
    def custom_menu_item_id(self) -> None:
        return None

    @property
    def custom_menu_item(self) -> MenuItem | None:
        return self.menu_item

    @property
    def line_total_paise(self) -> int:
        unit = self.unit_price_paise or (self.menu_item.price_paise if self.menu_item else 0)
        return unit * (self.quantity or 1)


class CartItem(Base):
    __tablename__ = "cart_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    menu_id: Mapped[int] = mapped_column(ForeignKey("menu_items.id", ondelete="CASCADE"), index=True)
    variation_name: Mapped[str | None] = mapped_column(String(60), nullable=True)
    quantity: Mapped[int] = mapped_column(Integer)
    customizations: Mapped[list[dict]] = mapped_column(JSON, default=list)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    menu_item: Mapped[MenuItem | None] = relationship(foreign_keys=[menu_id], lazy="joined")

    @property
    def unit_price_paise(self) -> int:
        if not self.menu_item:
            return 0
        item = self.menu_item
        disc = getattr(item, "discount_percent", 0) or 0
        base = item.price_paise
        if self.variation_name and item.variations:
            matched = next((v for v in item.variations if isinstance(v, dict) and v.get("name", "").lower() == self.variation_name.lower()), None)
            if matched:
                base = matched.get("price_paise", base)
        extra = sum(c.get("extra_paise", 0) for c in (self.customizations or []) if isinstance(c, dict) and c.get("name") != self.variation_name)
        total = base + extra
        return ((total * (100 - disc) + 50) // 100) if disc else total

    @property
    def menu_item_id(self) -> int:
        return self.menu_id

    @menu_item_id.setter
    def menu_item_id(self, val: int) -> None:
        self.menu_id = val

    @property
    def custom_menu_item_id(self) -> None:
        return None


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
    status: Mapped[str] = mapped_column(String(30), default="PENDING")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    @property
    def recipient_count(self) -> int:
        if not self.delivery_counts or not isinstance(self.delivery_counts, dict):
            return 0
        return sum(
            c.get("recipient_count", 0) for c in self.delivery_counts.values() if isinstance(c, dict)
        )

    @property
    def sent_count(self) -> int:
        if not self.delivery_counts or not isinstance(self.delivery_counts, dict):
            return 0
        return sum(
            c.get("sent_count", 0) for c in self.delivery_counts.values() if isinstance(c, dict)
        )
