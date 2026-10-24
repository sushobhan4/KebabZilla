package handlers

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/kebabzilla/go-backend/clustering"
	"github.com/kebabzilla/go-backend/config"
	"github.com/kebabzilla/go-backend/middleware"
	"github.com/kebabzilla/go-backend/models"
	"gorm.io/gorm"
)

type OrderHandler struct {
	cfg *config.Config
	db  *gorm.DB
}

func NewOrderHandler(cfg *config.Config, db *gorm.DB) *OrderHandler {
	return &OrderHandler{cfg: cfg, db: db}
}

type OrderLineItemInput struct {
	MenuID           *uint   `json:"menu_id"`
	MenuItemID       *uint   `json:"menu_item_id"`
	CustomMenuItemID *uint   `json:"custom_menu_item_id"`
	ItemName         string  `json:"item_name"`
	Variation        *string `json:"variation_name"`
	Quantity         int     `json:"quantity"`
	UnitPrice        int     `json:"unit_price_paise"`
	Customizations   []any   `json:"customizations"`
}

type CreateOrderRequest struct {
	Items         []OrderLineItemInput `json:"items"`
	PaymentMethod models.PaymentMethod `json:"payment_method"`
	Address       string               `json:"address"`
	Latitude      *float64             `json:"latitude"`
	Longitude     *float64             `json:"longitude"`
	ScheduledFor  *string              `json:"scheduled_for"`
	CustomerName  string               `json:"customer_name"`
	CustomerPhone string               `json:"customer_phone"`
	Notes         string               `json:"notes"`
}

type OrderItemOut struct {
	ID                 uint     `json:"id,omitempty"`
	MenuItemID         *uint    `json:"menu_item_id"`
	CustomMenuItemID   *uint    `json:"custom_menu_item_id"`
	Name               string   `json:"name"`
	Quantity           int      `json:"quantity"`
	UnitPricePaise     int      `json:"unit_price_paise"`
	PricePaise         int      `json:"price_paise"`
	LineTotalPaise     int      `json:"line_total_paise"`
	TaxPercent         int      `json:"tax_percent"`
	TaxPaise           int      `json:"tax_paise"`
	VariationName      *string  `json:"variation_name,omitempty"`
	Customizations     []any    `json:"customizations"`
	ImageURL           *string  `json:"image_url,omitempty"`
	ImageURLs          []string `json:"image_urls"`
}

type RazorpayCheckoutPrefill struct {
	Name    string `json:"name"`
	Email   string `json:"email"`
	Contact string `json:"contact"`
}

type RazorpayCheckoutInfo struct {
	GatewayOrderID string                  `json:"gateway_order_id"`
	Amount         int                     `json:"amount"`
	Currency       string                  `json:"currency"`
	KeyID          string                  `json:"key_id"`
	Name           string                  `json:"name"`
	Description    string                  `json:"description"`
	Prefill        RazorpayCheckoutPrefill `json:"prefill"`
}

type OrderResponse struct {
	OrderID            string                `json:"order_id"`
	CustomerID         *uint                 `json:"customer_id"`
	CustomerName       string                `json:"customer_name"`
	CustomerEmail      string                `json:"customer_email"`
	CustomerPhone      *string               `json:"customer_phone"`
	Status             string                `json:"status"`
	OrderType          string                `json:"order_type"`
	PaymentMethod      *string               `json:"payment_method"`
	PaymentStatus      *string               `json:"payment_status"`
	SubtotalPaise      int                   `json:"subtotal_paise"`
	TaxPaise           int                   `json:"tax_paise"`
	DeliveryFeePaise   int                   `json:"delivery_fee_paise"`
	TotalPaise         int                   `json:"total_paise"`
	Address            string                `json:"address"`
	Latitude           *float64              `json:"latitude"`
	Longitude          *float64              `json:"longitude"`
	Notes              string                `json:"notes"`
	AssignedDeliveryID *uint                 `json:"assigned_delivery_id"`
	ScheduledFor       *time.Time            `json:"scheduled_for"`
	DeliveryStartedAt  *time.Time            `json:"delivery_started_at"`
	DeliveredAt        *time.Time            `json:"delivered_at"`
	DeliveryName       *string               `json:"delivery_name"`
	DeliveryPhone      *string               `json:"delivery_phone"`
	DeliveryOTP        *string               `json:"delivery_otp"`
	CreatedAt          time.Time             `json:"created_at"`
	Items              []OrderItemOut        `json:"items"`
	Checkout           *RazorpayCheckoutInfo `json:"checkout,omitempty"`
}

func FormatNextOrderID(prefix string, existingIDs []string) string {
	maxSeq := 0
	prefixLen := len(prefix)
	for _, oid := range existingIDs {
		suffix := oid[prefixLen:]
		if val, err := strconv.Atoi(suffix); err == nil {
			if val > maxSeq {
				maxSeq = val
			}
		}
	}
	nextSeq := maxSeq + 1
	digits := 3
	seqStr := strconv.Itoa(nextSeq)
	if len(seqStr) > digits {
		digits = len(seqStr)
	}
	return fmt.Sprintf("%s%0*d", prefix, digits, nextSeq)
}

func NextOrderID(db *gorm.DB) string {
	loc := time.FixedZone("IST", 5*3600+1800) // Asia/Kolkata UTC+5:30
	now := time.Now().In(loc)
	prefix := now.Format("060102") // 2-digit year, month, day: e.g. "261024"

	var existingIDs []string
	db.Model(&models.Order{}).Where("order_id LIKE ?", prefix+"%").Pluck("order_id", &existingIDs)

	return FormatNextOrderID(prefix, existingIDs)
}

func generateOrderID(db *gorm.DB) string {
	return NextOrderID(db)
}

func (h *OrderHandler) createRazorpayOrder(amountPaise int, receipt string) (string, error) {
	if h.cfg.RazorpayKeyID == "" || h.cfg.RazorpayKeySecret == "" {
		return "", fmt.Errorf("online payment is not configured")
	}
	url := strings.TrimRight(h.cfg.RazorpayAPIBase, "/") + "/orders"
	bodyBytes, _ := json.Marshal(map[string]any{
		"amount":   amountPaise,
		"currency": "INR",
		"receipt":  receipt,
	})
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(bodyBytes))
	if err != nil {
		return "", err
	}
	req.SetBasicAuth(h.cfg.RazorpayKeyID, h.cfg.RazorpayKeySecret)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("razorpay order creation failed with status %d", resp.StatusCode)
	}

	var res struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		return "", err
	}
	return res.ID, nil
}

func (h *OrderHandler) refundRazorpayPayment(paymentID string, amountPaise int, receipt string) (string, string, error) {
	if h.cfg.RazorpayKeyID == "" || h.cfg.RazorpayKeySecret == "" {
		return "", "", fmt.Errorf("online payment is not configured")
	}
	url := fmt.Sprintf("%s/payments/%s/refund", strings.TrimRight(h.cfg.RazorpayAPIBase, "/"), paymentID)
	bodyBytes, _ := json.Marshal(map[string]any{
		"amount":  amountPaise,
		"receipt": receipt,
		"notes":   map[string]string{"reason": "KebabZilla order refund"},
	})
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(bodyBytes))
	if err != nil {
		return "", "", err
	}
	req.SetBasicAuth(h.cfg.RazorpayKeyID, h.cfg.RazorpayKeySecret)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()

	var res struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		return "", "", err
	}
	return res.ID, res.Status, nil
}

func (h *OrderHandler) CreateOrder(w http.ResponseWriter, r *http.Request) {
	account := r.Context().Value(middleware.AccountContextKey).(*models.Account)

	var req CreateOrderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Items) == 0 {
		http.Error(w, `{"detail":"Invalid order payload"}`, http.StatusBadRequest)
		return
	}

	payMethod := req.PaymentMethod
	if payMethod == "" {
		payMethod = models.PaymentMethodCash
	}

	if payMethod == models.PaymentMethodRazorpay {
		if h.cfg.RazorpayKeyID == "" || h.cfg.RazorpayKeySecret == "" {
			http.Error(w, `{"detail":"Online payment is not configured. Choose cash or contact the restaurant."}`, http.StatusServiceUnavailable)
			return
		}
	}

	var setting models.RestaurantSettings
	_ = h.db.First(&setting)

	if !setting.AcceptingOrders {
		http.Error(w, `{"detail":"The restaurant is currently closed"}`, http.StatusConflict)
		return
	}
	if !setting.IsDeliveryOpen {
		http.Error(w, `{"detail":"Online delivery is currently unavailable. Our shop is open for walk-in orders at our counter."}`, http.StatusConflict)
		return
	}

	if strings.TrimSpace(req.Address) == "" {
		http.Error(w, `{"detail":"A delivery address is required"}`, http.StatusBadRequest)
		return
	}

	// Active promotional discounts
	nowUTC := time.Now().UTC()
	var discounts []models.MenuDiscount
	h.db.Preload("Items").Where("starts_at <= ? AND ends_at > ?", nowUTC, nowUTC).Find(&discounts)
	activeDiscounts := make(map[uint]int)
	for _, d := range discounts {
		for _, di := range d.Items {
			activeDiscounts[di.MenuItemID] = d.DiscountPercent
		}
	}

	// Calculate subtotal with discounts and customizations
	subtotal := 0
	calculatedUnitPrices := make([]int, len(req.Items))
	for idx, it := range req.Items {
		unitPrice := it.UnitPrice
		mID := it.MenuItemID
		if mID == nil {
			mID = it.MenuID
		}
		if mID == nil {
			mID = it.CustomMenuItemID
		}

		if mID != nil {
			var mi models.MenuItem
			if err := h.db.First(&mi, *mID).Error; err == nil {
				basePrice := mi.PricePaise
				if it.Variation != nil && *it.Variation != "" && mi.Variations != "" && mi.Variations != "[]" {
					var vars []map[string]any
					if err := json.Unmarshal([]byte(mi.Variations), &vars); err == nil {
						for _, v := range vars {
							if n, ok := v["name"].(string); ok && strings.EqualFold(n, *it.Variation) {
								if p, ok := v["price_paise"].(float64); ok {
									basePrice = int(p)
								}
								break
							}
						}
					}
				}
				if disc, ok := activeDiscounts[mi.ID]; ok && disc > 0 {
					basePrice = int(math.Max(1, math.Round(float64(basePrice*(100-disc))/100.0)))
				}
				extra := 0
				for _, c := range it.Customizations {
					if cm, ok := c.(map[string]any); ok {
						if ex, ok := cm["extra_paise"].(float64); ok && ex > 0 {
							extra += int(ex)
						}
					}
				}
				unitPrice = basePrice + extra
			}
		}
		if it.UnitPrice > 0 && it.UnitPrice < unitPrice {
			unitPrice = it.UnitPrice
		}
		calculatedUnitPrices[idx] = unitPrice
		subtotal += unitPrice * it.Quantity
	}

	if setting.MinimumOrderPaise > 0 && subtotal < setting.MinimumOrderPaise {
		http.Error(w, fmt.Sprintf(`{"detail":"Minimum order is ₹%.0f"}`, float64(setting.MinimumOrderPaise)/100.0), http.StatusBadRequest)
		return
	}

	// Calculate delivery fee
	deliveryFee := 0
	if req.Latitude != nil && req.Longitude != nil && setting.Latitude != nil && setting.Longitude != nil {
		routingFactor := setting.HaversineRoutingFactor
		if routingFactor <= 1.0 {
			routingFactor = 1.3627
		}
		distKm := clustering.RoadDistanceKm(*setting.Latitude, *setting.Longitude, *req.Latitude, *req.Longitude, routingFactor)
		distKm = math.Round(distKm*100) / 100

		if distKm > setting.DeliveryRadiusKm {
			http.Error(w, fmt.Sprintf(`{"detail":"Delivery location is %.1f km away, which exceeds our maximum delivery radius of %.1f km."}`, distKm, setting.DeliveryRadiusKm), http.StatusBadRequest)
			return
		}

		if setting.FreeDeliveryThresholdPaise > 0 && subtotal >= setting.FreeDeliveryThresholdPaise {
			deliveryFee = 0
		} else if distKm <= setting.FreeDeliveryRadiusKm {
			deliveryFee = 0
		} else {
			billableKm := distKm - setting.FreeDeliveryRadiusKm
			if setting.ChargeFromZeroBeyondFreeRadius {
				billableKm = distKm
			}
			rawFeeINR := billableKm * (float64(setting.DeliveryFeePerKmPaise) / 100.0)
			deliveryFee = int(math.Ceil(rawFeeINR)) * 100
		}
	}

	total := subtotal + deliveryFee

	custName := strings.TrimSpace(req.CustomerName)
	if custName == "" {
		custName = account.Name
	}
	var custPhone *string
	if strings.TrimSpace(req.CustomerPhone) != "" {
		p := strings.TrimSpace(req.CustomerPhone)
		custPhone = &p
	} else if account.Phone != nil {
		custPhone = account.Phone
	}

	orderID := NextOrderID(h.db)
	now := time.Now().UTC()

	var schedFor *time.Time
	if req.ScheduledFor != nil && *req.ScheduledFor != "" {
		if t, err := time.Parse(time.RFC3339, *req.ScheduledFor); err == nil {
			schedFor = &t
		}
	}

	order := models.Order{
		OrderID:          orderID,
		CustomerID:       &account.ID,
		Status:           models.OrderStatusPlaced,
		OrderType:        "DELIVERY",
		DeliveryFeePaise: deliveryFee,
		CustomerName:     &custName,
		CustomerPhone:    custPhone,
		Address:          strings.TrimSpace(req.Address),
		Latitude:         req.Latitude,
		Longitude:        req.Longitude,
		Notes:            req.Notes,
		ScheduledFor:     schedFor,
		CreatedAt:        now,
		UpdatedAt:        now,
	}

	if err := h.db.Create(&order).Error; err != nil {
		http.Error(w, `{"detail":"Failed to create order"}`, http.StatusInternalServerError)
		return
	}

	createdItems := make([]models.OrderItem, 0, len(req.Items))
	for idx, it := range req.Items {
		mID := it.MenuItemID
		if mID == nil {
			mID = it.MenuID
		}
		if mID == nil {
			mID = it.CustomMenuItemID
		}

		unitPrice := calculatedUnitPrices[idx]
		customsJSON := "[]"
		if len(it.Customizations) > 0 {
			if bytes, err := json.Marshal(it.Customizations); err == nil {
				customsJSON = string(bytes)
			}
		}

		itemRow := models.OrderItem{
			OrderID:        orderID,
			MenuItemID:     mID,
			VariationName:  it.Variation,
			Quantity:       it.Quantity,
			UnitPricePaise: unitPrice,
			Customizations: customsJSON,
		}
		_ = h.db.Create(&itemRow)
		createdItems = append(createdItems, itemRow)
	}
	order.Items = createdItems

	payment := models.Payment{
		OrderID:     orderID,
		Method:      payMethod,
		Status:      models.PaymentStatusPending,
		AmountPaise: total,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	var gatewayOrderID string
	if payMethod == models.PaymentMethodCash {
		h.db.Where("customer_id = ?", account.ID).Delete(&models.CartItem{})
	} else if payMethod == models.PaymentMethodRazorpay {
		var err error
		gatewayOrderID, err = h.createRazorpayOrder(total, orderID)
		if err != nil {
			h.db.Delete(&order)
			http.Error(w, `{"detail":"Payment provider could not create a checkout"}`, http.StatusBadGateway)
			return
		}
		payment.GatewayOrderID = &gatewayOrderID
	}

	_ = h.db.Create(&payment)
	order.Payment = &payment

	_ = h.db.Create(&models.AdminEvent{
		EventType: "order_created",
		Message:   fmt.Sprintf("Order %s placed", order.OrderID),
		ActorID:   &account.ID,
		CreatedAt: now,
		Details:   fmt.Sprintf(`{"order_id":"%s","order_number":"%s"}`, order.OrderID, order.OrderID),
	})

	resp := formatOrderResponseOpts(&order, account.Email, true, true)
	if payMethod == models.PaymentMethodRazorpay && gatewayOrderID != "" {
		phoneStr := ""
		if custPhone != nil {
			phoneStr = *custPhone
		}
		resp.Checkout = &RazorpayCheckoutInfo{
			GatewayOrderID: gatewayOrderID,
			Amount:         total,
			Currency:       "INR",
			KeyID:          h.cfg.RazorpayKeyID,
			Name:           "KebabZilla",
			Description:    fmt.Sprintf("Order %s", order.OrderID),
			Prefill: RazorpayCheckoutPrefill{
				Name:    custName,
				Email:   account.Email,
				Contact: phoneStr,
			},
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(resp)
}

func (h *OrderHandler) GetOrders(w http.ResponseWriter, r *http.Request) {
	account := r.Context().Value(middleware.AccountContextKey).(*models.Account)

	limit := 10
	if lStr := r.URL.Query().Get("limit"); lStr != "" {
		if l, err := strconv.Atoi(lStr); err == nil && l > 0 {
			if l > 10 {
				l = 10
			}
			limit = l
		}
	}
	offset := 0
	if oStr := r.URL.Query().Get("offset"); oStr != "" {
		if o, err := strconv.Atoi(oStr); err == nil && o >= 0 {
			offset = o
		}
	}

	var total int64
	h.db.Model(&models.Order{}).Where("customer_id = ?", account.ID).Count(&total)

	var orders []models.Order
	h.db.Preload("Items.MenuItem").Preload("Payment").Preload("AssignedDriver").
		Where("customer_id = ?", account.ID).Order("created_at desc").
		Limit(limit).Offset(offset).Find(&orders)

	resps := make([]OrderResponse, 0, len(orders))
	for i := range orders {
		resps = append(resps, formatOrderResponseOpts(&orders[i], account.Email, true, true))
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"items":  resps,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

func (h *OrderHandler) GetOrder(w http.ResponseWriter, r *http.Request) {
	account := r.Context().Value(middleware.AccountContextKey).(*models.Account)
	orderID := chi.URLParam(r, "order_id")

	var o models.Order
	if err := h.db.Preload("Items.MenuItem").Preload("Payment").Preload("AssignedDriver").Preload("Customer").
		Where("order_id = ?", orderID).First(&o).Error; err != nil {
		http.Error(w, `{"detail":"Order not found"}`, http.StatusNotFound)
		return
	}

	// Permission: Owner, Staff, Delivery Rider assigned, or Admin
	isOwner := o.CustomerID != nil && *o.CustomerID == account.ID
	isDriver := o.AssignedDeliveryID != nil && *o.AssignedDeliveryID == account.ID
	isStaff := account.Role == models.RoleEmployee || account.Role == models.RoleAdmin

	if !isOwner && !isDriver && !isStaff {
		http.Error(w, `{"detail":"Order not found"}`, http.StatusNotFound)
		return
	}

	email := account.Email
	if o.Customer != nil {
		email = o.Customer.Email
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(formatOrderResponseOpts(&o, email, isOwner, true))
}

func (h *OrderHandler) CancelOrder(w http.ResponseWriter, r *http.Request) {
	account := r.Context().Value(middleware.AccountContextKey).(*models.Account)
	orderID := chi.URLParam(r, "order_id")

	var order models.Order
	if err := h.db.Preload("Payment").Preload("Items.MenuItem").Preload("Customer").
		Where("order_id = ? AND customer_id = ?", orderID, account.ID).First(&order).Error; err != nil {
		http.Error(w, `{"detail":"Order not found"}`, http.StatusNotFound)
		return
	}

	if order.Status == models.OrderStatusCancelled {
		if order.Payment != nil && order.Payment.Status == models.PaymentStatusPaid && order.Payment.Method == models.PaymentMethodRazorpay {
			if order.Payment.GatewayPaymentID != nil && *order.Payment.GatewayPaymentID != "" {
				_, state, _ := h.refundRazorpayPayment(*order.Payment.GatewayPaymentID, order.Payment.AmountPaise, order.OrderID)
				if state == "processed" {
					order.Payment.Status = models.PaymentStatusRefunded
				} else {
					order.Payment.Status = models.PaymentStatusRefundPending
				}
				h.db.Save(order.Payment)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(formatOrderResponse(&order, account.Email))
		return
	}

	if order.Status != models.OrderStatusPlaced {
		http.Error(w, `{"detail":"Orders in preparation cannot be cancelled online. To cancel this order, please call the restaurant directly."}`, http.StatusConflict)
		return
	}

	if order.Payment != nil && order.Payment.Status == models.PaymentStatusPaid {
		if order.Payment.Method != models.PaymentMethodRazorpay {
			http.Error(w, `{"detail":"This payment cannot be refunded automatically"}`, http.StatusConflict)
			return
		}
		if order.Payment.GatewayPaymentID != nil && *order.Payment.GatewayPaymentID != "" {
			_, state, err := h.refundRazorpayPayment(*order.Payment.GatewayPaymentID, order.Payment.AmountPaise, order.OrderID)
			if err != nil {
				http.Error(w, `{"detail":"Razorpay could not start the refund; try again"}`, http.StatusBadGateway)
				return
			}
			if state == "processed" {
				order.Payment.Status = models.PaymentStatusRefunded
			} else {
				order.Payment.Status = models.PaymentStatusRefundPending
			}
			h.db.Save(order.Payment)
		}
	} else if order.Payment != nil && order.Payment.Method == models.PaymentMethodCash {
		h.db.Delete(order.Payment)
		order.Payment = nil
	} else if order.Payment != nil {
		order.Payment.Status = models.PaymentStatusRefunded
		h.db.Save(order.Payment)
	}

	order.Status = models.OrderStatusCancelled
	order.UpdatedAt = time.Now().UTC()
	h.db.Save(&order)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(formatOrderResponseOpts(&order, account.Email, true, true))
}

func (h *OrderHandler) AbandonOrder(w http.ResponseWriter, r *http.Request) {
	account := r.Context().Value(middleware.AccountContextKey).(*models.Account)
	orderID := chi.URLParam(r, "order_id")

	var order models.Order
	if err := h.db.Preload("Payment").Where("order_id = ? AND customer_id = ?", orderID, account.ID).First(&order).Error; err == nil {
		if order.Status == models.OrderStatusPlaced {
			if order.Payment == nil || order.Payment.Status != models.PaymentStatusPaid {
				order.Status = models.OrderStatusCancelled
				order.UpdatedAt = time.Now().UTC()
				if order.Payment != nil {
					if order.Payment.Method == models.PaymentMethodCash {
						h.db.Delete(order.Payment)
					} else {
						order.Payment.Status = models.PaymentStatusRefunded
						h.db.Save(order.Payment)
					}
				}
				h.db.Save(&order)
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"ok":true}`))
}

func (h *OrderHandler) SwitchToCash(w http.ResponseWriter, r *http.Request) {
	account := r.Context().Value(middleware.AccountContextKey).(*models.Account)
	orderID := chi.URLParam(r, "order_id")

	var order models.Order
	if err := h.db.Preload("Payment").Preload("Items.MenuItem").Preload("Customer").
		Where("order_id = ? AND customer_id = ?", orderID, account.ID).First(&order).Error; err != nil {
		http.Error(w, `{"detail":"Order not found"}`, http.StatusNotFound)
		return
	}

	if order.Payment == nil || order.Payment.Status == models.PaymentStatusPaid {
		http.Error(w, `{"detail":"Cannot switch payment method for a paid order"}`, http.StatusBadRequest)
		return
	}

	order.Payment.Method = models.PaymentMethodCash
	order.Payment.Status = models.PaymentStatusPending
	order.Payment.GatewayOrderID = nil
	order.Payment.GatewayPaymentID = nil
	order.Payment.UpdatedAt = time.Now().UTC()
	h.db.Save(order.Payment)

	h.db.Where("customer_id = ?", account.ID).Delete(&models.CartItem{})

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(formatOrderResponseOpts(&order, account.Email, true, true))
}

func (h *OrderHandler) PaymentSession(w http.ResponseWriter, r *http.Request) {
	account := r.Context().Value(middleware.AccountContextKey).(*models.Account)
	orderID := chi.URLParam(r, "order_id")

	var order models.Order
	if err := h.db.Preload("Payment").Where("order_id = ? AND customer_id = ?", orderID, account.ID).First(&order).Error; err != nil || order.Payment == nil || order.Payment.Method != models.PaymentMethodRazorpay {
		http.Error(w, `{"detail":"Online payment order not found"}`, http.StatusNotFound)
		return
	}

	if order.Payment.Status == models.PaymentStatusPaid {
		http.Error(w, `{"detail":"This order has already been paid"}`, http.StatusConflict)
		return
	}
	if order.Status == models.OrderStatusRejected || order.Status == models.OrderStatusCancelled || order.Status == models.OrderStatusDelivered {
		http.Error(w, `{"detail":"This order can no longer be paid"}`, http.StatusConflict)
		return
	}
	if h.cfg.RazorpayKeyID == "" || h.cfg.RazorpayKeySecret == "" {
		http.Error(w, `{"detail":"Online payment is not configured. Contact the restaurant."}`, http.StatusServiceUnavailable)
		return
	}

	gatewayOrderID, err := h.createRazorpayOrder(order.Payment.AmountPaise, order.OrderID)
	if err != nil {
		http.Error(w, `{"detail":"Payment provider could not create a checkout"}`, http.StatusBadGateway)
		return
	}

	order.Payment.GatewayOrderID = &gatewayOrderID
	order.Payment.UpdatedAt = time.Now().UTC()
	h.db.Save(order.Payment)

	phoneStr := ""
	if account.Phone != nil {
		phoneStr = *account.Phone
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(RazorpayCheckoutInfo{
		GatewayOrderID: gatewayOrderID,
		Amount:         order.Payment.AmountPaise,
		Currency:       "INR",
		KeyID:          h.cfg.RazorpayKeyID,
		Name:           "KebabZilla",
		Description:    fmt.Sprintf("Order %s", order.OrderID),
		Prefill: RazorpayCheckoutPrefill{
			Name:    account.Name,
			Email:   account.Email,
			Contact: phoneStr,
		},
	})
}

type VerifyPaymentRequest struct {
	GatewayOrderID   string `json:"gateway_order_id"`
	GatewayPaymentID string `json:"gateway_payment_id"`
	Signature        string `json:"signature"`
	OrderID          string `json:"order_id"`
}

func (h *OrderHandler) VerifyRazorpayPayment(w http.ResponseWriter, r *http.Request) {
	account := r.Context().Value(middleware.AccountContextKey).(*models.Account)

	var req VerifyPaymentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"detail":"Invalid payload"}`, http.StatusBadRequest)
		return
	}

	var payment models.Payment
	err := h.db.Where("gateway_order_id = ?", req.GatewayOrderID).First(&payment).Error
	if err != nil && req.OrderID != "" {
		err = h.db.Where("order_id = ?", req.OrderID).First(&payment).Error
	}
	if err != nil {
		http.Error(w, `{"detail":"Payment session not found"}`, http.StatusNotFound)
		return
	}

	var order models.Order
	if err := h.db.Where("order_id = ?", payment.OrderID).First(&order).Error; err != nil || order.CustomerID == nil || *order.CustomerID != account.ID {
		http.Error(w, `{"detail":"Payment session not found"}`, http.StatusNotFound)
		return
	}

	if payment.Status == models.PaymentStatusRefundPending || payment.Status == models.PaymentStatusRefunded {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"status": payment.Status, "order_id": order.OrderID})
		return
	}

	if payment.Status == models.PaymentStatusPaid {
		if order.Status == models.OrderStatusCancelled && payment.Method == models.PaymentMethodRazorpay {
			if payment.GatewayPaymentID != nil && *payment.GatewayPaymentID != "" {
				_, state, _ := h.refundRazorpayPayment(*payment.GatewayPaymentID, payment.AmountPaise, order.OrderID)
				if state == "processed" {
					payment.Status = models.PaymentStatusRefunded
				} else {
					payment.Status = models.PaymentStatusRefundPending
				}
				h.db.Save(&payment)
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"status": payment.Status, "order_id": order.OrderID})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "PAID", "order_id": order.OrderID})
		return
	}

	// Verify HMAC-SHA256 signature
	if h.cfg.RazorpayKeySecret != "" {
		data := req.GatewayOrderID + "|" + req.GatewayPaymentID
		mac := hmac.New(sha256.New, []byte(h.cfg.RazorpayKeySecret))
		mac.Write([]byte(data))
		expected := hex.EncodeToString(mac.Sum(nil))

		if expected != req.Signature && h.cfg.Environment == "production" {
			http.Error(w, `{"detail":"Payment signature is invalid"}`, http.StatusBadRequest)
			return
		}
	}

	payment.GatewayPaymentID = &req.GatewayPaymentID
	payment.Status = models.PaymentStatusPaid
	payment.UpdatedAt = time.Now().UTC()
	h.db.Save(&payment)

	if order.CustomerID != nil {
		h.db.Where("customer_id = ?", *order.CustomerID).Delete(&models.CartItem{})
	}

	if order.Status == models.OrderStatusCancelled {
		_, state, _ := h.refundRazorpayPayment(req.GatewayPaymentID, payment.AmountPaise, order.OrderID)
		if state == "processed" {
			payment.Status = models.PaymentStatusRefunded
		} else {
			payment.Status = models.PaymentStatusRefundPending
		}
		h.db.Save(&payment)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":   payment.Status,
		"order_id": order.OrderID,
	})
}

func (h *OrderHandler) RazorpayWebhook(w http.ResponseWriter, r *http.Request) {
	sig := r.Header.Get("X-Razorpay-Signature")
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, `{"detail":"Cannot read webhook body"}`, http.StatusBadRequest)
		return
	}

	if h.cfg.RazorpayWebhookSecret != "" {
		mac := hmac.New(sha256.New, []byte(h.cfg.RazorpayWebhookSecret))
		mac.Write(body)
		expected := hex.EncodeToString(mac.Sum(nil))
		if expected != sig {
			http.Error(w, `{"detail":"Webhook signature is invalid"}`, http.StatusBadRequest)
			return
		}
	}

	var event map[string]any
	if err := json.Unmarshal(body, &event); err != nil {
		http.Error(w, `{"detail":"Webhook payload is invalid"}`, http.StatusBadRequest)
		return
	}

	eventType, _ := event["event"].(string)
	payload, _ := event["payload"].(map[string]any)

	if eventType == "payment.captured" && payload != nil {
		payData, _ := payload["payment"].(map[string]any)
		if payData != nil {
			entity, _ := payData["entity"].(map[string]any)
			if entity != nil {
				gatewayOrderID, _ := entity["order_id"].(string)
				paymentID, _ := entity["id"].(string)
				var payment models.Payment
				if err := h.db.Where("gateway_order_id = ?", gatewayOrderID).First(&payment).Error; err == nil {
					payment.GatewayPaymentID = &paymentID
					payment.Status = models.PaymentStatusPaid
					payment.UpdatedAt = time.Now().UTC()
					h.db.Save(&payment)

					var order models.Order
					if err := h.db.Where("order_id = ?", payment.OrderID).First(&order).Error; err == nil && order.CustomerID != nil {
						h.db.Where("customer_id = ?", *order.CustomerID).Delete(&models.CartItem{})
					}
				}
			}
		}
	} else if (eventType == "refund.processed" || eventType == "refund.failed") && payload != nil {
		refData, _ := payload["refund"].(map[string]any)
		if refData != nil {
			entity, _ := refData["entity"].(map[string]any)
			if entity != nil {
				paymentID, _ := entity["payment_id"].(string)
				var payment models.Payment
				if err := h.db.Where("gateway_payment_id = ?", paymentID).First(&payment).Error; err == nil {
					if eventType == "refund.processed" {
						payment.Status = models.PaymentStatusRefunded
					} else {
						payment.Status = models.PaymentStatusPaid
					}
					payment.UpdatedAt = time.Now().UTC()
					h.db.Save(&payment)
				}
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"received":true}`))
}
