package handlers

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/kebabzilla/go-backend/clustering"
	"github.com/kebabzilla/go-backend/config"
	"github.com/kebabzilla/go-backend/mailer"
	"github.com/kebabzilla/go-backend/middleware"
	"github.com/kebabzilla/go-backend/models"
	"gorm.io/gorm"
)

type StaffDeliveryHandler struct {
	cfg *config.Config
	db  *gorm.DB
}

func NewStaffDeliveryHandler(cfg *config.Config, db *gorm.DB) *StaffDeliveryHandler {
	return &StaffDeliveryHandler{cfg: cfg, db: db}
}

// Kitchen Queue: GET /api/v1/staff/orders
func (h *StaffDeliveryHandler) GetKitchenQueue(w http.ResponseWriter, r *http.Request) {
	statusFilter := strings.TrimSpace(r.URL.Query().Get("status_filter"))

	tx := h.db.Preload("Items.MenuItem").Preload("Payment").Preload("Customer").Preload("AssignedDriver")

	if statusFilter != "" && statusFilter != "ALL" && statusFilter != "all" {
		tx = tx.Where("orders.status = ?", statusFilter)
	} else {
		tx = tx.Where("orders.status IN ?", []models.OrderStatus{
			models.OrderStatusPlaced,
			models.OrderStatusAccepted,
			models.OrderStatusPreparing,
			models.OrderStatusReady,
		})
	}

	var orders []models.Order
	tx.Order("created_at asc").Limit(200).Find(&orders)

	resps := make([]OrderResponse, 0, len(orders))
	for i := range orders {
		email := ""
		if orders[i].Customer != nil {
			email = orders[i].Customer.Email
		}
		resps = append(resps, formatOrderResponse(&orders[i], email))
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resps)
}

// Transition Kitchen Order State: POST & PATCH /api/v1/staff/orders/{order_id}/status & /transition
func (h *StaffDeliveryHandler) TransitionKitchenOrder(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "order_id")

	var req struct {
		Status models.OrderStatus `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"detail":"Invalid payload"}`, http.StatusBadRequest)
		return
	}

	if req.Status == models.OrderStatusOutForDelivery {
		http.Error(w, `{"detail":"A delivery partner must take this order from the delivery queue"}`, http.StatusBadRequest)
		return
	}
	if req.Status == models.OrderStatusDelivered {
		http.Error(w, `{"detail":"A delivery partner must verify the customer’s code to complete delivery"}`, http.StatusBadRequest)
		return
	}

	var order models.Order
	if err := h.db.Preload("Items.MenuItem").Preload("Payment").Preload("Customer").Preload("AssignedDriver").
		Where("order_id = ?", orderID).First(&order).Error; err != nil {
		http.Error(w, `{"detail":"Order not found"}`, http.StatusNotFound)
		return
	}

	oldStatus := order.Status
	order.Status = req.Status
	order.UpdatedAt = time.Now().UTC()
	h.db.Save(&order)

	// If cancelled/rejected, clean up payment record per policy
	if req.Status == models.OrderStatusCancelled || req.Status == models.OrderStatusRejected {
		var payment models.Payment
		if err := h.db.Where("order_id = ?", order.OrderID).First(&payment).Error; err == nil {
			if payment.Method == models.PaymentMethodCash {
				h.db.Delete(&payment)
			} else {
				payment.Status = models.PaymentStatusRefunded
				payment.UpdatedAt = time.Now().UTC()
				h.db.Save(&payment)
			}
		}
	}

	actorName := "Staff member"
	var actorID *uint
	if accVal := r.Context().Value(middleware.AccountContextKey); accVal != nil {
		acc := accVal.(*models.Account)
		actorName = acc.Name
		actorID = &acc.ID
	}
	_ = h.db.Create(&models.AdminEvent{
		EventType: "order_status",
		Message:   fmt.Sprintf("Order %s status changed to %s by %s", order.OrderID, order.Status, actorName),
		ActorID:   actorID,
		CreatedAt: time.Now().UTC(),
		Details:   fmt.Sprintf(`{"order_id":"%s","from_status":"%s","status":"%s"}`, order.OrderID, oldStatus, order.Status),
	})

	email := ""
	if order.Customer != nil {
		email = order.Customer.Email
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(formatOrderResponse(&order, email))
}


// Delivery Recommended Batches (ALNS): GET /api/v1/delivery/recommended-batches
func (h *StaffDeliveryHandler) GetRecommendedBatches(w http.ResponseWriter, r *http.Request) {
	account := r.Context().Value(middleware.AccountContextKey).(*models.Account)
	var setting models.RestaurantSettings
	_ = h.db.First(&setting)

	restLat := 22.3850
	restLon := 88.2430
	if setting.Latitude != nil {
		restLat = *setting.Latitude
	}
	if setting.Longitude != nil {
		restLon = *setting.Longitude
	}

	isOpen := setting.AcceptingOrders
	schedStatus := "OPEN"
	if !isOpen {
		schedStatus = "CLOSED"
	}

	var activeRiders int64
	h.db.Table("staff_info").
		Joins("JOIN accounts ON accounts.id = staff_info.account_id").
		Where("accounts.role IN ('DELIVERY', 'ADMIN') AND staff_info.is_accepting_deliveries = true").
		Count(&activeRiders)

	isAccepting := false
	var staff models.StaffInfo
	if err := h.db.Where("account_id = ?", account.ID).First(&staff).Error; err == nil {
		isAccepting = staff.IsAcceptingDeliveries
	}

	if !isOpen {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"is_accepting_deliveries": false,
			"active_riders":           0,
			"is_restaurant_open":      false,
			"schedule_status":         schedStatus,
			"single_order":            false,
			"order":                   nil,
			"clusters":                []any{},
			"restaurant_latitude":     restLat,
			"restaurant_longitude":    restLon,
		})
		return
	}

	if account.Role == models.RoleDelivery && !isAccepting {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"is_accepting_deliveries": false,
			"active_riders":           activeRiders,
			"is_restaurant_open":      true,
			"schedule_status":         schedStatus,
			"single_order":            false,
			"order":                   nil,
			"clusters":                []any{},
			"restaurant_latitude":     restLat,
			"restaurant_longitude":    restLon,
		})
		return
	}

	var orders []models.Order
	h.db.Preload("Items.MenuItem").Preload("Payment").Preload("Customer").
		Where("status = ?", models.OrderStatusReady).
		Where("assigned_delivery_id IS NULL").
		Order("created_at asc").
		Find(&orders)

	if len(orders) == 0 {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"is_accepting_deliveries": isAccepting,
			"active_riders":           activeRiders,
			"is_restaurant_open":      true,
			"schedule_status":         schedStatus,
			"single_order":            false,
			"order":                   nil,
			"clusters":                []any{},
			"restaurant_latitude":     restLat,
			"restaurant_longitude":    restLon,
		})
		return
	}

	var nodes []clustering.LocationNode
	formattedOrders := make([]OrderResponse, 0, len(orders))
	for i := range orders {
		o := &orders[i]
		formattedOrders = append(formattedOrders, formatOrderResponseOpts(o, "", false, false))

		lat := restLat
		lon := restLon
		if o.Latitude != nil {
			lat = *o.Latitude
		}
		if o.Longitude != nil {
			lon = *o.Longitude
		}
		nodes = append(nodes, clustering.LocationNode{
			ID:        o.OrderID,
			OrderID:   o.OrderID,
			Latitude:  lat,
			Longitude: lon,
			Address:   o.Address,
		})
	}

	routingFactor := setting.HaversineRoutingFactor
	if routingFactor <= 1.0 {
		routingFactor = clustering.DefaultRoutingFactor
	}

	type ClusterOut struct {
		ID                   string          `json:"id"`
		RouteLabel           string          `json:"route_label"`
		Orders               []OrderResponse `json:"orders"`
		RoundTripKm          float64         `json:"round_trip_km"`
		RoundTripTimeMinutes float64         `json:"round_trip_time_minutes"`
	}

	if len(orders) == 1 {
		singlePayload := formattedOrders[0]
		distKm := clustering.RoadDistanceKm(restLat, restLon, nodes[0].Latitude, nodes[0].Longitude, routingFactor)
		rtKm := math.Round(distKm*2.0*100) / 100
		rtMins := math.Round(clustering.TravelTimeMinutes(rtKm, clustering.DefaultSpeedKmh)*10) / 10

		clusters := []ClusterOut{
			{
				ID:                   singlePayload.OrderID,
				RouteLabel:           fmt.Sprintf("Single delivery · Order #%s", singlePayload.OrderID),
				Orders:               []OrderResponse{singlePayload},
				RoundTripKm:          rtKm,
				RoundTripTimeMinutes: rtMins,
			},
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"is_accepting_deliveries": isAccepting,
			"active_riders":           activeRiders,
			"is_restaurant_open":      true,
			"schedule_status":         schedStatus,
			"single_order":            true,
			"order":                   singlePayload,
			"round_trip_km":           rtKm,
			"round_trip_time_minutes": rtMins,
			"clusters":                clusters,
			"restaurant_latitude":     restLat,
			"restaurant_longitude":    restLon,
		})
		return
	}

	clusters := clustering.OptimizeBatches(restLat, restLon, nodes, 4, routingFactor)
	orderMap := make(map[string]OrderResponse)
	for _, fo := range formattedOrders {
		orderMap[fo.OrderID] = fo
	}

	outClusters := make([]ClusterOut, 0, len(clusters))
	for _, c := range clusters {
		cOrders := make([]OrderResponse, 0, len(c.Orders))
		for _, cord := range c.Orders {
			if fo, ok := orderMap[cord.OrderID]; ok {
				cOrders = append(cOrders, fo)
			}
		}
		outClusters = append(outClusters, ClusterOut{
			ID:                   c.BatchID,
			RouteLabel:           c.RouteLabel,
			Orders:               cOrders,
			RoundTripKm:          c.TotalDistanceKm,
			RoundTripTimeMinutes: c.EstimatedMins,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"is_accepting_deliveries": isAccepting,
		"active_riders":           activeRiders,
		"is_restaurant_open":      true,
		"schedule_status":         schedStatus,
		"single_order":            false,
		"order":                   nil,
		"clusters":                outClusters,
		"restaurant_latitude":     restLat,
		"restaurant_longitude":    restLon,
	})
}

// Claim Recommended Batches: POST /api/v1/delivery/recommended-batches/claim
func (h *StaffDeliveryHandler) ClaimRecommendedBatches(w http.ResponseWriter, r *http.Request) {
	account := r.Context().Value(middleware.AccountContextKey).(*models.Account)
	var req struct {
		OrderIDs []string `json:"order_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.OrderIDs) == 0 {
		http.Error(w, `{"detail":"Invalid batch claim payload"}`, http.StatusBadRequest)
		return
	}

	tx := h.db.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	var orders []models.Order
	if err := tx.Preload("Customer").Where("order_id IN ? AND status = ? AND assigned_delivery_id IS NULL", req.OrderIDs, models.OrderStatusReady).Find(&orders).Error; err != nil || len(orders) != len(req.OrderIDs) {
		tx.Rollback()
		http.Error(w, `{"detail":"This batch was already claimed or has changed. Refresh to see the remaining deliveries."}`, http.StatusConflict)
		return
	}

	now := time.Now().UTC()
	otpExpiresAt := now.Add(12 * time.Hour)

	type notifData struct {
		email        string
		customerName string
		orderID      string
		otp          string
	}
	var notifications []notifData

	for i := range orders {
		res := tx.Model(&models.Order{}).Where("order_id = ? AND status = ? AND assigned_delivery_id IS NULL", orders[i].OrderID, models.OrderStatusReady).Updates(map[string]any{
			"assigned_delivery_id": account.ID,
			"status":               models.OrderStatusOutForDelivery,
			"delivery_started_at":  now,
			"updated_at":           now,
		})
		if res.RowsAffected != 1 {
			tx.Rollback()
			http.Error(w, `{"detail":"This batch was just claimed by another rider. Refresh to see the remaining deliveries."}`, http.StatusConflict)
			return
		}

		otp := fmt.Sprintf("%06d", (time.Now().UnixNano()/100)%1000000)
		orders[i].DeliveryOTPCiphertext = &otp
		orders[i].DeliveryOTPExpiresAt = &otpExpiresAt
		orders[i].DeliveryOTPAttempts = 0
		_ = tx.Model(&orders[i]).Updates(map[string]any{
			"delivery_otp_ciphertext": otp,
			"delivery_otp_expires_at": otpExpiresAt,
			"delivery_otp_attempts":   0,
		})

		_ = tx.Where("order_id = ? AND purpose = ?", orders[i].OrderID, "delivery").Delete(&models.AllOtp{})
		var custEmail *string
		if orders[i].Customer != nil && orders[i].Customer.Email != "" {
			custEmail = &orders[i].Customer.Email
		}
		_ = tx.Create(&models.AllOtp{
			Purpose:   "delivery",
			OtpCode:   otp,
			OrderID:   &orders[i].OrderID,
			AccountID: orders[i].CustomerID,
			Email:     custEmail,
			ExpiresAt: otpExpiresAt,
			CreatedAt: now,
		})

		custName := "there"
		if orders[i].CustomerName != nil && *orders[i].CustomerName != "" {
			custName = *orders[i].CustomerName
		} else if orders[i].Customer != nil && orders[i].Customer.Name != "" {
			custName = orders[i].Customer.Name
		}
		if custEmail != nil && *custEmail != "" {
			notifications = append(notifications, notifData{
				email:        *custEmail,
				customerName: custName,
				orderID:      orders[i].OrderID,
				otp:          otp,
			})
		}
	}

	stopLabel := "stop"
	if len(orders) != 1 {
		stopLabel = "stops"
	}
	routeLabel := fmt.Sprintf("Nearby delivery route · %d %s", len(orders), stopLabel)
	batch := models.DeliveryBatch{
		DeliveryID: account.ID,
		RouteLabel: routeLabel,
		Status:     "ACTIVE",
		CreatedAt:  now,
	}
	_ = tx.Create(&batch)

	for _, o := range orders {
		_ = tx.Create(&models.DeliveryBatchOrder{
			BatchID: batch.ID,
			OrderID: o.OrderID,
		})
	}

	detailsJSON, _ := json.Marshal(map[string]any{"order_ids": req.OrderIDs, "delivery_id": account.ID})
	_ = tx.Create(&models.AdminEvent{
		EventType: "delivery_batch_claimed",
		Message:   fmt.Sprintf("%s took a %d-stop delivery batch", account.Name, len(orders)),
		ActorID:   &account.ID,
		Details:   string(detailsJSON),
		CreatedAt: now,
	})

	if err := tx.Commit().Error; err != nil {
		http.Error(w, `{"detail":"Failed to commit delivery batch claim"}`, http.StatusInternalServerError)
		return
	}

	// Dispatch notifications asynchronously
	m := mailer.GetMailer()
	for _, notif := range notifications {
		m.SendDeliveryOTP(notif.customerName, notif.email, notif.otp, notif.orderID)
	}

	w.WriteHeader(http.StatusCreated)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"order_ids":   req.OrderIDs,
		"route_label": batch.RouteLabel,
	})
}

// Rider Claim Order: POST /api/v1/delivery/orders/{order_id}/claim
func (h *StaffDeliveryHandler) ClaimDeliveryOrder(w http.ResponseWriter, r *http.Request) {
	account := r.Context().Value(middleware.AccountContextKey).(*models.Account)
	orderID := chi.URLParam(r, "order_id")

	tx := h.db.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	now := time.Now().UTC()
	res := tx.Model(&models.Order{}).Where("order_id = ? AND status = ? AND assigned_delivery_id IS NULL", orderID, models.OrderStatusReady).Updates(map[string]any{
		"assigned_delivery_id": account.ID,
		"status":               models.OrderStatusOutForDelivery,
		"delivery_started_at":  now,
		"updated_at":           now,
	})
	if res.RowsAffected != 1 {
		tx.Rollback()
		http.Error(w, `{"detail":"This delivery was already taken or is no longer available"}`, http.StatusConflict)
		return
	}

	var order models.Order
	if err := tx.Preload("Items.MenuItem").Preload("Payment").Preload("Customer").Preload("AssignedDriver").
		Where("order_id = ?", orderID).First(&order).Error; err != nil {
		tx.Rollback()
		http.Error(w, `{"detail":"Delivery not found"}`, http.StatusNotFound)
		return
	}

	otp := fmt.Sprintf("%06d", (time.Now().UnixNano()/100)%1000000)
	otpExpiresAt := now.Add(12 * time.Hour)
	order.DeliveryOTPCiphertext = &otp
	order.DeliveryOTPExpiresAt = &otpExpiresAt
	order.DeliveryOTPAttempts = 0
	_ = tx.Model(&order).Updates(map[string]any{
		"delivery_otp_ciphertext": otp,
		"delivery_otp_expires_at": otpExpiresAt,
		"delivery_otp_attempts":   0,
	})

	_ = tx.Where("order_id = ? AND purpose = ?", order.OrderID, "delivery").Delete(&models.AllOtp{})
	var custEmail *string
	if order.Customer != nil && order.Customer.Email != "" {
		custEmail = &order.Customer.Email
	}
	_ = tx.Create(&models.AllOtp{
		Purpose:   "delivery",
		OtpCode:   otp,
		OrderID:   &order.OrderID,
		AccountID: order.CustomerID,
		Email:     custEmail,
		ExpiresAt: otpExpiresAt,
		CreatedAt: now,
	})

	batch := models.DeliveryBatch{
		DeliveryID: account.ID,
		RouteLabel: "Single delivery route · 1 stop",
		Status:     "ACTIVE",
		CreatedAt:  now,
	}
	_ = tx.Create(&batch)
	_ = tx.Create(&models.DeliveryBatchOrder{
		BatchID: batch.ID,
		OrderID: order.OrderID,
	})

	detailsJSON, _ := json.Marshal(map[string]any{
		"order_id":      order.OrderID,
		"delivery_id":   account.ID,
		"delivery_name": account.Name,
	})
	_ = tx.Create(&models.AdminEvent{
		EventType: "delivery_claimed",
		Message:   fmt.Sprintf("%s picked order %s", account.Name, order.OrderID),
		ActorID:   &account.ID,
		Details:   string(detailsJSON),
		CreatedAt: now,
	})

	if err := tx.Commit().Error; err != nil {
		http.Error(w, `{"detail":"Failed to claim order"}`, http.StatusInternalServerError)
		return
	}

	if custEmail != nil && *custEmail != "" {
		custName := "there"
		if order.CustomerName != nil && *order.CustomerName != "" {
			custName = *order.CustomerName
		} else if order.Customer != nil && order.Customer.Name != "" {
			custName = order.Customer.Name
		}
		mailer.GetMailer().SendDeliveryOTP(custName, *custEmail, otp, order.OrderID)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(formatOrderResponseOpts(&order, "", false, false))
}

// Create Custom Delivery Batch: POST /api/v1/delivery/batches
func (h *StaffDeliveryHandler) CreateBatch(w http.ResponseWriter, r *http.Request) {
	account := r.Context().Value(middleware.AccountContextKey).(*models.Account)
	var req struct {
		OrderIDs   []string `json:"order_ids"`
		RouteLabel string   `json:"route_label"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.OrderIDs) == 0 {
		http.Error(w, `{"detail":"Invalid batch payload"}`, http.StatusBadRequest)
		return
	}

	// Verify orders belong to driver and are OUT_FOR_DELIVERY
	var count int64
	h.db.Model(&models.Order{}).Where("order_id IN ? AND assigned_delivery_id = ? AND status = ?", req.OrderIDs, account.ID, models.OrderStatusOutForDelivery).Count(&count)
	if int(count) != len(req.OrderIDs) {
		http.Error(w, `{"detail":"All selected orders must be in your active delivery queue"}`, http.StatusBadRequest)
		return
	}

	now := time.Now().UTC()
	batch := models.DeliveryBatch{
		DeliveryID: account.ID,
		RouteLabel: req.RouteLabel,
		Status:     "ACTIVE",
		CreatedAt:  now,
	}
	if err := h.db.Create(&batch).Error; err != nil {
		http.Error(w, `{"detail":"Could not create batch"}`, http.StatusInternalServerError)
		return
	}

	for _, oid := range req.OrderIDs {
		_ = h.db.Create(&models.DeliveryBatchOrder{
			BatchID: batch.ID,
			OrderID: oid,
		})
	}

	w.WriteHeader(http.StatusCreated)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"id":          batch.ID,
		"route_label": batch.RouteLabel,
		"order_ids":   req.OrderIDs,
		"created_at":  batch.CreatedAt,
	})
}

// List Batches: GET /api/v1/delivery/batches
func (h *StaffDeliveryHandler) ListBatches(w http.ResponseWriter, r *http.Request) {
	account := r.Context().Value(middleware.AccountContextKey).(*models.Account)

	var batches []models.DeliveryBatch
	h.db.Preload("Orders").Where("delivery_id = ?", account.ID).Order("created_at desc").Limit(50).Find(&batches)

	type BatchItemOut struct {
		ID         uint      `json:"id"`
		RouteLabel string    `json:"route_label"`
		OrderIDs   []string  `json:"order_ids"`
		CreatedAt  time.Time `json:"created_at"`
	}

	res := make([]BatchItemOut, 0, len(batches))
	for _, b := range batches {
		oids := make([]string, 0, len(b.Orders))
		for _, bo := range b.Orders {
			oids = append(oids, bo.OrderID)
		}
		res = append(res, BatchItemOut{
			ID:         b.ID,
			RouteLabel: b.RouteLabel,
			OrderIDs:   oids,
			CreatedAt:  b.CreatedAt,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(res)
}


// Delivery Duty Toggle: POST /api/v1/delivery/duty
func (h *StaffDeliveryHandler) ToggleDuty(w http.ResponseWriter, r *http.Request) {
	account := r.Context().Value(middleware.AccountContextKey).(*models.Account)

	var staff models.StaffInfo
	err := h.db.Where("account_id = ?", account.ID).First(&staff).Error
	if err != nil {
		role := account.Role
		staff = models.StaffInfo{
			AccountID:             account.ID,
			Role:                  &role,
			IsAcceptingDeliveries: true,
			UpdatedAt:             time.Now().UTC(),
		}
		h.db.Create(&staff)
	} else {
		staff.IsAcceptingDeliveries = !staff.IsAcceptingDeliveries
		staff.UpdatedAt = time.Now().UTC()
		h.db.Save(&staff)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"is_accepting_deliveries": staff.IsAcceptingDeliveries,
		"is_restaurant_open":      true,
		"schedule_status":         "OPEN",
	})
}

// Delivery Duty Status: GET & POST /api/v1/delivery/duty-status
func (h *StaffDeliveryHandler) GetDeliveryDutyStatus(w http.ResponseWriter, r *http.Request) {
	account := r.Context().Value(middleware.AccountContextKey).(*models.Account)

	var setting models.RestaurantSettings
	_ = h.db.First(&setting)

	isOpen := setting.AcceptingOrders
	scheduleStatus := "OPEN"
	if !isOpen {
		scheduleStatus = "Closed"
	}

	var staff models.StaffInfo
	err := h.db.Where("account_id = ?", account.ID).First(&staff).Error
	if err != nil {
		role := account.Role
		staff = models.StaffInfo{
			AccountID:             account.ID,
			Role:                  &role,
			IsAcceptingDeliveries: false,
			UpdatedAt:             time.Now().UTC(),
		}
		_ = h.db.Create(&staff)
	}

	if r.Method == http.MethodPost {
		var req struct {
			Accepting             *bool    `json:"accepting"`
			IsAccepting           *bool    `json:"is_accepting"`
			IsAcceptingDeliveries *bool    `json:"is_accepting_deliveries"`
			Latitude              *float64 `json:"latitude"`
			Longitude             *float64 `json:"longitude"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err == nil {
			target := !staff.IsAcceptingDeliveries
			if req.Accepting != nil {
				target = *req.Accepting
			} else if req.IsAcceptingDeliveries != nil {
				target = *req.IsAcceptingDeliveries
			} else if req.IsAccepting != nil {
				target = *req.IsAccepting
			}

			if target {
				if !isOpen {
					http.Error(w, fmt.Sprintf(`{"detail":"Cannot start accepting deliveries outside restaurant operating hours (%s)."}`, scheduleStatus), http.StatusBadRequest)
					return
				}
				if setting.EnforceDriverGeofence {
					if req.Latitude == nil || req.Longitude == nil {
						http.Error(w, `{"detail":"GPS location access is required to verify you are at the restaurant before accepting deliveries."}`, http.StatusBadRequest)
						return
					}
					if setting.Latitude != nil && setting.Longitude != nil {
						rf := setting.HaversineRoutingFactor
						if rf <= 1.0 {
							rf = clustering.DefaultRoutingFactor
						}
						distM := clustering.RoadDistanceKm(*setting.Latitude, *setting.Longitude, *req.Latitude, *req.Longitude, rf) * 1000.0
						maxM := float64(setting.DriverGeofenceMeters)
						if maxM <= 0 {
							maxM = 500
						}
						if distM > maxM {
							http.Error(w, fmt.Sprintf(`{"detail":"You are currently %d meters away from the restaurant. You must be within %d meters to accept deliveries."}`, int(distM), int(maxM)), http.StatusBadRequest)
							return
						}
					}
				}
			}

			staff.IsAcceptingDeliveries = target
			staff.UpdatedAt = time.Now().UTC()
			_ = h.db.Save(&staff)
		}
	} else {
		if !isOpen && staff.IsAcceptingDeliveries {
			staff.IsAcceptingDeliveries = false
			staff.UpdatedAt = time.Now().UTC()
			_ = h.db.Save(&staff)
		}
	}

	var activeRiders int64
	h.db.Model(&models.StaffInfo{}).
		Joins("JOIN accounts ON accounts.id = staff_info.account_id").
		Where("accounts.role IN ('DELIVERY', 'ADMIN') AND staff_info.is_accepting_deliveries = true").
		Count(&activeRiders)

	geofenceMeters := setting.DriverGeofenceMeters
	if geofenceMeters <= 0 {
		geofenceMeters = 500
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"is_accepting_deliveries": staff.IsAcceptingDeliveries,
		"is_restaurant_open":      isOpen,
		"schedule_status":         scheduleStatus,
		"enforce_geofence":        setting.EnforceDriverGeofence,
		"geofence_meters":         geofenceMeters,
		"restaurant_latitude":     setting.Latitude,
		"restaurant_longitude":    setting.Longitude,
		"active_riders":           activeRiders,
	})
}

// Active Delivery Queue for Rider: GET /api/v1/delivery/queue
func (h *StaffDeliveryHandler) GetDeliveryQueue(w http.ResponseWriter, r *http.Request) {
	account := r.Context().Value(middleware.AccountContextKey).(*models.Account)

	var orders []models.Order
	h.db.Preload("Items.MenuItem").Preload("Payment").Preload("Customer").Preload("AssignedDriver").
		Where("assigned_delivery_id = ? AND status = ?", account.ID, models.OrderStatusOutForDelivery).
		Order("created_at asc").Find(&orders)

	resps := make([]OrderResponse, 0, len(orders))
	for i := range orders {
		resp := formatOrderResponseOpts(&orders[i], "", false, false)
		resp.Address = ""
		resp.CustomerPhone = nil
		resps = append(resps, resp)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resps)
}

// Available Unassigned Ready Deliveries: GET /api/v1/delivery/available
func (h *StaffDeliveryHandler) GetDeliveryAvailable(w http.ResponseWriter, r *http.Request) {
	account := r.Context().Value(middleware.AccountContextKey).(*models.Account)

	if account.Role == models.RoleDelivery {
		var staff models.StaffInfo
		if err := h.db.Where("account_id = ?", account.ID).First(&staff).Error; err != nil || !staff.IsAcceptingDeliveries {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode([]OrderResponse{})
			return
		}
	}

	var orders []models.Order
	h.db.Preload("Items.MenuItem").Preload("Payment").Preload("Customer").Preload("AssignedDriver").
		Where("status = ? AND assigned_delivery_id IS NULL", models.OrderStatusReady).
		Order("created_at asc").Find(&orders)

	resps := make([]OrderResponse, 0, len(orders))
	for i := range orders {
		resps = append(resps, formatOrderResponseOpts(&orders[i], "", false, false))
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resps)
}

// Rider Delivery History: GET /api/v1/delivery/history
func (h *StaffDeliveryHandler) GetDeliveryHistory(w http.ResponseWriter, r *http.Request) {
	account := r.Context().Value(middleware.AccountContextKey).(*models.Account)

	var orders []models.Order
	h.db.Preload("Items.MenuItem").Preload("Payment").Preload("Customer").Preload("AssignedDriver").
		Where("assigned_delivery_id = ? AND status = ?", account.ID, models.OrderStatusDelivered).
		Order("delivered_at desc, created_at desc").Limit(50).Find(&orders)

	resps := make([]OrderResponse, 0, len(orders))
	for i := range orders {
		resps = append(resps, formatOrderResponseOpts(&orders[i], "", false, false))
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resps)
}

func VerifyOTPCode(candidateOTP, storedOTP string, attempts int, expiresAt, now time.Time) (bool, int, bool) {
	if expiresAt.Before(now) || attempts >= 5 {
		return false, attempts, true
	}
	if subtle.ConstantTimeCompare([]byte(strings.TrimSpace(candidateOTP)), []byte(strings.TrimSpace(storedOTP))) == 1 {
		return true, 0, true
	}
	nextAtt := attempts + 1
	return false, nextAtt, nextAtt >= 5
}

// Verify Delivery OTP: POST /api/v1/delivery/orders/{order_id}/verify-otp
func (h *StaffDeliveryHandler) VerifyDeliveryOTP(w http.ResponseWriter, r *http.Request) {
	account := r.Context().Value(middleware.AccountContextKey).(*models.Account)
	orderID := chi.URLParam(r, "order_id")

	var req struct {
		OTP string `json:"otp"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.OTP) == "" {
		http.Error(w, `{"detail":"Delivery completion OTP is required"}`, http.StatusBadRequest)
		return
	}

	var order models.Order
	if err := h.db.Preload("Items.MenuItem").Preload("Payment").Preload("Customer").Preload("AssignedDriver").
		Where("order_id = ?", orderID).First(&order).Error; err != nil || order.AssignedDeliveryID == nil || *order.AssignedDeliveryID != account.ID || order.Status != models.OrderStatusOutForDelivery {
		http.Error(w, `{"detail":"Active delivery not found"}`, http.StatusNotFound)
		return
	}

	if order.DeliveryOTPAttempts >= 5 {
		http.Error(w, `{"detail":"Too many incorrect delivery code attempts. Please contact the customer or dispatch."}`, http.StatusTooManyRequests)
		return
	}

	otpClean := strings.TrimSpace(req.OTP)
	now := time.Now().UTC()

	var otpRecord models.AllOtp
	err := h.db.Where("order_id = ? AND purpose = ?", order.OrderID, "delivery").
		Order("created_at desc").First(&otpRecord).Error

	otpValid := false
	if err == nil {
		var shouldDelete bool
		otpValid, otpRecord.Attempts, shouldDelete = VerifyOTPCode(otpClean, otpRecord.OtpCode, otpRecord.Attempts, otpRecord.ExpiresAt, now)
		if shouldDelete {
			_ = h.db.Delete(&otpRecord)
		} else {
			_ = h.db.Save(&otpRecord)
		}
	}

	// Fallback to order.DeliveryOTPCiphertext
	if !otpValid && order.DeliveryOTPCiphertext != nil && order.DeliveryOTPExpiresAt != nil {
		if !order.DeliveryOTPExpiresAt.Before(now) {
			if subtle.ConstantTimeCompare([]byte(otpClean), []byte(strings.TrimSpace(*order.DeliveryOTPCiphertext))) == 1 {
				otpValid = true
			}
		}
	}

	if !otpValid {
		order.DeliveryOTPAttempts++
		_ = h.db.Model(&order).Update("delivery_otp_attempts", order.DeliveryOTPAttempts)
		http.Error(w, `{"detail":"The delivery code is incorrect or expired"}`, http.StatusBadRequest)
		return
	}

	order.DeliveryOTPAttempts = 0
	order.DeliveryOTPCiphertext = nil
	order.DeliveryOTPExpiresAt = nil
	order.Status = models.OrderStatusDelivered
	order.DeliveredAt = &now
	order.UpdatedAt = now
	h.db.Save(&order)

	_ = h.db.Create(&models.AdminEvent{
		EventType: "order_delivered",
		Message:   fmt.Sprintf("Order %s delivered by %s", order.OrderID, account.Name),
		ActorID:   &account.ID,
		Details:   fmt.Sprintf(`{"order_id":"%s","delivery_id":%d,"delivery_name":"%s"}`, order.OrderID, account.ID, account.Name),
		CreatedAt: now,
	})

	// Mark payment as paid if cash
	if order.Payment != nil && order.Payment.Method == models.PaymentMethodCash {
		order.Payment.Status = models.PaymentStatusPaid
		order.Payment.UpdatedAt = now
		h.db.Save(order.Payment)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(formatOrderResponseOpts(&order, "", false, false))
}

// -------------------------------------------------------------
// STAFF MENU PAUSES & WALK-IN
// -------------------------------------------------------------

// Staff Menu: GET /api/v1/staff/menu
func (h *StaffDeliveryHandler) GetStaffMenu(w http.ResponseWriter, r *http.Request) {
	var items []models.MenuItem
	h.db.Order("name asc").Find(&items)

	results := make([]map[string]any, 0, len(items))
	for _, it := range items {
		isPaused := it.PausedUntil != nil && it.PausedUntil.After(time.Now().UTC())
		results = append(results, map[string]any{
			"id":             it.ID,
			"name":           it.Name,
			"description":    it.Description,
			"price_paise":    it.PricePaise,
			"is_vegetarian":  it.IsVegetarian,
			"is_available":   it.IsAvailable,
			"is_paused":      isPaused,
			"paused_until":   it.PausedUntil,
			"is_customizable": it.IsCustomizable,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(results)
}

// Staff Menu Pauses: GET /api/v1/staff/menu-pauses
func (h *StaffDeliveryHandler) GetStaffMenuPauses(w http.ResponseWriter, r *http.Request) {
	now := time.Now().UTC()
	var pausedItems []models.MenuItem
	h.db.Where("paused_until > ?", now).Find(&pausedItems)

	type PauseOut struct {
		MenuItemID   uint      `json:"menu_item_id"`
		EmployeeName string    `json:"employee_name"`
		PausedUntil  time.Time `json:"paused_until"`
	}

	items := make([]PauseOut, 0, len(pausedItems))
	for _, it := range pausedItems {
		items = append(items, PauseOut{
			MenuItemID:   it.ID,
			EmployeeName: "Kitchen Staff",
			PausedUntil:  *it.PausedUntil,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(items)
}

// Pause Menu Item: POST /api/v1/staff/menu/{item_id}/pause
func (h *StaffDeliveryHandler) PauseMenuItem(w http.ResponseWriter, r *http.Request) {
	itemID := chi.URLParam(r, "item_id")
	var item models.MenuItem
	if err := h.db.First(&item, itemID).Error; err != nil {
		http.Error(w, `{"detail":"Menu item not found"}`, http.StatusNotFound)
		return
	}

	durationMins := 120
	var req struct {
		DurationMinutes int `json:"duration_minutes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err == nil && req.DurationMinutes > 0 {
		durationMins = req.DurationMinutes
	}

	until := time.Now().UTC().Add(time.Duration(durationMins) * time.Minute)
	item.PausedUntil = &until
	h.db.Save(&item)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"id":           item.ID,
		"paused_until": item.PausedUntil,
		"is_paused":    true,
	})
}

// Resume Menu Item: DELETE /api/v1/staff/menu/{item_id}/pause
func (h *StaffDeliveryHandler) ResumeMenuItem(w http.ResponseWriter, r *http.Request) {
	itemID := chi.URLParam(r, "item_id")
	var item models.MenuItem
	if err := h.db.First(&item, itemID).Error; err != nil {
		http.Error(w, `{"detail":"Menu item not found"}`, http.StatusNotFound)
		return
	}

	item.PausedUntil = nil
	item.PausedByID = nil
	h.db.Save(&item)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"id":        item.ID,
		"is_paused": false,
	})
}

// Walk-in Order Creation: POST /api/v1/staff/walk-in
func (h *StaffDeliveryHandler) CreateWalkInOrder(w http.ResponseWriter, r *http.Request) {
	customerName := r.URL.Query().Get("customer_name")
	if customerName == "" {
		customerName = "Walk-in Guest"
	}
	customerPhone := r.URL.Query().Get("phone")

	var req struct {
		Items []struct {
			MenuItemID     *uint   `json:"menu_item_id"`
			VariationName  *string `json:"variation_name"`
			Quantity       int     `json:"quantity"`
			UnitPricePaise int     `json:"unit_price_paise"`
		} `json:"items"`
		PaymentMethod string `json:"payment_method"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"detail":"Invalid walk-in payload"}`, http.StatusBadRequest)
		return
	}

	now := time.Now().UTC()
	orderID := NextOrderID(h.db)

	var phonePtr *string
	if customerPhone != "" {
		phonePtr = &customerPhone
	}

	order := models.Order{
		OrderID:          orderID,
		Status:           models.OrderStatusDelivered,
		DeliveredAt:      &now,
		OrderType:        "DINE_IN",
		Address:          "Restaurant counter",
		CustomerName:     &customerName,
		CustomerPhone:    phonePtr,
		DeliveryFeePaise: 0,
		CreatedAt:        now,
		UpdatedAt:        now,
	}

	if err := h.db.Create(&order).Error; err != nil {
		http.Error(w, `{"detail":"Could not create walk-in order"}`, http.StatusInternalServerError)
		return
	}

	actorName := "Staff member"
	var actorID *uint
	if accVal := r.Context().Value(middleware.AccountContextKey); accVal != nil {
		acc := accVal.(*models.Account)
		actorName = acc.Name
		actorID = &acc.ID
	}
	_ = h.db.Create(&models.AdminEvent{
		EventType: "walk_in_order",
		Message:   fmt.Sprintf("Walk-in order %s created by %s", order.OrderID, actorName),
		ActorID:   actorID,
		CreatedAt: now,
		Details:   fmt.Sprintf(`{"order_id":"%s"}`, order.OrderID),
	})

	subtotal := 0
	for _, it := range req.Items {
		price := it.UnitPricePaise
		if price <= 0 && it.MenuItemID != nil {
			var mi models.MenuItem
			if err := h.db.First(&mi, *it.MenuItemID).Error; err == nil {
				price = mi.PricePaise
			}
		}
		oi := models.OrderItem{
			OrderID:        order.OrderID,
			MenuItemID:     it.MenuItemID,
			VariationName:  it.VariationName,
			Quantity:       it.Quantity,
			UnitPricePaise: price,
			Customizations: "[]",
		}
		_ = h.db.Create(&oi)
		subtotal += price * it.Quantity
	}

	// Create payment
	pay := models.Payment{
		OrderID:     order.OrderID,
		Method:      models.PaymentMethodCash,
		Status:      models.PaymentStatusPaid,
		AmountPaise: subtotal,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	_ = h.db.Create(&pay)

	h.db.Preload("Items.MenuItem").Preload("Payment").First(&order, "order_id = ?", order.OrderID)
	w.WriteHeader(http.StatusCreated)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(formatOrderResponseOpts(&order, "", false, false))
}

// Staff Drafts: GET /api/v1/staff/drafts
func (h *StaffDeliveryHandler) GetStaffDrafts(w http.ResponseWriter, r *http.Request) {
	var drafts []models.DraftOrder
	h.db.Order("updated_at desc").Find(&drafts)

	type DraftOut struct {
		ID           uint           `json:"id"`
		CustomerName string         `json:"customer_name"`
		Payload      map[string]any `json:"payload"`
		CreatedAt    time.Time      `json:"created_at"`
		UpdatedAt    time.Time      `json:"updated_at"`
	}

	items := make([]DraftOut, 0, len(drafts))
	for _, d := range drafts {
		pMap := map[string]any{}
		if d.Payload != "" {
			_ = json.Unmarshal([]byte(d.Payload), &pMap)
		}
		items = append(items, DraftOut{
			ID:           d.ID,
			CustomerName: d.CustomerName,
			Payload:      pMap,
			CreatedAt:    d.CreatedAt,
			UpdatedAt:    d.UpdatedAt,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(items)
}

// Save Staff Draft: POST /api/v1/staff/drafts
func (h *StaffDeliveryHandler) SaveStaffDraft(w http.ResponseWriter, r *http.Request) {
	var req struct {
		CustomerName string         `json:"customer_name"`
		Payload      map[string]any `json:"payload"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"detail":"Invalid draft payload"}`, http.StatusBadRequest)
		return
	}

	var creatorID uint = 1
	if accVal := r.Context().Value(middleware.AccountContextKey); accVal != nil {
		creatorID = accVal.(*models.Account).ID
	}

	pBytes, _ := json.Marshal(req.Payload)
	now := time.Now().UTC()
	draft := models.DraftOrder{
		CreatedByID:  creatorID,
		CustomerName: req.CustomerName,
		Payload:      string(pBytes),
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	_ = h.db.Create(&draft)

	w.WriteHeader(http.StatusCreated)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(draft)
}

// Delete Staff Draft: DELETE /api/v1/staff/drafts/{draft_id}
func (h *StaffDeliveryHandler) DeleteStaffDraft(w http.ResponseWriter, r *http.Request) {
	draftID := chi.URLParam(r, "draft_id")
	h.db.Delete(&models.DraftOrder{}, draftID)
	w.WriteHeader(http.StatusNoContent)
}

func formatOrderResponseOpts(o *models.Order, email string, includeDeliveryOTP bool, includeCustomerEmail bool) OrderResponse {
	payMethodStr := ""
	payStatusStr := ""
	if o.Payment != nil {
		payMethodStr = string(o.Payment.Method)
		payStatusStr = string(o.Payment.Status)
	}

	if o.Status == models.OrderStatusCancelled || o.Status == models.OrderStatusRejected {
		if o.Payment != nil && o.Payment.Method == models.PaymentMethodCash {
			payMethodStr = ""
			payStatusStr = ""
		} else if o.Payment != nil && o.Payment.Status == models.PaymentStatusPending {
			payStatusStr = string(models.PaymentStatusRefunded)
		}
	}

	custName := "Walk-in"
	if o.CustomerName != nil && strings.TrimSpace(*o.CustomerName) != "" {
		custName = strings.TrimSpace(*o.CustomerName)
	} else if o.Customer != nil && strings.TrimSpace(o.Customer.Name) != "" {
		custName = strings.TrimSpace(o.Customer.Name)
	}

	itemsOut := make([]OrderItemOut, 0, len(o.Items))
	subtotal := 0
	for _, it := range o.Items {
		name := "Menu Item"
		unitPrice := it.UnitPricePaise
		var imageURLs []string
		var imageURL *string
		if it.MenuItem != nil {
			name = it.MenuItem.Name
			if unitPrice == 0 {
				unitPrice = it.MenuItem.PricePaise
			}
			if it.VariationName != nil && *it.VariationName != "" {
				name = fmt.Sprintf("%s (%s)", it.MenuItem.Name, *it.VariationName)
			}
			if it.MenuItem.ImageURLs != "" && it.MenuItem.ImageURLs != "[]" {
				_ = json.Unmarshal([]byte(it.MenuItem.ImageURLs), &imageURLs)
				if len(imageURLs) > 0 {
					imageURL = &imageURLs[0]
				}
			}
		} else if it.VariationName != nil {
			name = *it.VariationName
		}
		if imageURLs == nil {
			imageURLs = []string{}
		}

		customs := []any{}
		if it.Customizations != "" && it.Customizations != "[]" {
			_ = json.Unmarshal([]byte(it.Customizations), &customs)
		}

		lineTotal := unitPrice * it.Quantity
		subtotal += lineTotal
		itemsOut = append(itemsOut, OrderItemOut{
			ID:             it.ID,
			MenuItemID:     it.MenuItemID,
			Name:           name,
			Quantity:       it.Quantity,
			UnitPricePaise: unitPrice,
			PricePaise:     unitPrice,
			LineTotalPaise: lineTotal,
			TaxPercent:     0,
			TaxPaise:       0,
			VariationName:  it.VariationName,
			Customizations: customs,
			ImageURL:       imageURL,
			ImageURLs:      imageURLs,
		})
	}

	var pm *string
	if payMethodStr != "" {
		pm = &payMethodStr
	}
	var ps *string
	if payStatusStr != "" {
		ps = &payStatusStr
	}

	var dName *string
	var dPhone *string
	if o.AssignedDriver != nil {
		dName = &o.AssignedDriver.Name
		dPhone = o.AssignedDriver.Phone
	}

	var otpPtr *string
	if includeDeliveryOTP && o.Status == models.OrderStatusOutForDelivery && o.DeliveryOTPCiphertext != nil && *o.DeliveryOTPCiphertext != "" {
		otpPtr = o.DeliveryOTPCiphertext
	}

	outEmail := ""
	if includeCustomerEmail {
		outEmail = email
	}

	return OrderResponse{
		OrderID:            o.OrderID,
		CustomerID:         o.CustomerID,
		CustomerName:       custName,
		CustomerEmail:      outEmail,
		CustomerPhone:      o.CustomerPhone,
		Status:             string(o.Status),
		OrderType:          o.OrderType,
		PaymentMethod:      pm,
		PaymentStatus:      ps,
		SubtotalPaise:      subtotal,
		TaxPaise:           0,
		DeliveryFeePaise:   o.DeliveryFeePaise,
		TotalPaise:         subtotal + o.DeliveryFeePaise,
		Address:            o.Address,
		Latitude:           o.Latitude,
		Longitude:          o.Longitude,
		Notes:              o.Notes,
		AssignedDeliveryID: o.AssignedDeliveryID,
		ScheduledFor:       o.ScheduledFor,
		DeliveryStartedAt:  o.DeliveryStartedAt,
		DeliveredAt:        o.DeliveredAt,
		DeliveryName:       dName,
		DeliveryPhone:      dPhone,
		DeliveryOTP:        otpPtr,
		CreatedAt:          o.CreatedAt,
		Items:              itemsOut,
	}
}

func formatOrderResponse(o *models.Order, email string) OrderResponse {
	return formatOrderResponseOpts(o, email, true, true)
}
