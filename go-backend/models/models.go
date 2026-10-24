package models

import (
	"time"
)

type Role string

const (
	RoleUser     Role = "USER"
	RoleEmployee Role = "EMPLOYEE"
	RoleDelivery Role = "DELIVERY"
	RoleAdmin    Role = "ADMIN"
)

type Account struct {
	ID                 uint             `gorm:"primaryKey" json:"id"`
	Email              string           `gorm:"uniqueIndex;size:255;not null" json:"email"`
	Name               string           `gorm:"size:255;not null" json:"name"`
	Phone              *string          `gorm:"size:32" json:"phone"`
	PasswordHash       *string          `gorm:"column:password_hash;size:255" json:"-"`
	Role               Role             `gorm:"size:32;default:'USER';not null" json:"role"`
	PromotionalConsent bool             `gorm:"column:promotional_consent;default:true" json:"promotional_consent"`
	CreatedAt          time.Time        `gorm:"column:created_at" json:"created_at"`

	// Virtual/Joined fields (not physical columns on `accounts` table)
	IsActive           bool             `gorm:"-" json:"is_active"`
	MustChangePassword bool             `gorm:"-" json:"must_change_password"`
	IsAcceptingDeliveries bool          `gorm:"-" json:"is_accepting_deliveries"`
	Sessions           []UserSession    `gorm:"foreignKey:AccountID" json:"-"`
	StaffInfo          *StaffInfo       `gorm:"foreignKey:AccountID" json:"staff_info,omitempty"`
	Addresses          []AccountAddress `gorm:"foreignKey:AccountID" json:"addresses,omitempty"`
}

func (a *Account) GetPasswordHash() string {
	if a.PasswordHash != nil && *a.PasswordHash != "" {
		return *a.PasswordHash
	}
	return ""
}

type UserSession struct {
	ID                uint       `gorm:"primaryKey" json:"id"`
	AccountID         uint       `gorm:"index;not null" json:"account_id"`
	TokenHash         string     `gorm:"uniqueIndex;size:64;not null" json:"-"`
	PreviousTokenHash *string    `gorm:"index;size:64" json:"-"`
	GracePeriodUntil  *time.Time `json:"-"`
	UserAgent         string     `gorm:"size:512" json:"user_agent"`
	IPAddress         string     `gorm:"size:64" json:"ip_address"`
	DeviceFingerprint string     `gorm:"size:64" json:"device_fingerprint"`
	DeviceName        string     `gorm:"size:128" json:"device_name"`
	Country           string     `gorm:"size:64" json:"country"`
	Region            string     `gorm:"size:64" json:"region"`
	City              string     `gorm:"size:64" json:"city"`
	CreatedAt         time.Time  `json:"created_at"`
	LastActiveAt      time.Time  `json:"last_active_at"`
	ExpiresAt         time.Time  `json:"expires_at"`
	IsRevoked         bool       `gorm:"default:false;not null" json:"is_revoked"`
}

func (UserSession) TableName() string {
	return "user_sessions"
}

type StaffInfo struct {
	AccountID            uint      `gorm:"primaryKey;column:account_id" json:"account_id"`
	Role                 *Role     `gorm:"size:32;column:role" json:"role"`
	IsAcceptingDeliveries bool     `gorm:"default:false;column:is_accepting_deliveries;not null" json:"is_accepting_deliveries"`
	MustChangePassword   bool      `gorm:"default:false;column:must_change_password;not null" json:"must_change_password"`
	UpdatedAt            time.Time `gorm:"column:updated_at" json:"updated_at"`
}

func (StaffInfo) TableName() string {
	return "staff_info"
}

type AllOtp struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Purpose   string    `gorm:"column:purpose;size:32;not null;index" json:"purpose"` // "2fa", "forgot_password", "registration", "delivery"
	OtpCode   string    `gorm:"column:otp_code;size:255;not null" json:"-"`
	TokenHash *string   `gorm:"column:token_hash;size:64;uniqueIndex" json:"token_hash,omitempty"`
	AccountID *uint     `gorm:"column:account_id;index" json:"account_id,omitempty"`
	Email     *string   `gorm:"column:email;size:255;index" json:"email,omitempty"`
	OrderID   *string   `gorm:"column:order_id;size:20;index" json:"order_id,omitempty"`
	Attempts  int       `gorm:"column:attempts;default:0;not null" json:"attempts"`
	ExpiresAt time.Time `gorm:"column:expires_at;index" json:"expires_at"`
	CreatedAt time.Time `gorm:"column:created_at;index" json:"created_at"`
}

func (AllOtp) TableName() string {
	return "all_otp"
}

type AccountAddress struct {
	ID             uint      `gorm:"primaryKey" json:"-"`
	AccountID      uint      `gorm:"column:account_id;index;not null" json:"account_id"`
	AddressID      string    `gorm:"column:address_id;size:64;not null" json:"id"`
	Label          string    `gorm:"column:label;size:64;not null" json:"label"`
	HouseNumber    string    `gorm:"column:house_number;size:128" json:"house_number"`
	Area           string    `gorm:"column:area;size:128" json:"area"`
	Road           string    `gorm:"column:road;size:128" json:"road"`
	Landmark       string    `gorm:"column:landmark;size:128" json:"landmark"`
	City           string    `gorm:"column:city;size:128" json:"city"`
	Pincode        string    `gorm:"column:pincode;size:32" json:"pincode"`
	Latitude       *float64  `gorm:"column:latitude" json:"latitude"`
	Longitude      *float64  `gorm:"column:longitude" json:"longitude"`
	IsDefault      bool      `gorm:"column:is_default;default:false;not null" json:"is_default"`
	DistanceMeters *int      `gorm:"column:distance_meters" json:"distance_meters"`
	CreatedAt      time.Time `gorm:"column:created_at" json:"created_at"`
}

func (AccountAddress) TableName() string {
	return "account_addresses"
}

type CartItem struct {
	ID             uint      `gorm:"primaryKey" json:"id"`
	CustomerID     uint      `gorm:"column:customer_id;index;not null" json:"customer_id"`
	MenuID         uint      `gorm:"column:menu_id;index;not null" json:"menu_id"`
	VariationName  *string   `gorm:"column:variation_name;size:60" json:"variation_name"`
	Quantity       int       `gorm:"column:quantity;not null" json:"quantity"`
	Customizations string    `gorm:"column:customizations;type:json;default:'[]';not null" json:"customizations"`
	UpdatedAt      time.Time `gorm:"column:updated_at" json:"updated_at"`
}

func (CartItem) TableName() string {
	return "cart_items"
}

type Category struct {
	ID   uint   `gorm:"primaryKey" json:"id"`
	Name string `gorm:"size:80;not null" json:"name"`
}

func (Category) TableName() string {
	return "menu_categories"
}

type MenuItem struct {
	ID             uint       `gorm:"primaryKey" json:"id"`
	Name           string     `gorm:"size:120;not null" json:"name"`
	Description    string     `gorm:"type:text" json:"description"`
	PricePaise     int        `gorm:"column:price_paise;not null" json:"price_paise"`
	PausedByID     *uint      `gorm:"column:paused_by_id" json:"paused_by_id,omitempty"`
	PausedUntil    *time.Time `gorm:"column:paused_until" json:"paused_until,omitempty"`
	ImageURLs      string     `gorm:"column:image_urls;type:json;default:'[]'" json:"-"`
	IsVegetarian   bool       `gorm:"column:is_vegetarian;default:false;not null" json:"is_vegetarian"`
	IsAvailable    bool       `gorm:"column:is_available;default:true;not null" json:"is_available"`
	IsFeatured     bool       `gorm:"column:is_featured;default:false;not null" json:"is_featured"`
	IsCustomizable bool       `gorm:"column:is_customizable;default:false;not null" json:"is_customizable"`
	Variations     string     `gorm:"column:variations;type:json;default:'[]'" json:"-"`
	CreatedAt      time.Time  `gorm:"column:created_at" json:"created_at"`

	Sections []MenuSection `gorm:"foreignKey:MenuItemID" json:"sections,omitempty"`
}

func (MenuItem) TableName() string {
	return "menu_items"
}

type MenuSection struct {
	ID          uint   `gorm:"primaryKey" json:"id"`
	MenuItemID  uint   `gorm:"column:menu_item_id;index" json:"menu_item_id"`
	SectionType string `gorm:"column:section_type;size:32;default:'CUSTOM'" json:"section_type"`
	Name        string `gorm:"size:60;not null" json:"name"`
	Position    int    `gorm:"default:0" json:"position"`
	Required    bool   `gorm:"default:true" json:"required"`
	Options     string `gorm:"column:options;type:json;default:'[]'" json:"-"`
}

func (MenuSection) TableName() string {
	return "menu_sections"
}

type MenuItemCategory struct {
	MenuItemID uint `gorm:"column:menu_item_id;primaryKey"`
	CategoryID uint `gorm:"column:category_id;primaryKey"`
}

func (MenuItemCategory) TableName() string {
	return "menu_item_categories"
}

type OrderStatus string

const (
	OrderStatusPlaced         OrderStatus = "PLACED"
	OrderStatusAccepted       OrderStatus = "ACCEPTED"
	OrderStatusPreparing      OrderStatus = "PREPARING"
	OrderStatusReady          OrderStatus = "READY"
	OrderStatusOutForDelivery OrderStatus = "OUT_FOR_DELIVERY"
	OrderStatusDelivered      OrderStatus = "DELIVERED"
	OrderStatusCancelled      OrderStatus = "CANCELLED"
	OrderStatusRejected       OrderStatus = "REJECTED"
)

type PaymentStatus string

const (
	PaymentStatusPending       PaymentStatus = "PENDING"
	PaymentStatusPaid          PaymentStatus = "PAID"
	PaymentStatusCaptured      PaymentStatus = "PAID" // compatibility alias
	PaymentStatusFailed        PaymentStatus = "FAILED"
	PaymentStatusRefundPending PaymentStatus = "REFUND_PENDING"
	PaymentStatusRefunded      PaymentStatus = "REFUNDED"
)

type PaymentMethod string

const (
	PaymentMethodRazorpay PaymentMethod = "RAZORPAY"
	PaymentMethodOnline   PaymentMethod = "RAZORPAY" // compatibility alias
	PaymentMethodCash     PaymentMethod = "CASH"
)

type Order struct {
	OrderID               string      `gorm:"primaryKey;column:order_id;size:20" json:"order_id"`
	CustomerID            *uint       `gorm:"column:customer_id;index" json:"customer_id"`
	CreatedByID           *uint       `gorm:"column:created_by_id" json:"created_by_id"`
	AssignedDeliveryID    *uint       `gorm:"column:assigned_delivery_id;index" json:"assigned_delivery_id"`
	Status                OrderStatus `gorm:"column:status;size:24;default:'PLACED';not null" json:"status"`
	OrderType             string      `gorm:"column:order_type;size:16;default:'DELIVERY';not null" json:"order_type"`
	DeliveryFeePaise      int         `gorm:"column:delivery_fee_paise;default:0;not null" json:"delivery_fee_paise"`
	ScheduledFor          *time.Time  `gorm:"column:scheduled_for" json:"scheduled_for"`
	Notes                 string      `gorm:"column:notes;size:500" json:"notes"`
	Address               string      `gorm:"column:address;type:text;not null" json:"address"`
	Latitude              *float64    `gorm:"column:latitude" json:"latitude"`
	Longitude             *float64    `gorm:"column:longitude" json:"longitude"`
	CustomerName          *string     `gorm:"column:customer_name;size:120" json:"customer_name"`
	CustomerPhone         *string     `gorm:"column:customer_phone;size:32" json:"customer_phone"`
	DeliveryOTPCiphertext *string     `gorm:"column:delivery_otp_ciphertext;size:500" json:"-"`
	DeliveryOTPExpiresAt  *time.Time  `gorm:"column:delivery_otp_expires_at" json:"-"`
	DeliveryOTPAttempts   int         `gorm:"column:delivery_otp_attempts;default:0" json:"-"`
	DeliveryStartedAt     *time.Time  `gorm:"column:delivery_started_at" json:"delivery_started_at"`
	DeliveredAt           *time.Time  `gorm:"column:delivered_at" json:"delivered_at"`
	CreatedAt             time.Time   `gorm:"column:created_at" json:"created_at"`
	UpdatedAt             time.Time   `gorm:"column:updated_at" json:"updated_at"`

	Customer       *Account    `gorm:"foreignKey:CustomerID" json:"customer,omitempty"`
	AssignedDriver *Account    `gorm:"foreignKey:AssignedDeliveryID" json:"assigned_driver,omitempty"`
	Items          []OrderItem `gorm:"foreignKey:OrderID;references:OrderID" json:"items,omitempty"`
	Payment        *Payment    `gorm:"foreignKey:OrderID;references:OrderID" json:"payment,omitempty"`
}

func (Order) TableName() string {
	return "orders"
}

type OrderItem struct {
	ID             uint      `gorm:"primaryKey;column:id" json:"id"`
	OrderID        string    `gorm:"column:order_id;size:20;index;not null" json:"order_id"`
	MenuItemID     *uint     `gorm:"column:menu_item_id;index" json:"menu_item_id"`
	VariationName  *string   `gorm:"column:variation_name;size:60" json:"variation_name"`
	Quantity       int       `gorm:"column:quantity;not null" json:"quantity"`
	UnitPricePaise int       `gorm:"column:unit_price_paise;not null" json:"unit_price_paise"`
	Customizations string    `gorm:"column:customizations;type:json;default:'[]';not null" json:"customizations"`

	MenuItem       *MenuItem `gorm:"foreignKey:MenuItemID" json:"menu_item,omitempty"`
}

func (OrderItem) TableName() string {
	return "order_items"
}

type Payment struct {
	OrderID           string        `gorm:"primaryKey;column:order_id;size:20" json:"order_id"`
	Method            PaymentMethod `gorm:"column:method;size:16;not null" json:"method"`
	Status            PaymentStatus `gorm:"column:status;size:16;default:'PENDING';not null" json:"status"`
	AmountPaise       int           `gorm:"column:amount_paise;not null" json:"amount_paise"`
	GatewayOrderID   *string       `gorm:"column:gateway_order_id;size:120" json:"gateway_order_id"`
	GatewayPaymentID *string       `gorm:"column:gateway_payment_id;size:120" json:"gateway_payment_id"`
	CreatedAt         time.Time     `gorm:"column:created_at" json:"created_at"`
	UpdatedAt         time.Time     `gorm:"column:updated_at" json:"updated_at"`
}

func (Payment) TableName() string {
	return "payments"
}

type RestaurantSettings struct {
	ID                              uint       `gorm:"primaryKey" json:"id"`
	RestaurantName                  string     `gorm:"size:120;default:'KebabZilla';not null" json:"restaurant_name"`
	Tagline                         string     `gorm:"size:200;default:'Fire up your cravings.';not null" json:"tagline"`
	Phone                           string     `gorm:"size:300" json:"phone"`
	Email                           string     `gorm:"size:255;default:'support@kebabzilla.in';not null" json:"email"`
	Address                         string     `gorm:"size:300" json:"address"`
	Latitude                        *float64   `json:"latitude"`
	Longitude                       *float64   `json:"longitude"`
	MinimumOrderPaise               int        `gorm:"default:19900;not null" json:"minimum_order_paise"`
	DeliveryRadiusKm                float64    `gorm:"default:10.0;not null" json:"delivery_radius_km"`
	FreeDeliveryRadiusKm            float64    `gorm:"default:3.0;not null" json:"free_delivery_radius_km"`
	FreeDeliveryThresholdPaise      int        `gorm:"default:0;not null" json:"free_delivery_threshold_paise"`
	DeliveryFeePerKmPaise           int        `gorm:"default:1000;not null" json:"delivery_fee_per_km_paise"`
	ChargeFromZeroBeyondFreeRadius bool       `gorm:"column:charge_from_zero_beyond_free_radius;default:false;not null" json:"charge_from_zero_beyond_free_radius"`
	AcceptingOrders                 bool       `gorm:"default:true;not null" json:"accepting_orders"`
	IsDeliveryOpen                  bool       `gorm:"default:true;not null" json:"is_delivery_open"`
	OrderCutoffMinutesBeforeClosing int        `gorm:"default:30;not null" json:"order_cutoff_minutes_before_closing"`
	DeliveryPausedUntil             *time.Time `json:"delivery_paused_until"`
	AdminOverrideState              *bool      `json:"admin_override_state"`
	AdminOverrideUntil              *time.Time `json:"admin_override_until"`
	EnforceDriverGeofence           bool       `gorm:"default:false;not null" json:"enforce_driver_geofence"`
	DriverGeofenceMeters            int        `gorm:"default:500;not null" json:"driver_geofence_meters"`
	HaversineRoutingFactor          float64    `gorm:"default:1.3627;not null" json:"haversine_routing_factor"`
	AverageDeliverySpeedKmh         float64    `gorm:"default:30.0;not null" json:"average_delivery_speed_kmh"`
	CustomerSLAMinutes              float64    `gorm:"default:36.0;not null" json:"customer_sla_minutes"`
	AlnsMaxIterationsMode           string     `gorm:"size:10;default:'AUTO';not null" json:"alns_max_iterations_mode"`
	WeeklySchedule                  string     `gorm:"type:json;column:weekly_schedule" json:"-"`
}

func (RestaurantSettings) TableName() string {
	return "restaurant_settings"
}

type AdminEvent struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	EventType string    `gorm:"size:40;index" json:"event_type"`
	Message   string    `gorm:"size:500" json:"message"`
	Details   string    `gorm:"type:json;column:details;default:'{}'" json:"-"`
	ActorID   *uint     `json:"actor_id"`
	CreatedAt time.Time `gorm:"index" json:"created_at"`
	Actor     *Account  `gorm:"foreignKey:ActorID" json:"actor,omitempty"`
}

func (AdminEvent) TableName() string {
	return "admin_events"
}

type MenuDiscount struct {
	ID              uint               `gorm:"primaryKey" json:"id"`
	CampaignName    *string            `gorm:"size:80" json:"campaign_name"`
	DiscountPercent int                `json:"discount_percent"`
	StartsAt        time.Time          `gorm:"index" json:"starts_at"`
	EndsAt          time.Time          `gorm:"index" json:"ends_at"`
	CreatedByID     *uint              `json:"created_by_id"`
	CreatedAt       time.Time          `json:"created_at"`
	Items           []MenuDiscountItem `gorm:"foreignKey:DiscountID" json:"items"`
}

func (MenuDiscount) TableName() string {
	return "menu_discounts"
}

type MenuDiscountItem struct {
	ID         uint      `gorm:"primaryKey;autoIncrement" json:"id"`
	DiscountID uint      `gorm:"index" json:"discount_id"`
	MenuItemID uint      `gorm:"index" json:"menu_item_id"`
	MenuItem   *MenuItem `gorm:"foreignKey:MenuItemID" json:"menu_item,omitempty"`
}

func (MenuDiscountItem) TableName() string {
	return "menu_discount_items"
}

type OfferLog struct {
	ID             uint      `gorm:"primaryKey" json:"id"`
	ActorID        uint      `json:"actor_id"`
	Audience       string    `gorm:"size:40" json:"audience"`
	Channels       string    `gorm:"type:json;default:'[]'" json:"-"`
	Subject        string    `gorm:"size:160" json:"subject"`
	Message        string    `gorm:"type:text" json:"message"`
	DeliveryCounts string    `gorm:"type:json;default:'{}'" json:"-"`
	Status         string    `gorm:"size:30;default:'SENT'" json:"status"`
	CreatedAt      time.Time `gorm:"index" json:"created_at"`
}

func (OfferLog) TableName() string {
	return "offer_logs"
}

type DraftOrder struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	CreatedByID  uint      `gorm:"index" json:"created_by_id"`
	CustomerName string    `gorm:"size:120;default:'Walk-in'" json:"customer_name"`
	Payload      string    `gorm:"type:json;default:'{}'" json:"-"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (DraftOrder) TableName() string {
	return "draft_orders"
}

type DeliveryBatch struct {
	ID         uint                 `gorm:"primaryKey" json:"id"`
	DeliveryID uint                 `gorm:"index;column:delivery_id;not null" json:"delivery_id"`
	RouteLabel string               `gorm:"size:120;default:'Nearby route'" json:"route_label"`
	Status     string               `gorm:"size:20;default:'ACTIVE'" json:"status"`
	CreatedAt  time.Time            `gorm:"column:created_at" json:"created_at"`
	Orders     []DeliveryBatchOrder `gorm:"foreignKey:BatchID" json:"orders,omitempty"`
}

func (DeliveryBatch) TableName() string {
	return "delivery_batches"
}

type DeliveryBatchOrder struct {
	ID      uint   `gorm:"primaryKey" json:"id"`
	BatchID uint   `gorm:"index;column:batch_id;not null" json:"batch_id"`
	OrderID string `gorm:"index;column:order_id;size:20;not null" json:"order_id"`
}

func (DeliveryBatchOrder) TableName() string {
	return "delivery_batch_orders"
}
