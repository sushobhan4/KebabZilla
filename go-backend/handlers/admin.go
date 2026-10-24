package handlers

import (
	"bytes"
	"compress/gzip"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/kebabzilla/go-backend/cache"
	"github.com/kebabzilla/go-backend/clustering"
	"github.com/kebabzilla/go-backend/config"
	"github.com/kebabzilla/go-backend/middleware"
	"github.com/kebabzilla/go-backend/models"
	"github.com/kebabzilla/go-backend/security"
	"github.com/kebabzilla/go-backend/storage"
	"gorm.io/gorm"
)

type AdminHandler struct {
	cfg   *config.Config
	db    *gorm.DB
	cache *cache.HybridCache
}

func NewAdminHandler(cfg *config.Config, db *gorm.DB, c *cache.HybridCache) *AdminHandler {
	return &AdminHandler{cfg: cfg, db: db, cache: c}
}

type AdminOrdersPage struct {
	Items            []OrderResponse `json:"items"`
	Total            int64           `json:"total"`
	Limit            int             `json:"limit"`
	Offset           int             `json:"offset"`
	StatusCounts     map[string]int  `json:"status_counts"`
	PaidRevenuePaise int             `json:"paid_revenue_paise"`
}

type AccountsPageResponse struct {
	Items      []AdminAccountOut `json:"items"`
	Total      int64             `json:"total"`
	Limit      int               `json:"limit"`
	Offset     int               `json:"offset"`
	RoleCounts map[string]int    `json:"role_counts"`
}

type AdminAccountOut struct {
	ID                    uint          `json:"id"`
	Email                 string        `json:"email"`
	Name                  string        `json:"name"`
	Phone                 *string       `json:"phone"`
	Role                  models.Role   `json:"role"`
	Addresses             []any         `json:"addresses"`
	IsActive              bool          `json:"is_active"`
	CreatedAt             time.Time     `json:"created_at"`
	MustChangePassword    bool          `json:"must_change_password"`
	IsAcceptingDeliveries bool          `json:"is_accepting_deliveries"`
	StaffInfo             *StaffInfoOut `json:"staff_info,omitempty"`
}

type StaffInfoOut struct {
	Role                  models.Role `json:"role"`
	IsAcceptingDeliveries bool        `json:"is_accepting_deliveries"`
	MustChangePassword    bool        `json:"must_change_password"`
}

func (h *AdminHandler) parseDateRange(period string) (time.Time, time.Time, string) {
	loc := time.FixedZone("IST", 5*3600+1800)
	now := time.Now().In(loc)

	switch period {
	case "day":
		start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
		end := start.AddDate(0, 0, 1)
		return start.UTC(), end.UTC(), "hour"
	case "week":
		weekday := int(now.Weekday())
		if weekday == 0 {
			weekday = 7 // Sunday -> 7
		}
		start := time.Date(now.Year(), now.Month(), now.Day()-(weekday-1), 0, 0, 0, 0, loc)
		end := start.AddDate(0, 0, 7)
		return start.UTC(), end.UTC(), "day"
	case "month":
		start := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, loc)
		end := start.AddDate(0, 1, 0)
		return start.UTC(), end.UTC(), "day"
	case "year":
		start := time.Date(now.Year(), 1, 1, 0, 0, 0, 0, loc)
		end := start.AddDate(1, 0, 0)
		return start.UTC(), end.UTC(), "month"
	default:
		return time.Time{}, time.Time{}, "day"
	}
}

// -------------------------------------------------------------
// ORDERS
// -------------------------------------------------------------

func (h *AdminHandler) GetAdminOrders(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	period := strings.TrimSpace(r.URL.Query().Get("period"))
	statusFilter := strings.TrimSpace(r.URL.Query().Get("status_filter"))

	limit := 10
	if lStr := r.URL.Query().Get("limit"); lStr != "" {
		if l, err := strconv.Atoi(lStr); err == nil && l > 0 && l <= 100 {
			limit = l
		}
	}
	offset := 0
	if oStr := r.URL.Query().Get("offset"); oStr != "" {
		if o, err := strconv.Atoi(oStr); err == nil && o >= 0 {
			offset = o
		}
	}

	baseTx := h.db.Model(&models.Order{})

	if period != "" && period != "all" {
		start, end, _ := h.parseDateRange(period)
		if !start.IsZero() {
			baseTx = baseTx.Where("orders.created_at >= ? AND orders.created_at < ?", start, end)
		}
	}

	if q != "" {
		pat := "%" + q + "%"
		baseTx = baseTx.Where("orders.order_id ILIKE ? OR orders.customer_name ILIKE ? OR orders.customer_phone ILIKE ?", pat, pat, pat)
	}

	// Status counts query (matches period and search filters, ignoring status_filter)
	statusCounts := map[string]int{
		"PLACED":           0,
		"ACCEPTED":         0,
		"PREPARING":        0,
		"READY":            0,
		"OUT_FOR_DELIVERY": 0,
		"DELIVERED":        0,
		"CANCELLED":        0,
		"REJECTED":         0,
	}

	type StatusCountRow struct {
		Status string
		Count  int
	}
	var countRows []StatusCountRow
	// Clone session so GROUP BY does not pollute baseTx or items query
	baseTx.Session(&gorm.Session{}).Select("orders.status, count(orders.order_id) as count").Group("orders.status").Scan(&countRows)
	for _, cr := range countRows {
		statusCounts[cr.Status] = cr.Count
	}

	// Now apply status filter on a cloned session for the items query
	itemsTx := baseTx.Session(&gorm.Session{})
	if statusFilter != "" && statusFilter != "ALL" {
		if statusFilter == "PREPARING" {
			itemsTx = itemsTx.Where("orders.status IN ('ACCEPTED', 'PREPARING')")
		} else {
			itemsTx = itemsTx.Where("orders.status = ?", statusFilter)
		}
	}

	var total int64
	itemsTx.Count(&total)

	var orders []models.Order
	itemsTx.Preload("Items.MenuItem").Preload("Payment").Preload("Customer").Preload("AssignedDriver").
		Order("orders.created_at desc").Limit(limit).Offset(offset).Find(&orders)

	paidRevenue := 0
	items := make([]OrderResponse, 0, len(orders))
	for i := range orders {
		o := &orders[i]
		email := ""
		if o.Customer != nil {
			email = o.Customer.Email
		}
		formatted := formatOrderResponse(o, email)
		if o.Payment != nil && (o.Payment.Status == models.PaymentStatusPaid || o.Payment.Status == models.PaymentStatusCaptured) {
			paidRevenue += formatted.TotalPaise
		}
		if o.Status == models.OrderStatusDelivered {
			formatted.Address = ""
			formatted.CustomerPhone = nil
		}
		items = append(items, formatted)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(AdminOrdersPage{
		Items:            items,
		Total:            total,
		Limit:            limit,
		Offset:           offset,
		StatusCounts:     statusCounts,
		PaidRevenuePaise: paidRevenue,
	})
}

func (h *AdminHandler) UpdateOrderStatus(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "order_id")
	if orderID == "" {
		http.Error(w, `{"detail":"Missing order ID"}`, http.StatusBadRequest)
		return
	}

	var req struct {
		Status models.OrderStatus `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"detail":"Invalid request format"}`, http.StatusBadRequest)
		return
	}

	var order models.Order
	if err := h.db.Preload("Items.MenuItem").Preload("Payment").Preload("Customer").Preload("AssignedDriver").
		Where("order_id = ?", orderID).First(&order).Error; err != nil {
		http.Error(w, `{"detail":"Order not found"}`, http.StatusNotFound)
		return
	}

	if order.Status == models.OrderStatusRejected {
		http.Error(w, `{"detail":"A rejected order cannot have its status changed"}`, http.StatusBadRequest)
		return
	}
	if order.Status == models.OrderStatusCancelled {
		http.Error(w, `{"detail":"A cancelled order cannot have its status changed"}`, http.StatusBadRequest)
		return
	}

	actorName := "Admin"
	var actorID *uint
	if accVal := r.Context().Value(middleware.AccountContextKey); accVal != nil {
		acc := accVal.(*models.Account)
		actorName = acc.Name
		actorID = &acc.ID
	}

	now := time.Now().UTC()
	oldStatus := order.Status
	order.Status = req.Status
	order.UpdatedAt = now

	// Payment status synchronization on cancellation / rejection
	if req.Status == models.OrderStatusRejected || req.Status == models.OrderStatusCancelled {
		if order.Payment != nil {
			if order.Payment.Method == models.PaymentMethodCash {
				_ = h.db.Delete(&models.Payment{}, "order_id = ?", order.OrderID)
				order.Payment = nil
			} else {
				order.Payment.Status = models.PaymentStatusRefunded
				order.Payment.UpdatedAt = now
				_ = h.db.Save(order.Payment)
			}
		}
	}

	// Status transition logic
	if req.Status == models.OrderStatusPlaced || req.Status == models.OrderStatusAccepted ||
		req.Status == models.OrderStatusPreparing || req.Status == models.OrderStatusReady ||
		req.Status == models.OrderStatusRejected || req.Status == models.OrderStatusCancelled {
		if order.AssignedDeliveryID != nil {
			order.AssignedDeliveryID = nil
			order.DeliveryStartedAt = nil
			order.DeliveryOTPCiphertext = nil
			order.DeliveryOTPExpiresAt = nil
			order.DeliveryOTPAttempts = 0
			_ = h.db.Where("order_id = ? AND purpose = ?", order.OrderID, "delivery").Delete(&models.AllOtp{})
			_ = h.db.Where("order_id = ?", order.OrderID).Delete(&models.DeliveryBatchOrder{})
		}
	} else if req.Status == models.OrderStatusOutForDelivery {
		if order.DeliveryStartedAt == nil {
			order.DeliveryStartedAt = &now
		}
	} else if req.Status == models.OrderStatusDelivered {
		if order.DeliveredAt == nil {
			order.DeliveredAt = &now
		}
	}

	if req.Status != models.OrderStatusDelivered {
		order.DeliveredAt = nil
	}

	_ = h.db.Save(&order)

	// Audit Event
	_ = h.db.Create(&models.AdminEvent{
		EventType: "order_status",
		Message:   fmt.Sprintf("Order %s status changed from %s to %s by %s", order.OrderID, oldStatus, req.Status, actorName),
		ActorID:   actorID,
		CreatedAt: now,
		Details:   fmt.Sprintf(`{"order_id":"%s","from_status":"%s","status":"%s"}`, order.OrderID, oldStatus, req.Status),
	})

	email := ""
	if order.Customer != nil {
		email = order.Customer.Email
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(formatOrderResponse(&order, email))
}

func (h *AdminHandler) UnassignDelivery(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "order_id")
	var order models.Order
	if err := h.db.Preload("Items.MenuItem").Preload("Payment").Preload("Customer").Preload("AssignedDriver").
		Where("order_id = ?", orderID).First(&order).Error; err != nil {
		http.Error(w, `{"detail":"Order not found"}`, http.StatusNotFound)
		return
	}

	actorName := "Admin"
	var actorID *uint
	if accVal := r.Context().Value(middleware.AccountContextKey); accVal != nil {
		acc := accVal.(*models.Account)
		actorName = acc.Name
		actorID = &acc.ID
	}

	driverName := "Driver"
	if order.AssignedDriver != nil {
		driverName = order.AssignedDriver.Name
	}

	now := time.Now().UTC()
	order.AssignedDeliveryID = nil
	order.DeliveryStartedAt = nil
	order.DeliveryOTPCiphertext = nil
	order.DeliveryOTPExpiresAt = nil
	order.DeliveryOTPAttempts = 0
	if order.Status == models.OrderStatusOutForDelivery {
		order.Status = models.OrderStatusReady
	}
	order.UpdatedAt = now
	_ = h.db.Save(&order)

	_ = h.db.Where("order_id = ? AND purpose = ?", order.OrderID, "delivery").Delete(&models.AllOtp{})
	_ = h.db.Where("order_id = ?", order.OrderID).Delete(&models.DeliveryBatchOrder{})

	_ = h.db.Create(&models.AdminEvent{
		EventType: "order_delivery_unassigned",
		Message:   fmt.Sprintf("Delivery driver %s unassigned from order %s by %s. Order returned to READY status.", driverName, order.OrderID, actorName),
		ActorID:   actorID,
		CreatedAt: now,
		Details:   fmt.Sprintf(`{"order_id":"%s"}`, order.OrderID),
	})

	email := ""
	if order.Customer != nil {
		email = order.Customer.Email
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(formatOrderResponse(&order, email))
}

func (h *AdminHandler) RefundOrder(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "order_id")
	var order models.Order
	if err := h.db.Preload("Payment").Where("order_id = ?", orderID).First(&order).Error; err != nil {
		http.Error(w, `{"detail":"Order not found"}`, http.StatusNotFound)
		return
	}

	if order.Payment == nil {
		http.Error(w, `{"detail":"Payment record not found"}`, http.StatusNotFound)
		return
	}

	now := time.Now().UTC()
	order.Payment.Status = models.PaymentStatusRefunded
	order.Payment.UpdatedAt = now
	_ = h.db.Save(order.Payment)

	refundID := fmt.Sprintf("rfnd_%d", now.Unix())

	if order.Payment.Method == models.PaymentMethodRazorpay && order.Payment.GatewayPaymentID != nil && *order.Payment.GatewayPaymentID != "" {
		if h.cfg.RazorpayKeyID != "" && h.cfg.RazorpayKeySecret != "" {
			refundURL := fmt.Sprintf("%s/payments/%s/refund", strings.TrimRight(h.cfg.RazorpayAPIBase, "/"), *order.Payment.GatewayPaymentID)
			payload, _ := json.Marshal(map[string]any{
				"amount": order.Payment.AmountPaise,
				"notes": map[string]string{
					"order_id": order.OrderID,
					"source":   "admin_refund",
				},
			})
			req, err := http.NewRequest("POST", refundURL, bytes.NewBuffer(payload))
			if err == nil {
				req.SetBasicAuth(h.cfg.RazorpayKeyID, h.cfg.RazorpayKeySecret)
				req.Header.Set("Content-Type", "application/json")
				client := &http.Client{Timeout: 10 * time.Second}
				resp, err := client.Do(req)
				if err == nil {
					defer resp.Body.Close()
					var rData map[string]any
					if err := json.NewDecoder(resp.Body).Decode(&rData); err == nil {
						if rid, ok := rData["id"].(string); ok && rid != "" {
							refundID = rid
						}
					}
				}
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"order_id":       order.OrderID,
		"payment_status": models.PaymentStatusRefunded,
		"refund_id":      refundID,
	})
}

// -------------------------------------------------------------
// ACCOUNTS / TEAM
// -------------------------------------------------------------

func (h *AdminHandler) GetAccounts(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	role := strings.TrimSpace(r.URL.Query().Get("role"))
	excludeUsers := r.URL.Query().Get("exclude_users") == "true"
	sortParam := strings.TrimSpace(r.URL.Query().Get("sort"))

	limit := 15
	if lStr := r.URL.Query().Get("limit"); lStr != "" {
		if l, err := strconv.Atoi(lStr); err == nil && l > 0 && l <= 250 {
			limit = l
		}
	}
	offset := 0
	if oStr := r.URL.Query().Get("offset"); oStr != "" {
		if o, err := strconv.Atoi(oStr); err == nil && o >= 0 {
			offset = o
		}
	}

	tx := h.db.Model(&models.Account{})

	if q != "" {
		pat := "%" + q + "%"
		tx = tx.Where("name ILIKE ? OR email ILIKE ? OR phone ILIKE ?", pat, pat, pat)
	}

	if role != "" && role != "ALL" {
		tx = tx.Where("role = ?", role)
	} else if excludeUsers {
		tx = tx.Where("role != ?", models.RoleUser)
	}

	var total int64
	tx.Count(&total)

	orderClause := "created_at desc"
	switch sortParam {
	case "oldest":
		orderClause = "created_at asc"
	case "name_asc":
		orderClause = "name asc"
	case "name_desc":
		orderClause = "name desc"
	case "role":
		orderClause = "role asc"
	}

	var accounts []models.Account
	tx.Order(orderClause).Limit(limit).Offset(offset).Find(&accounts)

	// Fetch staff_info in batch
	accIDs := make([]uint, 0, len(accounts))
	for _, a := range accounts {
		accIDs = append(accIDs, a.ID)
	}
	staffMap := make(map[uint]models.StaffInfo)
	if len(accIDs) > 0 {
		var staffList []models.StaffInfo
		h.db.Where("account_id IN ?", accIDs).Find(&staffList)
		for _, s := range staffList {
			staffMap[s.AccountID] = s
		}
	}

	// Role counts across whole database
	roleCounts := map[string]int{
		"ADMIN":    0,
		"EMPLOYEE": 0,
		"DELIVERY": 0,
		"USER":     0,
	}
	type RoleCountRow struct {
		Role  string
		Count int
	}
	var rcRows []RoleCountRow
	h.db.Model(&models.Account{}).Select("role, count(id) as count").Group("role").Scan(&rcRows)
	for _, rcr := range rcRows {
		roleCounts[rcr.Role] = rcr.Count
	}

	items := make([]AdminAccountOut, 0, len(accounts))
	for _, a := range accounts {
		mustChangePwd := false
		isAccepting := false
		var sOut *StaffInfoOut
		if s, ok := staffMap[a.ID]; ok {
			roleVal := a.Role
			if s.Role != nil {
				roleVal = *s.Role
			}
			mustChangePwd = s.MustChangePassword
			isAccepting = s.IsAcceptingDeliveries
			sOut = &StaffInfoOut{
				Role:                  roleVal,
				IsAcceptingDeliveries: s.IsAcceptingDeliveries,
				MustChangePassword:    s.MustChangePassword,
			}
		}
		items = append(items, AdminAccountOut{
			ID:                    a.ID,
			Email:                 a.Email,
			Name:                  a.Name,
			Phone:                 a.Phone,
			Role:                  a.Role,
			Addresses:             []any{},
			IsActive:              true,
			CreatedAt:             a.CreatedAt,
			MustChangePassword:    mustChangePwd,
			IsAcceptingDeliveries: isAccepting,
			StaffInfo:             sOut,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(AccountsPageResponse{
		Items:      items,
		Total:      total,
		Limit:      limit,
		Offset:     offset,
		RoleCounts: roleCounts,
	})
}

func (h *AdminHandler) CreateAccount(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name  string      `json:"name"`
		Email string      `json:"email"`
		Phone *string     `json:"phone"`
		Role  models.Role `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"detail":"Invalid account payload"}`, http.StatusBadRequest)
		return
	}

	if req.Role == models.RoleUser {
		http.Error(w, `{"detail":"Administrators can provision only admin, employee, or delivery accounts"}`, http.StatusUnprocessableEntity)
		return
	}

	email := strings.ToLower(strings.TrimSpace(req.Email))
	var count int64
	h.db.Model(&models.Account{}).Where("email = ?", email).Count(&count)
	if count > 0 {
		http.Error(w, `{"detail":"An account with this email already exists"}`, http.StatusConflict)
		return
	}

	initPassword := security.GenerateSecureToken(16)
	hashed, _ := security.HashPassword(initPassword)

	now := time.Now().UTC()
	account := models.Account{
		Email:              email,
		Name:               strings.TrimSpace(req.Name),
		Phone:              req.Phone,
		Role:               req.Role,
		PasswordHash:       &hashed,
		IsActive:           true,
		MustChangePassword: true,
		CreatedAt:          now,
	}

	if err := h.db.Create(&account).Error; err != nil {
		http.Error(w, `{"detail":"Could not create account"}`, http.StatusInternalServerError)
		return
	}

	staffInfo := models.StaffInfo{
		AccountID:             account.ID,
		Role:                  &req.Role,
		IsAcceptingDeliveries: false,
		MustChangePassword:    true,
		UpdatedAt:             now,
	}
	_ = h.db.Create(&staffInfo)

	actorName := "Admin"
	var actorID *uint
	if accVal := r.Context().Value(middleware.AccountContextKey); accVal != nil {
		acc := accVal.(*models.Account)
		actorName = acc.Name
		actorID = &acc.ID
	}

	_ = h.db.Create(&models.AdminEvent{
		EventType: "account_created",
		Message:   fmt.Sprintf("%s created with role %s by %s", account.Name, account.Role, actorName),
		ActorID:   actorID,
		CreatedAt: now,
		Details:   fmt.Sprintf(`{"role":"%s","email":"%s"}`, account.Role, account.Email),
	})

	w.WriteHeader(http.StatusCreated)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"id":                      account.ID,
		"email":                   account.Email,
		"name":                    account.Name,
		"phone":                   account.Phone,
		"addresses":               []any{},
		"role":                    account.Role,
		"is_active":               true,
		"must_change_password":    true,
		"is_accepting_deliveries": false,
		"created_at":              account.CreatedAt,
		"temporary_password":      nil,
		"notification_status":     "EMAIL_SENT",
	})
}

func (h *AdminHandler) UpdateAccountRole(w http.ResponseWriter, r *http.Request) {
	accIDStr := chi.URLParam(r, "account_id")
	accID, err := strconv.ParseUint(accIDStr, 10, 32)
	if err != nil {
		http.Error(w, `{"detail":"Invalid account ID"}`, http.StatusBadRequest)
		return
	}

	var req struct {
		Role     models.Role `json:"role"`
		Password string      `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"detail":"Invalid request"}`, http.StatusBadRequest)
		return
	}

	actorVal := r.Context().Value(middleware.AccountContextKey)
	if actorVal == nil {
		http.Error(w, `{"detail":"Not authenticated"}`, http.StatusUnauthorized)
		return
	}
	actor := actorVal.(*models.Account)

	if !security.VerifyPassword(req.Password, actor.GetPasswordHash()) {
		http.Error(w, `{"detail":"Incorrect admin password. Please try again."}`, http.StatusUnauthorized)
		return
	}

	if actor.ID == uint(accID) {
		http.Error(w, `{"detail":"You cannot change your own role"}`, http.StatusBadRequest)
		return
	}

	var target models.Account
	if err := h.db.First(&target, accID).Error; err != nil {
		http.Error(w, `{"detail":"Account not found"}`, http.StatusNotFound)
		return
	}

	if target.Role == models.RoleAdmin && req.Role != models.RoleAdmin {
		var adminCount int64
		h.db.Model(&models.Account{}).Where("role = ?", models.RoleAdmin).Count(&adminCount)
		if adminCount <= 1 {
			http.Error(w, `{"detail":"Cannot change the role of the last remaining administrator"}`, http.StatusBadRequest)
			return
		}
	}

	oldRole := target.Role
	target.Role = req.Role
	h.db.Save(&target)

	// Sync staff_info lifecycle
	if req.Role == models.RoleUser {
		_ = h.db.Where("account_id = ?", target.ID).Delete(&models.StaffInfo{})
	} else {
		var s models.StaffInfo
		if err := h.db.Where("account_id = ?", target.ID).First(&s).Error; err != nil {
			s = models.StaffInfo{
				AccountID:             target.ID,
				Role:                  &req.Role,
				IsAcceptingDeliveries: false,
				UpdatedAt:             time.Now().UTC(),
			}
			_ = h.db.Create(&s)
		} else {
			s.Role = &req.Role
			if req.Role != models.RoleDelivery {
				s.IsAcceptingDeliveries = false
			}
			s.UpdatedAt = time.Now().UTC()
			_ = h.db.Save(&s)
		}
	}

	_ = h.db.Create(&models.AdminEvent{
		EventType: "account_role_changed",
		Message:   fmt.Sprintf("%s's role changed from %s to %s by %s", target.Name, oldRole, req.Role, actor.Name),
		ActorID:   &actor.ID,
		CreatedAt: time.Now().UTC(),
		Details:   fmt.Sprintf(`{"account_id":%d,"from_role":"%s","role":"%s"}`, target.ID, oldRole, req.Role),
	})

	var s models.StaffInfo
	if err := h.db.Where("account_id = ?", target.ID).First(&s).Error; err == nil {
		target.MustChangePassword = s.MustChangePassword
		target.IsAcceptingDeliveries = s.IsAcceptingDeliveries
	}
	target.IsActive = true

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(target)
}

func (h *AdminHandler) GetAccountOrders(w http.ResponseWriter, r *http.Request) {
	accIDStr := chi.URLParam(r, "account_id")
	accID, _ := strconv.ParseUint(accIDStr, 10, 32)

	var orders []models.Order
	h.db.Preload("Items.MenuItem").Preload("Payment").Preload("Customer").Preload("AssignedDriver").
		Where("customer_id = ?", accID).Order("created_at desc").Limit(100).Find(&orders)

	items := make([]OrderResponse, 0, len(orders))
	for i := range orders {
		o := &orders[i]
		email := ""
		if o.Customer != nil {
			email = o.Customer.Email
		}
		items = append(items, formatOrderResponse(o, email))
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(items)
}

// -------------------------------------------------------------
// REPORTS / SALES
// -------------------------------------------------------------

type SalesReportResponse struct {
	Period                string                   `json:"period"`
	RevenuePaise          int                      `json:"revenue_paise"`
	PaidOrders            int                      `json:"paid_orders"`
	TotalOrders           int                      `json:"total_orders"`
	AverageOrderPaise     int                      `json:"average_order_paise"`
	Statuses              map[string]int           `json:"statuses"`
	Series                []ReportSeriesPoint      `json:"series"`
	TopItems              []ReportTopItem          `json:"top_items"`
	OrderTypes            map[string]BreakdownItem `json:"order_types"`
	PaymentMethods        map[string]BreakdownItem `json:"payment_methods"`
	PeakHour              *string                  `json:"peak_hour"`
	Categories            []ReportCategoryItem     `json:"categories"`
	RepeatCustomers       int                      `json:"repeat_customers"`
	NewCustomers          int                      `json:"new_customers"`
	AvgFulfillmentMinutes *float64                 `json:"avg_fulfillment_minutes"`
}

type ReportSeriesPoint struct {
	Label        string `json:"label"`
	RevenuePaise int    `json:"revenue_paise"`
	Orders       int    `json:"orders"`
}

type ReportTopItem struct {
	Name     string `json:"name"`
	Quantity int    `json:"quantity"`
}

type BreakdownItem struct {
	Orders       int `json:"orders"`
	RevenuePaise int `json:"revenue_paise"`
}

type ReportCategoryItem struct {
	Name         string `json:"name"`
	Quantity     int    `json:"quantity"`
	RevenuePaise int    `json:"revenue_paise"`
}

func (h *AdminHandler) GetSalesReport(w http.ResponseWriter, r *http.Request) {
	period := strings.TrimSpace(r.URL.Query().Get("period"))
	if period == "" {
		period = "week"
	}

	start, end, granularity := h.parseDateRange(period)
	var orders []models.Order
	tx := h.db.Preload("Items.MenuItem").Preload("Payment")
	if !start.IsZero() {
		tx = tx.Where("created_at >= ? AND created_at < ?", start, end)
	}
	tx.Order("created_at asc").Find(&orders)

	loc := time.FixedZone("IST", 5*3600+1800)
	totalRevenue := 0
	paidCount := 0
	statuses := map[string]int{
		"PLACED":           0,
		"ACCEPTED":         0,
		"PREPARING":        0,
		"READY":            0,
		"OUT_FOR_DELIVERY": 0,
		"DELIVERED":        0,
		"CANCELLED":        0,
		"REJECTED":         0,
	}

	bucketMap := make(map[string]*ReportSeriesPoint)
	bucketKeys := make([]string, 0)
	itemCounts := make(map[string]int)
	categoryMap := make(map[string]*ReportCategoryItem)
	hourCounts := make(map[int]int)

	dineInOrders, deliveryOrders, pickupOrders := 0, 0, 0
	dineInRev, deliveryRev, pickupRev := 0, 0, 0
	cashOrders, onlineOrders := 0, 0
	cashRev, onlineRev := 0, 0

	customerMap := make(map[uint]int)
	var totalFulfillmentDuration time.Duration
	fulfilledCount := 0

	for _, o := range orders {
		statuses[string(o.Status)]++
		cLocal := o.CreatedAt.In(loc)
		hourCounts[cLocal.Hour()]++

		if o.CustomerID != nil {
			customerMap[*o.CustomerID]++
		}

		key := ""
		label := ""
		if granularity == "hour" {
			key = cLocal.Format("2006-01-02 15:00")
			label = cLocal.Format("3 PM")
		} else if granularity == "month" {
			key = cLocal.Format("2006-01")
			label = cLocal.Format("Jan 2006")
		} else {
			key = cLocal.Format("2006-01-02")
			label = cLocal.Format("Mon, Jan 2")
		}

		if _, exists := bucketMap[key]; !exists {
			bucketMap[key] = &ReportSeriesPoint{Label: label, RevenuePaise: 0, Orders: 0}
			bucketKeys = append(bucketKeys, key)
		}
		bucketMap[key].Orders++

		isPaid := o.Payment != nil && (o.Payment.Status == models.PaymentStatusPaid || o.Payment.Status == models.PaymentStatusCaptured)
		amount := 0
		if o.Payment != nil {
			amount = o.Payment.AmountPaise
		}

		if isPaid {
			paidCount++
			totalRevenue += amount
			bucketMap[key].RevenuePaise += amount

			if o.OrderType == "DINE_IN" || o.Address == "Restaurant counter" {
				dineInOrders++
				dineInRev += amount
			} else if o.OrderType == "PICKUP" {
				pickupOrders++
				pickupRev += amount
			} else {
				deliveryOrders++
				deliveryRev += amount
			}

			if o.Payment.Method == models.PaymentMethodCash {
				cashOrders++
				cashRev += amount
			} else {
				onlineOrders++
				onlineRev += amount
			}

			for _, item := range o.Items {
				name := "Unavailable item"
				cat := "Specialty"
				price := item.UnitPricePaise
				if item.MenuItem != nil {
					name = item.MenuItem.Name
					price = item.MenuItem.PricePaise
				}
				itemCounts[name] += item.Quantity

				if _, ok := categoryMap[cat]; !ok {
					categoryMap[cat] = &ReportCategoryItem{Name: cat, Quantity: 0, RevenuePaise: 0}
				}
				categoryMap[cat].Quantity += item.Quantity
				categoryMap[cat].RevenuePaise += price * item.Quantity
			}
		}

		if o.DeliveredAt != nil && !o.DeliveredAt.IsZero() {
			totalFulfillmentDuration += o.DeliveredAt.Sub(o.CreatedAt)
			fulfilledCount++
		}
	}

	sort.Strings(bucketKeys)
	series := make([]ReportSeriesPoint, 0, len(bucketKeys))
	for _, k := range bucketKeys {
		series = append(series, *bucketMap[k])
	}

	topItems := make([]ReportTopItem, 0, len(itemCounts))
	for name, qty := range itemCounts {
		topItems = append(topItems, ReportTopItem{Name: name, Quantity: qty})
	}
	sort.Slice(topItems, func(i, j int) bool {
		return topItems[i].Quantity > topItems[j].Quantity
	})
	if len(topItems) > 5 {
		topItems = topItems[:5]
	}

	categories := make([]ReportCategoryItem, 0, len(categoryMap))
	for _, c := range categoryMap {
		categories = append(categories, *c)
	}
	sort.Slice(categories, func(i, j int) bool {
		return categories[i].RevenuePaise > categories[j].RevenuePaise
	})

	avgOrderPaise := 0
	if paidCount > 0 {
		avgOrderPaise = totalRevenue / paidCount
	}

	var peakHourStr *string
	if len(hourCounts) > 0 {
		busiestH := 0
		maxCount := -1
		for h, c := range hourCounts {
			if c > maxCount {
				maxCount = c
				busiestH = h
			}
		}
		startFmt := fmt.Sprintf("%d:00 AM", busiestH)
		if busiestH == 0 {
			startFmt = "12:00 AM"
		} else if busiestH == 12 {
			startFmt = "12:00 PM"
		} else if busiestH > 12 {
			startFmt = fmt.Sprintf("%d:00 PM", busiestH-12)
		}
		nextH := (busiestH + 1) % 24
		endFmt := fmt.Sprintf("%d:00 AM", nextH)
		if nextH == 0 {
			endFmt = "12:00 AM"
		} else if nextH == 12 {
			endFmt = "12:00 PM"
		} else if nextH > 12 {
			endFmt = fmt.Sprintf("%d:00 PM", nextH-12)
		}
		res := fmt.Sprintf("%s - %s", startFmt, endFmt)
		peakHourStr = &res
	}

	var avgFulfillMinutes *float64
	if fulfilledCount > 0 {
		mins := totalFulfillmentDuration.Minutes() / float64(fulfilledCount)
		avgFulfillMinutes = &mins
	}

	repeatCustomers := 0
	newCustomers := 0
	if len(customerMap) > 0 {
		cids := make([]uint, 0, len(customerMap))
		for cid := range customerMap {
			cids = append(cids, cid)
		}
		type CountResult struct {
			CustomerID uint  `gorm:"column:customer_id"`
			Count      int64 `gorm:"column:count"`
		}
		var priorCounts []CountResult
		if !start.IsZero() {
			h.db.Model(&models.Order{}).
				Select("customer_id, count(*) as count").
				Where("customer_id IN ? AND created_at < ?", cids, start).
				Group("customer_id").
				Scan(&priorCounts)
		}
		priorMap := make(map[uint]int64)
		for _, pc := range priorCounts {
			priorMap[pc.CustomerID] = pc.Count
		}
		for _, cid := range cids {
			if priorMap[cid] > 0 {
				repeatCustomers++
			} else {
				newCustomers++
			}
		}
	}

	resp := SalesReportResponse{
		Period:            period,
		RevenuePaise:      totalRevenue,
		PaidOrders:        paidCount,
		TotalOrders:       len(orders),
		AverageOrderPaise: avgOrderPaise,
		Statuses:          statuses,
		Series:            series,
		TopItems:          topItems,
		OrderTypes: map[string]BreakdownItem{
			"dine_in":  {Orders: dineInOrders, RevenuePaise: dineInRev},
			"delivery": {Orders: deliveryOrders, RevenuePaise: deliveryRev},
			"pickup":   {Orders: pickupOrders, RevenuePaise: pickupRev},
		},
		PaymentMethods: map[string]BreakdownItem{
			"cash":   {Orders: cashOrders, RevenuePaise: cashRev},
			"online": {Orders: onlineOrders, RevenuePaise: onlineRev},
		},
		PeakHour:              peakHourStr,
		Categories:            categories,
		RepeatCustomers:       repeatCustomers,
		NewCustomers:          newCustomers,
		AvgFulfillmentMinutes: avgFulfillMinutes,
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

// -------------------------------------------------------------
// SETTINGS
// -------------------------------------------------------------

func parseTimeMinutes(s string) int {
	parts := strings.Split(s, ":")
	if len(parts) >= 2 {
		h, _ := strconv.Atoi(parts[0])
		m, _ := strconv.Atoi(parts[1])
		return h*60 + m
	}
	return 0
}

func checkScheduleOpen(weeklyScheduleJSON string, now time.Time) (bool, string) {
	loc, err := time.LoadLocation("Asia/Kolkata")
	if err != nil {
		loc = time.FixedZone("IST", 5*3600+1800)
	}
	nowIST := now.In(loc)
	dayName := strings.ToLower(nowIST.Format("Monday"))
	currentMins := nowIST.Hour()*60 + nowIST.Minute()

	if weeklyScheduleJSON == "" || weeklyScheduleJSON == "{}" {
		return true, "Open"
	}

	var parsed map[string]any
	if err := json.Unmarshal([]byte(weeklyScheduleJSON), &parsed); err != nil {
		return true, "Open"
	}

	csRaw, ok := parsed["custom_schedules"].([]any)
	if !ok || len(csRaw) == 0 {
		return true, "Open"
	}

	for _, item := range csRaw {
		itemMap, ok := item.(map[string]any)
		if !ok {
			continue
		}
		days, _ := itemMap["days"].([]any)
		matchedDay := false
		for _, d := range days {
			if strings.EqualFold(fmt.Sprintf("%v", d), dayName) {
				matchedDay = true
				break
			}
		}
		if matchedDay {
			startStr, _ := itemMap["start_time"].(string)
			endStr, _ := itemMap["end_time"].(string)
			startMin := parseTimeMinutes(startStr)
			endMin := parseTimeMinutes(endStr)
			if startMin <= endMin {
				if currentMins >= startMin && currentMins <= endMin {
					return true, fmt.Sprintf("Open until %s", endStr)
				}
			} else {
				if currentMins >= startMin || currentMins <= endMin {
					return true, fmt.Sprintf("Open until %s", endStr)
				}
			}
		}
	}

	return false, "Closed"
}

func (h *AdminHandler) serializeSettings(s *models.RestaurantSettings) map[string]any {
	phones := []string{}
	for _, p := range strings.Split(s.Phone, ",") {
		p = strings.TrimSpace(p)
		if p != "" {
			phones = append(phones, p)
		}
	}

	var activeDrivers int64
	h.db.Model(&models.StaffInfo{}).Where("is_accepting_deliveries = true").Count(&activeDrivers)

	deliveryStatus := "OPEN"
	if !s.AcceptingOrders {
		deliveryStatus = "RESTAURANT_CLOSED"
	} else if !s.IsDeliveryOpen {
		deliveryStatus = "DELIVERY_PAUSED"
	}

	weeklyMap := map[string]any{}
	if s.WeeklySchedule != "" {
		_ = json.Unmarshal([]byte(s.WeeklySchedule), &weeklyMap)
	}

	isScheduledOpen, schedStatus := checkScheduleOpen(s.WeeklySchedule, time.Now())
	hasActiveOverride := false
	var overrideStateVal *bool = s.AdminOverrideState
	var overrideUntilVal *time.Time = s.AdminOverrideUntil

	if s.AdminOverrideState != nil {
		if s.AdminOverrideUntil != nil && time.Now().After(*s.AdminOverrideUntil) {
			s.AdminOverrideState = nil
			s.AdminOverrideUntil = nil
			s.AcceptingOrders = isScheduledOpen
			h.db.Model(s).Updates(map[string]any{
				"admin_override_state": nil,
				"admin_override_until": nil,
				"accepting_orders":     isScheduledOpen,
			})
			overrideStateVal = nil
			overrideUntilVal = nil
		} else if *s.AdminOverrideState == isScheduledOpen {
			s.AdminOverrideState = nil
			s.AdminOverrideUntil = nil
			h.db.Model(s).Updates(map[string]any{
				"admin_override_state": nil,
				"admin_override_until": nil,
			})
			overrideStateVal = nil
			overrideUntilVal = nil
		} else {
			hasActiveOverride = true
		}
	} else if s.AcceptingOrders != isScheduledOpen {
		hasActiveOverride = true
		overrideStateVal = &s.AcceptingOrders
	}

	return map[string]any{
		"id":                                  s.ID,
		"restaurant_name":                     s.RestaurantName,
		"tagline":                             s.Tagline,
		"phone":                               s.Phone,
		"phones":                              phones,
		"email":                               s.Email,
		"address":                             s.Address,
		"latitude":                            s.Latitude,
		"longitude":                           s.Longitude,
		"weekly_schedule":                     weeklyMap,
		"minimum_order_paise":                 s.MinimumOrderPaise,
		"delivery_radius_km":                  s.DeliveryRadiusKm,
		"free_delivery_radius_km":             s.FreeDeliveryRadiusKm,
		"free_delivery_threshold_paise":       s.FreeDeliveryThresholdPaise,
		"delivery_fee_per_km_paise":           s.DeliveryFeePerKmPaise,
		"charge_from_zero_beyond_free_radius": s.ChargeFromZeroBeyondFreeRadius,
		"accepting_orders":                    s.AcceptingOrders,
		"is_restaurant_open":                  s.AcceptingOrders,
		"is_delivery_open":                    s.IsDeliveryOpen,
		"delivery_paused_until":               s.DeliveryPausedUntil,
		"delivery_paused_reason":              "Delivery is currently unavailable",
		"order_cutoff_minutes_before_closing": s.OrderCutoffMinutesBeforeClosing,
		"delivery_status":                     deliveryStatus,
		"delivery_status_heading":             "Hot fresh delivery straight to your door.",
		"delivery_status_message":             "Order now for fast delivery.",
		"closing_in_minutes":                  nil,
		"closing_time":                        "11:00 PM",
		"admin_override_open":                 hasActiveOverride && (overrideStateVal != nil && *overrideStateVal),
		"admin_override_state":                overrideStateVal,
		"admin_override_until":                overrideUntilVal,
		"is_currently_scheduled_open":         isScheduledOpen,
		"schedule_status":                     schedStatus,
		"next_schedule_refresh":               nil,
		"enforce_driver_geofence":             s.EnforceDriverGeofence,
		"driver_geofence_meters":              s.DriverGeofenceMeters,
		"haversine_routing_factor":            s.HaversineRoutingFactor,
		"average_delivery_speed_kmh":          s.AverageDeliverySpeedKmh,
		"customer_sla_minutes":                s.CustomerSLAMinutes,
		"alns_max_iterations_mode":            s.AlnsMaxIterationsMode,
		"alns_max_iterations":                 220,
		"max_orders_per_driver":               5,
		"available_drivers_ready":             activeDrivers,
	}
}

func (h *AdminHandler) GetSettings(w http.ResponseWriter, r *http.Request) {
	var s models.RestaurantSettings
	if err := h.db.First(&s).Error; err != nil {
		s = models.RestaurantSettings{
			RestaurantName:                  "KebabZilla",
			Tagline:                         "Fire up your cravings.",
			Phone:                           "+91 98765 43210",
			Email:                           "support@kebabzilla.in",
			Address:                         "Amtala, DH Road, South 24 Parganas, West Bengal 743398",
			MinimumOrderPaise:               19900,
			DeliveryRadiusKm:                10.0,
			FreeDeliveryRadiusKm:            3.0,
			FreeDeliveryThresholdPaise:      49900,
			DeliveryFeePerKmPaise:           1500,
			AcceptingOrders:                 true,
			IsDeliveryOpen:                  true,
			OrderCutoffMinutesBeforeClosing: 30,
			HaversineRoutingFactor:          1.3627,
			AverageDeliverySpeedKmh:         30.0,
			CustomerSLAMinutes:              36.0,
			AlnsMaxIterationsMode:           "AUTO",
		}
		_ = h.db.Create(&s)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(h.serializeSettings(&s))
}

func (h *AdminHandler) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	var payload map[string]any
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, `{"detail":"Invalid settings format"}`, http.StatusBadRequest)
		return
	}

	var s models.RestaurantSettings
	_ = h.db.First(&s)

	if v, ok := payload["restaurant_name"].(string); ok && v != "" {
		s.RestaurantName = v
	}
	if v, ok := payload["tagline"].(string); ok {
		s.Tagline = v
	}
	if v, ok := payload["phone"].(string); ok {
		s.Phone = v
	}
	if v, ok := payload["phones"].([]any); ok {
		var plist []string
		for _, pi := range v {
			if ps, ok := pi.(string); ok && strings.TrimSpace(ps) != "" {
				plist = append(plist, strings.TrimSpace(ps))
			}
		}
		if len(plist) > 0 {
			s.Phone = strings.Join(plist, ", ")
		}
	}
	if v, ok := payload["email"].(string); ok {
		s.Email = v
	}
	if v, ok := payload["address"].(string); ok {
		s.Address = v
	}
	if v, ok := payload["latitude"].(float64); ok {
		s.Latitude = &v
	}
	if v, ok := payload["longitude"].(float64); ok {
		s.Longitude = &v
	}
	if v, ok := payload["enforce_driver_geofence"].(bool); ok {
		s.EnforceDriverGeofence = v
	}
	if v, ok := payload["driver_geofence_meters"].(float64); ok {
		s.DriverGeofenceMeters = int(v)
	}
	if v, ok := payload["accepting_orders"].(bool); ok {
		s.AcceptingOrders = v
		isSchedOpen, _ := checkScheduleOpen(s.WeeklySchedule, time.Now())
		if v == isSchedOpen {
			s.AdminOverrideState = nil
			s.AdminOverrideUntil = nil
		} else {
			s.AdminOverrideState = &v
		}
	}
	if v, ok := payload["is_delivery_open"].(bool); ok {
		s.IsDeliveryOpen = v
	}
	if v, ok := payload["minimum_order_paise"].(float64); ok {
		s.MinimumOrderPaise = int(v)
	}
	if v, ok := payload["delivery_radius_km"].(float64); ok {
		s.DeliveryRadiusKm = v
	}
	if v, ok := payload["free_delivery_radius_km"].(float64); ok {
		s.FreeDeliveryRadiusKm = v
	}
	if v, ok := payload["free_delivery_threshold_paise"].(float64); ok {
		s.FreeDeliveryThresholdPaise = int(v)
	}
	if v, ok := payload["delivery_fee_per_km_paise"].(float64); ok {
		s.DeliveryFeePerKmPaise = int(v)
	}
	if v, ok := payload["charge_from_zero_beyond_free_radius"].(bool); ok {
		s.ChargeFromZeroBeyondFreeRadius = v
	}
	if v, ok := payload["order_cutoff_minutes_before_closing"].(float64); ok {
		s.OrderCutoffMinutesBeforeClosing = int(v)
	}
	if v, ok := payload["haversine_routing_factor"].(float64); ok {
		s.HaversineRoutingFactor = v
	}
	if v, ok := payload["average_delivery_speed_kmh"].(float64); ok {
		s.AverageDeliverySpeedKmh = v
	}
	if v, ok := payload["customer_sla_minutes"].(float64); ok {
		s.CustomerSLAMinutes = v
	}
	if v, ok := payload["weekly_schedule"]; ok {
		if bytes, err := json.Marshal(v); err == nil {
			s.WeeklySchedule = string(bytes)
		}
	}

	h.db.Save(&s)

	if h.cache != nil {
		h.cache.Delete(r.Context(), "restaurant:public:v2")
		h.cache.Delete(r.Context(), "store:public_status")
		h.cache.Delete(r.Context(), "public_restaurant")
		h.cache.Delete(r.Context(), "restaurant:public")
		h.cache.DeletePrefix(r.Context(), "store:")
		h.cache.DeletePrefix(r.Context(), "restaurant:")
	}

	_ = h.db.Create(&models.AdminEvent{
		EventType: "settings_changed",
		Message:   "Restaurant settings updated",
		CreatedAt: time.Now().UTC(),
		Details:   `{"status":"updated"}`,
	})

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(h.serializeSettings(&s))
}

func (h *AdminHandler) RecalculateDistances(w http.ResponseWriter, r *http.Request) {
	var s models.RestaurantSettings
	_ = h.db.First(&s)

	var addresses []models.AccountAddress
	h.db.Find(&addresses)

	count := 0
	if s.Latitude != nil && s.Longitude != nil {
		rf := s.HaversineRoutingFactor
		if rf <= 1.0 {
			rf = clustering.DefaultRoutingFactor
		}
		for i := range addresses {
			a := &addresses[i]
			if a.Latitude != nil && a.Longitude != nil {
				distKm := clustering.RoadDistanceKm(*s.Latitude, *s.Longitude, *a.Latitude, *a.Longitude, rf)
				meters := int(distKm * 1000)
				a.DistanceMeters = &meters
				h.db.Save(a)
				count++
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":             "success",
		"recalculated_count": count,
		"message":            fmt.Sprintf("Successfully recalculated distances for %d customer address(es).", count),
	})
}

// -------------------------------------------------------------
// EVENTS
// -------------------------------------------------------------

func (h *AdminHandler) GetAdminEvents(w http.ResponseWriter, r *http.Request) {
	limit := 30
	if lStr := r.URL.Query().Get("limit"); lStr != "" {
		if l, err := strconv.Atoi(lStr); err == nil && l > 0 && l <= 100 {
			limit = l
		}
	}
	offset := 0
	if oStr := r.URL.Query().Get("offset"); oStr != "" {
		if o, err := strconv.Atoi(oStr); err == nil && o >= 0 {
			offset = o
		}
	}

	q := strings.TrimSpace(r.URL.Query().Get("q"))
	period := strings.TrimSpace(r.URL.Query().Get("period"))

	tx := h.db.Model(&models.AdminEvent{})
	if q != "" {
		tx = tx.Where("message ILIKE ? OR event_type ILIKE ?", "%"+q+"%", "%"+q+"%")
	}
	if period != "" && period != "all" {
		start, end, _ := h.parseDateRange(period)
		if !start.IsZero() {
			tx = tx.Where("created_at >= ? AND created_at < ?", start, end)
		}
	}

	var total int64
	tx.Count(&total)

	var events []models.AdminEvent
	tx.Preload("Actor").Order("created_at desc").Limit(limit).Offset(offset).Find(&events)

	type EventOut struct {
		ID        uint           `json:"id"`
		EventType string         `json:"event_type"`
		Message   string         `json:"message"`
		ActorID   *uint          `json:"actor_id"`
		ActorName string         `json:"actor_name"`
		Details   map[string]any `json:"details"`
		CreatedAt time.Time      `json:"created_at"`
	}

	items := make([]EventOut, 0, len(events))
	for _, ev := range events {
		actorName := "System"
		if ev.Actor != nil {
			actorName = ev.Actor.Name
		}
		det := map[string]any{}
		if ev.Details != "" {
			_ = json.Unmarshal([]byte(ev.Details), &det)
		}
		items = append(items, EventOut{
			ID:        ev.ID,
			EventType: ev.EventType,
			Message:   ev.Message,
			ActorID:   ev.ActorID,
			ActorName: actorName,
			Details:   det,
			CreatedAt: ev.CreatedAt,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"items":  items,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

// -------------------------------------------------------------
// EMAIL STATUS & OFFERS
// -------------------------------------------------------------

func (h *AdminHandler) GetEmailStatus(w http.ResponseWriter, r *http.Request) {
	fromEmail := h.cfg.EmailFromAddress
	if fromEmail == "" {
		fromEmail = "support@kebabzilla.in"
	}
	fromName := h.cfg.EmailFromName
	if fromName == "" {
		fromName = "KebabZilla"
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"configured": h.cfg.GmailRefreshToken != "",
		"backend":    "gmail",
		"from_email": fromEmail,
		"from_name":  fromName,
	})
}

func (h *AdminHandler) GetOffers(w http.ResponseWriter, r *http.Request) {
	var offers []models.OfferLog
	h.db.Order("created_at desc").Limit(100).Find(&offers)

	type OfferOut struct {
		ID             uint           `json:"id"`
		Audience       string         `json:"audience"`
		Channels       []string       `json:"channels"`
		Subject        string         `json:"subject"`
		Message        string         `json:"message"`
		DeliveryCounts map[string]any `json:"delivery_counts"`
		RecipientCount int            `json:"recipient_count"`
		SentCount      int            `json:"sent_count"`
		Status         string         `json:"status"`
		CreatedAt      time.Time      `json:"created_at"`
	}

	items := make([]OfferOut, 0, len(offers))
	for _, o := range offers {
		channels := make([]string, 0)
		if o.Channels != "" {
			_ = json.Unmarshal([]byte(o.Channels), &channels)
		}
		if len(channels) == 0 {
			channels = []string{"EMAIL"}
		}

		deliveryCounts := make(map[string]any)
		if o.DeliveryCounts != "" {
			_ = json.Unmarshal([]byte(o.DeliveryCounts), &deliveryCounts)
		}
		if len(deliveryCounts) == 0 {
			for _, ch := range channels {
				deliveryCounts[ch] = map[string]int{"recipient_count": 0, "sent_count": 0}
			}
		}

		items = append(items, OfferOut{
			ID:             o.ID,
			Audience:       o.Audience,
			Channels:       channels,
			Subject:        o.Subject,
			Message:        o.Message,
			DeliveryCounts: deliveryCounts,
			RecipientCount: 0,
			SentCount:      0,
			Status:         o.Status,
			CreatedAt:      o.CreatedAt,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(items)
}

func (h *AdminHandler) CreateOffer(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Audience string   `json:"audience"`
		Channels []string `json:"channels"`
		Subject  string   `json:"subject"`
		Message  string   `json:"message"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"detail":"Invalid offer format"}`, http.StatusBadRequest)
		return
	}

	if len(req.Channels) == 0 {
		req.Channels = []string{"EMAIL"}
	}

	var actorID uint = 1
	if accVal := r.Context().Value(middleware.AccountContextKey); accVal != nil {
		actorID = accVal.(*models.Account).ID
	}

	now := time.Now().UTC()
	chJSON, _ := json.Marshal(req.Channels)
	deliveryCounts := make(map[string]any)
	for _, ch := range req.Channels {
		deliveryCounts[ch] = map[string]int{"recipient_count": 0, "sent_count": 0}
	}
	countsJSON, _ := json.Marshal(deliveryCounts)

	offer := models.OfferLog{
		ActorID:        actorID,
		Audience:       req.Audience,
		Channels:       string(chJSON),
		Subject:        req.Subject,
		Message:        req.Message,
		DeliveryCounts: string(countsJSON),
		Status:         "SENT",
		CreatedAt:      now,
	}
	_ = h.db.Create(&offer)

	w.WriteHeader(http.StatusCreated)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"id":              offer.ID,
		"audience":        offer.Audience,
		"channels":        req.Channels,
		"subject":         offer.Subject,
		"message":         offer.Message,
		"delivery_counts": deliveryCounts,
		"recipient_count": 0,
		"sent_count":      0,
		"status":          "SENT",
		"provider_notes":  []string{},
		"created_at":      offer.CreatedAt,
	})
}

// -------------------------------------------------------------
// DISCOUNTS
// -------------------------------------------------------------

func (h *AdminHandler) GetDiscounts(w http.ResponseWriter, r *http.Request) {
	var discounts []models.MenuDiscount
	h.db.Preload("Items").Order("starts_at desc").Find(&discounts)

	// Collect all menu item IDs
	itemIDSet := make(map[uint]bool)
	for _, d := range discounts {
		for _, item := range d.Items {
			itemIDSet[item.MenuItemID] = true
		}
	}

	var itemIDs []uint
	for id := range itemIDSet {
		itemIDs = append(itemIDs, id)
	}

	itemMap := make(map[uint]string)
	if len(itemIDs) > 0 {
		var menuItems []models.MenuItem
		h.db.Where("id IN ?", itemIDs).Find(&menuItems)
		for _, m := range menuItems {
			itemMap[m.ID] = m.Name
		}
	}

	type DiscountOut struct {
		ID                uint      `json:"id"`
		CampaignName      *string   `json:"campaign_name"`
		MenuItemIDs       []uint    `json:"menu_item_ids"`
		CustomMenuItemIDs []uint    `json:"custom_menu_item_ids"`
		MenuItemNames     []string  `json:"menu_item_names"`
		DiscountPercent   int       `json:"discount_percent"`
		StartsAt          string    `json:"starts_at"`
		EndsAt            string    `json:"ends_at"`
		CreatedAt         time.Time `json:"created_at"`
	}

	items := make([]DiscountOut, 0, len(discounts))
	for _, d := range discounts {
		mIDs := make([]uint, 0)
		mNames := make([]string, 0)
		for _, link := range d.Items {
			mIDs = append(mIDs, link.MenuItemID)
			if name, ok := itemMap[link.MenuItemID]; ok {
				mNames = append(mNames, name)
			}
		}

		items = append(items, DiscountOut{
			ID:                d.ID,
			CampaignName:      d.CampaignName,
			MenuItemIDs:       mIDs,
			CustomMenuItemIDs: []uint{},
			MenuItemNames:     mNames,
			DiscountPercent:   d.DiscountPercent,
			StartsAt:          d.StartsAt.Format(time.RFC3339),
			EndsAt:            d.EndsAt.Format(time.RFC3339),
			CreatedAt:         d.CreatedAt,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(items)
}

func (h *AdminHandler) CreateDiscount(w http.ResponseWriter, r *http.Request) {
	var req struct {
		CampaignName      *string   `json:"campaign_name"`
		DiscountPercent   int       `json:"discount_percent"`
		StartsAt          time.Time `json:"starts_at"`
		EndsAt            time.Time `json:"ends_at"`
		MenuItemIDs       []uint    `json:"menu_item_ids"`
		CustomMenuItemIDs []uint    `json:"custom_menu_item_ids"`
		ItemIDs           []uint    `json:"item_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"detail":"Invalid discount format"}`, http.StatusBadRequest)
		return
	}

	idMap := make(map[uint]bool)
	for _, id := range req.MenuItemIDs {
		idMap[id] = true
	}
	for _, id := range req.CustomMenuItemIDs {
		idMap[id] = true
	}
	for _, id := range req.ItemIDs {
		idMap[id] = true
	}
	var allItemIDs []uint
	for id := range idMap {
		allItemIDs = append(allItemIDs, id)
	}

	var menuItems []models.MenuItem
	if len(allItemIDs) > 0 {
		h.db.Where("id IN ?", allItemIDs).Find(&menuItems)
	}
	itemNames := make([]string, 0, len(menuItems))
	for _, mi := range menuItems {
		itemNames = append(itemNames, mi.Name)
	}

	now := time.Now().UTC()
	discount := models.MenuDiscount{
		CampaignName:    req.CampaignName,
		DiscountPercent: req.DiscountPercent,
		StartsAt:        req.StartsAt,
		EndsAt:          req.EndsAt,
		CreatedAt:       now,
	}
	if err := h.db.Create(&discount).Error; err != nil {
		http.Error(w, `{"detail":"Could not create discount"}`, http.StatusInternalServerError)
		return
	}

	for _, itemID := range allItemIDs {
		_ = h.db.Create(&models.MenuDiscountItem{
			DiscountID: discount.ID,
			MenuItemID: itemID,
		})
	}

	actorName := "Admin"
	var actorID *uint
	if accVal := r.Context().Value(middleware.AccountContextKey); accVal != nil {
		acc := accVal.(*models.Account)
		actorName = acc.Name
		actorID = &acc.ID
	}
	_ = h.db.Create(&models.AdminEvent{
		EventType: "menu_discount_created",
		Message:   fmt.Sprintf("%d%% discount scheduled for %s by %s", discount.DiscountPercent, strings.Join(itemNames, ", "), actorName),
		ActorID:   actorID,
		CreatedAt: now,
		Details:   fmt.Sprintf(`{"discount_id":%d,"percent":%d}`, discount.ID, discount.DiscountPercent),
	})

	w.WriteHeader(http.StatusCreated)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"id":                   discount.ID,
		"campaign_name":        discount.CampaignName,
		"menu_item_ids":        allItemIDs,
		"custom_menu_item_ids": []uint{},
		"menu_item_names":      itemNames,
		"discount_percent":     discount.DiscountPercent,
		"starts_at":            discount.StartsAt.Format(time.RFC3339),
		"ends_at":              discount.EndsAt.Format(time.RFC3339),
		"created_at":           discount.CreatedAt,
	})
}

func (h *AdminHandler) UpdateDiscount(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "discount_id")
	var discount models.MenuDiscount
	if err := h.db.First(&discount, idStr).Error; err != nil {
		http.Error(w, `{"detail":"Discount not found"}`, http.StatusNotFound)
		return
	}

	var req struct {
		CampaignName      *string   `json:"campaign_name"`
		DiscountPercent   int       `json:"discount_percent"`
		StartsAt          time.Time `json:"starts_at"`
		EndsAt            time.Time `json:"ends_at"`
		MenuItemIDs       []uint    `json:"menu_item_ids"`
		CustomMenuItemIDs []uint    `json:"custom_menu_item_ids"`
		ItemIDs           []uint    `json:"item_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"detail":"Invalid discount update format"}`, http.StatusBadRequest)
		return
	}

	idMap := make(map[uint]bool)
	for _, id := range req.MenuItemIDs {
		idMap[id] = true
	}
	for _, id := range req.CustomMenuItemIDs {
		idMap[id] = true
	}
	for _, id := range req.ItemIDs {
		idMap[id] = true
	}
	var allItemIDs []uint
	for id := range idMap {
		allItemIDs = append(allItemIDs, id)
	}

	discount.CampaignName = req.CampaignName
	discount.DiscountPercent = req.DiscountPercent
	discount.StartsAt = req.StartsAt
	discount.EndsAt = req.EndsAt
	h.db.Save(&discount)

	_ = h.db.Where("discount_id = ?", discount.ID).Delete(&models.MenuDiscountItem{})
	for _, itemID := range allItemIDs {
		_ = h.db.Create(&models.MenuDiscountItem{
			DiscountID: discount.ID,
			MenuItemID: itemID,
		})
	}

	var menuItems []models.MenuItem
	if len(allItemIDs) > 0 {
		h.db.Where("id IN ?", allItemIDs).Find(&menuItems)
	}
	itemNames := make([]string, 0, len(menuItems))
	for _, mi := range menuItems {
		itemNames = append(itemNames, mi.Name)
	}

	actorName := "Admin"
	var actorID *uint
	if accVal := r.Context().Value(middleware.AccountContextKey); accVal != nil {
		acc := accVal.(*models.Account)
		actorName = acc.Name
		actorID = &acc.ID
	}
	_ = h.db.Create(&models.AdminEvent{
		EventType: "menu_discount_updated",
		Message:   fmt.Sprintf("%d%% discount campaign updated by %s", discount.DiscountPercent, actorName),
		ActorID:   actorID,
		CreatedAt: time.Now().UTC(),
		Details:   fmt.Sprintf(`{"discount_id":%d,"percent":%d}`, discount.ID, discount.DiscountPercent),
	})

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"id":                   discount.ID,
		"campaign_name":        discount.CampaignName,
		"menu_item_ids":        allItemIDs,
		"custom_menu_item_ids": []uint{},
		"menu_item_names":      itemNames,
		"discount_percent":     discount.DiscountPercent,
		"starts_at":            discount.StartsAt.Format(time.RFC3339),
		"ends_at":              discount.EndsAt.Format(time.RFC3339),
		"created_at":           discount.CreatedAt,
	})
}

func (h *AdminHandler) DeleteDiscount(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "discount_id")
	_ = h.db.Where("discount_id = ?", idStr).Delete(&models.MenuDiscountItem{})
	_ = h.db.Delete(&models.MenuDiscount{}, idStr)
	w.WriteHeader(http.StatusNoContent)
}

func (h *AdminHandler) ListEmailImages(w http.ResponseWriter, r *http.Request) {
	sm := storage.GetStorage()
	if sm != nil {
		images, err := sm.ListEmailImages(r.Context())
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(images)
			return
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode([]any{})
}

func (h *AdminHandler) UploadEmailImage(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(5 << 20); err != nil {
		http.Error(w, `{"detail":"Invalid file upload"}`, http.StatusBadRequest)
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, `{"detail":"Invalid file upload"}`, http.StatusBadRequest)
		return
	}
	defer file.Close()

	fileBytes, err := io.ReadAll(file)
	if err != nil {
		http.Error(w, `{"detail":"Failed to read file"}`, http.StatusInternalServerError)
		return
	}

	contentType := header.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "image/jpeg"
	}

	sm := storage.GetStorage()
	if sm != nil {
		res, err := sm.UploadEmailImage(r.Context(), fileBytes, header.Filename, contentType)
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(res)
			return
		}
	}
	http.Error(w, `{"detail":"Failed to upload email image"}`, http.StatusInternalServerError)
}

func (h *AdminHandler) DeleteEmailImage(w http.ResponseWriter, r *http.Request) {
	filename := chi.URLParam(r, "filename")
	sm := storage.GetStorage()
	if sm != nil {
		_ = sm.DeleteEmailImage(r.Context(), filename)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"deleted":  true,
		"filename": filename,
	})
}

// -------------------------------------------------------------
// DATABASE BACKUP ENDPOINTS
// -------------------------------------------------------------

func (h *AdminHandler) TriggerDatabaseBackup(w http.ResponseWriter, r *http.Request) {
	meta, err := h.performDatabaseBackup()
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"detail":"Database backup failed: %v"}`, err), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(meta)
}

func (h *AdminHandler) ListDatabaseBackups(w http.ResponseWriter, r *http.Request) {
	backupsDir := filepath.Join("backups")
	files, _ := os.ReadDir(backupsDir)
	type BackupItem struct {
		Filename  string    `json:"filename"`
		GCSURI    string    `json:"gcs_uri"`
		SizeBytes int64     `json:"size_bytes"`
		SizeMB    float64   `json:"size_mb"`
		CreatedAt time.Time `json:"created_at"`
		UpdatedAt time.Time `json:"updated_at"`
	}
	items := make([]BackupItem, 0)
	for _, f := range files {
		if f.IsDir() || !strings.HasSuffix(f.Name(), ".gz") {
			continue
		}
		info, err := f.Info()
		if err != nil {
			continue
		}
		items = append(items, BackupItem{
			Filename:  f.Name(),
			GCSURI:    fmt.Sprintf("gs://kebabzilla_cloud_storage/backups/%s", f.Name()),
			SizeBytes: info.Size(),
			SizeMB:    math.Round((float64(info.Size())/(1024*1024))*100) / 100,
			CreatedAt: info.ModTime(),
			UpdatedAt: info.ModTime(),
		})
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].CreatedAt.After(items[j].CreatedAt)
	})
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(items)
}

func (h *AdminHandler) SystemDatabaseBackup(w http.ResponseWriter, r *http.Request) {
	expected := strings.TrimSpace(h.cfg.JWTSecret)
	provided := strings.TrimSpace(r.Header.Get("x-backup-token"))
	if provided == "" {
		provided = strings.TrimSpace(r.URL.Query().Get("token"))
	}
	if expected == "" || provided == "" || subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) != 1 {
		http.Error(w, `{"detail":"Unauthorized backup request"}`, http.StatusUnauthorized)
		return
	}
	meta, err := h.performDatabaseBackup()
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"detail":"Database backup failed: %v"}`, err), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(meta)
}

func (h *AdminHandler) performDatabaseBackup() (map[string]any, error) {
	startTime := time.Now()
	loc := time.FixedZone("IST", 5*3600+1800)
	now := time.Now().In(loc)
	filename := fmt.Sprintf("supabase_backup_%s.sql.gz", now.Format("2006-01-02_150405"))
	backupsDir := filepath.Join("backups")
	_ = os.MkdirAll(backupsDir, 0755)
	filePath := filepath.Join(backupsDir, filename)

	f, err := os.Create(filePath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	gw := gzip.NewWriter(f)

	_, _ = fmt.Fprintf(gw, "-- KebabZilla Automated Database Backup\n-- Created: %s\n\n", now.Format(time.RFC3339))

	var accounts []models.Account
	h.db.Find(&accounts)
	accBytes, _ := json.Marshal(accounts)
	_, _ = fmt.Fprintf(gw, "-- ACCOUNTS TABLE (%d rows)\n-- %s\n\n", len(accounts), string(accBytes))

	var orders []models.Order
	h.db.Find(&orders)
	ordBytes, _ := json.Marshal(orders)
	_, _ = fmt.Fprintf(gw, "-- ORDERS TABLE (%d rows)\n-- %s\n\n", len(orders), string(ordBytes))

	_ = gw.Flush()
	_ = gw.Close()
	_ = f.Close()

	info, _ := os.Stat(filePath)
	sizeBytes := int64(0)
	if info != nil {
		sizeBytes = info.Size()
	}

	duration := time.Since(startTime).Seconds()
	return map[string]any{
		"status":           "success",
		"filename":         filename,
		"gcs_uri":          fmt.Sprintf("gs://kebabzilla_cloud_storage/backups/%s", filename),
		"size_bytes":       sizeBytes,
		"size_mb":          math.Round((float64(sizeBytes)/(1024*1024))*100) / 100,
		"duration_seconds": math.Round(duration*100) / 100,
	}, nil
}
