package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/kebabzilla/go-backend/cache"
	"github.com/kebabzilla/go-backend/clustering"
	"github.com/kebabzilla/go-backend/config"
	"github.com/kebabzilla/go-backend/middleware"
	"github.com/kebabzilla/go-backend/models"
	"github.com/kebabzilla/go-backend/storage"
	"gorm.io/gorm"
)

type PublicHandler struct {
	cfg   *config.Config
	db    *gorm.DB
	cache *cache.HybridCache
}

func NewPublicHandler(cfg *config.Config, db *gorm.DB, c *cache.HybridCache) *PublicHandler {
	return &PublicHandler{cfg: cfg, db: db, cache: c}
}

type PublicRestaurantResponse struct {
	RestaurantName                  string   `json:"restaurant_name"`
	Tagline                         string   `json:"tagline"`
	Phone                           string   `json:"phone"`
	Email                           string   `json:"email"`
	Address                         string   `json:"address"`
	Latitude                        *float64 `json:"latitude"`
	Longitude                       *float64 `json:"longitude"`
	IsRestaurantOpen                bool     `json:"is_restaurant_open"`
	IsDeliveryOpen                  bool     `json:"is_delivery_open"`
	TodaySchedule                   map[string]any `json:"today_schedule"`
	MinimumOrderPaise               int            `json:"minimum_order_paise"`
	DeliveryRadiusKm                float64        `json:"delivery_radius_km"`
	FreeDeliveryRadiusKm            float64        `json:"free_delivery_radius_km"`
	FreeDeliveryThresholdPaise      int            `json:"free_delivery_threshold_paise"`
	DeliveryFeePerKmPaise           int            `json:"delivery_fee_per_km_paise"`
	ChargeFromZeroBeyondFreeRadius bool           `json:"charge_from_zero_beyond_free_radius"`
	HaversineRoutingFactor          float64        `json:"haversine_routing_factor"`
	OrderCutoffMinutesBeforeClosing int            `json:"order_cutoff_minutes_before_closing"`
	DeliveryStatusHeading           string         `json:"delivery_status_heading"`
	DeliveryStatusMessage           string         `json:"delivery_status_message"`
	ClosingInMinutes                *int           `json:"closing_in_minutes"`
	CutoffInMinutes                 *int           `json:"cutoff_in_minutes"`
	ClosingTime                     *string        `json:"closing_time"`
	CanScheduleOrder                bool           `json:"can_schedule_order"`
	GoogleClientID                  string         `json:"google_client_id"`
}

type DeliveryEstimateResponse struct {
	DistanceKm                 float64 `json:"distance_km"`
	Method                     string  `json:"method"`
	DeliveryFeePaise           int     `json:"delivery_fee_paise"`
	DeliveryFeeInr             float64 `json:"delivery_fee_inr"`
	RawDeliveryFeeInr          float64 `json:"raw_delivery_fee_inr"`
	RawDeliveryFeePaise        int     `json:"raw_delivery_fee_paise"`
	RoundOffInr                float64 `json:"round_off_inr"`
	RoundOffPaise              int     `json:"round_off_paise"`
	WithinRadius               bool    `json:"within_radius"`
	MaxRadiusKm                float64 `json:"max_radius_km"`
	FreeRadiusKm               float64 `json:"free_radius_km"`
	FreeDeliveryThresholdPaise int     `json:"free_delivery_threshold_paise"`
	FeePerKmPaise              int     `json:"fee_per_km_paise"`
	IsFreeByThreshold          bool    `json:"is_free_by_threshold"`
}

type MenuItemResponse struct {
	ID                   uint             `json:"id"`
	Name                 string           `json:"name"`
	Description          string           `json:"description"`
	CategoryID           *uint            `json:"category_id"`
	Category             string           `json:"category"`
	Categories           []string         `json:"categories"`
	CategoryIDs          []uint           `json:"category_ids"`
	PricePaise           int              `json:"price_paise"`
	BasePricePaise       int              `json:"base_price_paise"`
	DiscountPercent      int              `json:"discount_percent"`
	DiscountedPricePaise *int             `json:"discounted_price_paise"`
	ImageURL             *string          `json:"image_url"`
	ImageURLs            []string         `json:"image_urls"`
	IsVegetarian         bool             `json:"is_vegetarian"`
	IsAvailable          bool             `json:"is_available"`
	IsPaused             bool             `json:"is_paused"`
	IsFeatured           bool             `json:"is_featured"`
	IsCustomizable       bool             `json:"is_customizable"`
	Variations           []map[string]any `json:"variations"`
	Sections             []map[string]any `json:"sections"`
	DiscountCampaignName *string          `json:"discount_campaign_name"`
	PopularityCount      int              `json:"popularity_count"`
}

func (h *PublicHandler) GetRestaurant(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	cacheKey := "restaurant:public:v2"

	if val, ok := h.cache.Get(ctx, cacheKey); ok {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Cache", "HIT")
		_, _ = w.Write(val)
		return
	}

	var setting models.RestaurantSettings
	if err := h.db.First(&setting).Error; err != nil {
		setting = models.RestaurantSettings{
			RestaurantName:                  "KebabZilla",
			Tagline:                         "Fire up your cravings.",
			Email:                           "support@kebabzilla.in",
			Address:                         "Amtala, DH Road, South 24 Parganas, West Bengal 743398",
			MinimumOrderPaise:               19900,
			DeliveryRadiusKm:                10.0,
			FreeDeliveryRadiusKm:            3.0,
			FreeDeliveryThresholdPaise:      49900,
			DeliveryFeePerKmPaise:           1500,
			OrderCutoffMinutesBeforeClosing: 30,
			AcceptingOrders:                 true,
			IsDeliveryOpen:                  true,
		}
	}

	routingFactor := setting.HaversineRoutingFactor
	if routingFactor <= 1.0 {
		routingFactor = 1.3627
	}

	todaySchedule := formatTodaySchedule(setting.WeeklySchedule)
	heading := "Menu"
	msg := "Choose what you’d like to order."
	isRestOpen := setting.AcceptingOrders
	isDelivOpen := setting.IsDeliveryOpen

	loc := time.FixedZone("IST", 5*3600+1800)
	now := time.Now().In(loc)

	closingTimeStr := "11:00 PM"
	var closingInMinutes *int
	var cutoffInMinutes *int

	if todaySchedule != nil {
		if c, ok := todaySchedule["closes"].(string); ok && c != "" {
			closingTimeStr = c
			parts := strings.Split(closingTimeStr, ":")
			if len(parts) >= 2 {
				if h, err := strconv.Atoi(parts[0]); err == nil {
					if m, err := strconv.Atoi(parts[1]); err == nil {
						closeToday := time.Date(now.Year(), now.Month(), now.Day(), h, m, 0, 0, loc)
						if closeToday.After(now) {
							diff := int(closeToday.Sub(now).Minutes())
							closingInMinutes = &diff

							cutoffMin := setting.OrderCutoffMinutesBeforeClosing
							if cutoffMin <= 0 {
								cutoffMin = 30
							}
							remCutoff := diff - cutoffMin
							if remCutoff < 0 {
								remCutoff = 0
							}
							cutoffInMinutes = &remCutoff

							if isRestOpen && isDelivOpen {
								if remCutoff <= 0 {
									isDelivOpen = false
									heading = "Delivery is currently unavailable"
									msg = "Our shop is open! We are currently only accepting walk-in orders at our counter."
									if diff <= 59 {
										msg = fmt.Sprintf("%s The restaurant is closing in %d minutes.", msg, diff)
									}
								} else if remCutoff <= 30 {
									heading = "Hurry up closing soon"
									msg = fmt.Sprintf("The restaurant is closing in %d minutes.", remCutoff)
								}
							}
						}
					}
				}
			}
		}
	}

	if !isRestOpen {
		heading = "Sorry, we are closed"
		msg = "Our shop is currently closed. Please check back during operating hours."
		isDelivOpen = false
	} else if !isDelivOpen && heading == "Menu" {
		heading = "Delivery is currently unavailable"
		msg = "Our shop is open! We are currently only accepting walk-in orders at our counter."
	}

	delivRadius := setting.DeliveryRadiusKm
	if delivRadius <= 0 {
		delivRadius = 6.0
	}
	freeRadius := setting.FreeDeliveryRadiusKm
	if freeRadius <= 0 {
		freeRadius = 0.8
	}
	feePerKm := setting.DeliveryFeePerKmPaise
	if feePerKm <= 0 {
		feePerKm = 1000
	}

	resp := PublicRestaurantResponse{
		RestaurantName:                  setting.RestaurantName,
		Tagline:                         setting.Tagline,
		Phone:                           setting.Phone,
		Email:                           setting.Email,
		Address:                         setting.Address,
		Latitude:                        setting.Latitude,
		Longitude:                       setting.Longitude,
		IsRestaurantOpen:                isRestOpen,
		IsDeliveryOpen:                  isDelivOpen,
		TodaySchedule:                   todaySchedule,
		MinimumOrderPaise:               setting.MinimumOrderPaise,
		DeliveryRadiusKm:                delivRadius,
		FreeDeliveryRadiusKm:            freeRadius,
		FreeDeliveryThresholdPaise:      setting.FreeDeliveryThresholdPaise,
		DeliveryFeePerKmPaise:           feePerKm,
		ChargeFromZeroBeyondFreeRadius: setting.ChargeFromZeroBeyondFreeRadius,
		HaversineRoutingFactor:          routingFactor,
		OrderCutoffMinutesBeforeClosing: setting.OrderCutoffMinutesBeforeClosing,
		DeliveryStatusHeading:           heading,
		DeliveryStatusMessage:           msg,
		ClosingInMinutes:                closingInMinutes,
		CutoffInMinutes:                 cutoffInMinutes,
		ClosingTime:                     &closingTimeStr,
		CanScheduleOrder:                isRestOpen && isDelivOpen,
		GoogleClientID:                  h.cfg.GoogleClientID,
	}

	bytes, _ := json.Marshal(resp)
	h.cache.Set(ctx, cacheKey, bytes, 60*time.Second, true)

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Cache", "MISS")
	_, _ = w.Write(bytes)
}

func formatTodaySchedule(rawSchedule string) map[string]any {
	todayName := strings.ToLower(time.Now().Format("Monday"))
	if rawSchedule == "" || rawSchedule == "{}" {
		return map[string]any{
			"day":    todayName,
			"open":   true,
			"opens":  "10:00",
			"closes": "22:00",
		}
	}
	var sched map[string]any
	if err := json.Unmarshal([]byte(rawSchedule), &sched); err != nil {
		return nil
	}
	if cs, ok := sched["custom_schedules"].([]any); ok {
		for _, item := range cs {
			if sm, ok := item.(map[string]any); ok {
				if days, ok := sm["days"].([]any); ok {
					for _, d := range days {
						if strings.EqualFold(fmt.Sprintf("%v", d), todayName) {
							opens := "10:00"
							closes := "22:00"
							if v, ok := sm["start_time"].(string); ok && v != "" {
								opens = v
							}
							if v, ok := sm["end_time"].(string); ok && v != "" {
								closes = v
							}
							return map[string]any{
								"day":    todayName,
								"open":   true,
								"opens":  opens,
								"closes": closes,
							}
						}
					}
				}
			}
		}
		return map[string]any{
			"day":    todayName,
			"open":   false,
			"opens":  "10:00",
			"closes": "22:00",
		}
	}
	if dm, ok := sched[todayName].(map[string]any); ok {
		isOpen, _ := dm["open"].(bool)
		opens := "10:00"
		closes := "22:00"
		if v, ok := dm["opens"].(string); ok && v != "" {
			opens = v
		}
		if v, ok := dm["closes"].(string); ok && v != "" {
			closes = v
		}
		return map[string]any{
			"day":    todayName,
			"open":   isOpen,
			"opens":  opens,
			"closes": closes,
		}
	}
	return map[string]any{
		"day":    todayName,
		"open":   true,
		"opens":  "10:00",
		"closes": "22:00",
	}
}

func (h *PublicHandler) EstimateDelivery(w http.ResponseWriter, r *http.Request) {
	latStr := r.URL.Query().Get("latitude")
	lonStr := r.URL.Query().Get("longitude")
	subtotalStr := r.URL.Query().Get("subtotal")

	lat, err1 := strconv.ParseFloat(latStr, 64)
	lon, err2 := strconv.ParseFloat(lonStr, 64)
	if err1 != nil || err2 != nil {
		http.Error(w, `{"detail":"Invalid latitude or longitude"}`, http.StatusBadRequest)
		return
	}

	var subtotal *int
	if subtotalStr != "" {
		if st, err := strconv.Atoi(subtotalStr); err == nil {
			subtotal = &st
		}
	}

	var config models.RestaurantSettings
	if err := h.db.First(&config).Error; err != nil {
		http.Error(w, `{"detail":"Restaurant settings not found"}`, http.StatusNotFound)
		return
	}

	if config.Latitude == nil || config.Longitude == nil {
		http.Error(w, `{"detail":"The restaurant delivery location is not configured"}`, http.StatusServiceUnavailable)
		return
	}

	routingFactor := config.HaversineRoutingFactor
	if routingFactor <= 1.0 {
		routingFactor = 1.3627
	}

	distKm := clustering.RoadDistanceKm(*config.Latitude, *config.Longitude, lat, lon, routingFactor)
	distKm = math.Round(distKm*100) / 100

	withinRadius := distKm <= config.DeliveryRadiusKm
	freeThreshold := config.FreeDeliveryThresholdPaise
	isThresholdFree := freeThreshold > 0 && subtotal != nil && *subtotal >= freeThreshold

	feePaise := 0
	rawFeeInr := 0.0
	rawFeePaise := 0
	roundOffInr := 0.0
	roundOffPaise := 0

	if withinRadius && !isThresholdFree && distKm > config.FreeDeliveryRadiusKm {
		billableKm := distKm - config.FreeDeliveryRadiusKm
		if config.ChargeFromZeroBeyondFreeRadius {
			billableKm = distKm
		}
		rawFeeInr = math.Round(billableKm*(float64(config.DeliveryFeePerKmPaise)/100.0)*100) / 100
		roundedFeeInr := math.Ceil(rawFeeInr)
		roundOffInr = math.Round((roundedFeeInr-rawFeeInr)*100) / 100
		rawFeePaise = int(math.Round(rawFeeInr * 100))
		feePaise = int(roundedFeeInr * 100)
		roundOffPaise = int(math.Round(roundOffInr * 100))
	}

	resp := DeliveryEstimateResponse{
		DistanceKm:                 distKm,
		Method:                     "HAVERSINE",
		DeliveryFeePaise:           feePaise,
		DeliveryFeeInr:             float64(feePaise) / 100.0,
		RawDeliveryFeeInr:          rawFeeInr,
		RawDeliveryFeePaise:        rawFeePaise,
		RoundOffInr:                roundOffInr,
		RoundOffPaise:              roundOffPaise,
		WithinRadius:               withinRadius,
		MaxRadiusKm:                config.DeliveryRadiusKm,
		FreeRadiusKm:               config.FreeDeliveryRadiusKm,
		FreeDeliveryThresholdPaise: freeThreshold,
		FeePerKmPaise:              config.DeliveryFeePerKmPaise,
		IsFreeByThreshold:          isThresholdFree,
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

func (h *PublicHandler) GetCategories(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	cacheKey := "menu_categories_v2"

	if val, ok := h.cache.Get(ctx, cacheKey); ok {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Cache", "HIT")
		_, _ = w.Write(val)
		return
	}

	var categories []models.Category
	h.db.Order("name asc").Find(&categories)
	if categories == nil {
		categories = []models.Category{}
	}

	bytes, _ := json.Marshal(categories)
	h.cache.Set(ctx, cacheKey, bytes, 3600*time.Second, true)

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Cache", "MISS")
	_, _ = w.Write(bytes)
}

func (h *PublicHandler) GetMenuItems(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	cacheKey := "menu:public_list_v2"

	if val, ok := h.cache.Get(ctx, cacheKey); ok {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Cache", "HIT")
		_, _ = w.Write(val)
		return
	}

	var items []models.MenuItem
	h.db.Where("is_available = ? AND is_customizable = ?", true, false).Order("name asc").Find(&items)

	// Fetch category map
	var categories []models.Category
	h.db.Find(&categories)
	catNameMap := make(map[uint]string)
	for _, c := range categories {
		catNameMap[c.ID] = c.Name
	}

	// Fetch menu_item_categories relations
	var itemCats []models.MenuItemCategory
	h.db.Find(&itemCats)
	itemCatMap := make(map[uint][]uint)
	for _, ic := range itemCats {
		itemCatMap[ic.MenuItemID] = append(itemCatMap[ic.MenuItemID], ic.CategoryID)
	}

	// Calculate popularity counts
	type PopularityRow struct {
		MenuItemID uint
		TotalQty   int
	}
	var popRows []PopularityRow
	h.db.Table("order_items").
		Select("order_items.menu_item_id, sum(order_items.quantity) as total_qty").
		Joins("JOIN orders ON orders.order_id = order_items.order_id").
		Where("orders.status NOT IN ('CANCELLED', 'REJECTED') AND order_items.menu_item_id IS NOT NULL").
		Group("order_items.menu_item_id").
		Scan(&popRows)
	popMap := make(map[uint]int)
	for _, pr := range popRows {
		popMap[pr.MenuItemID] = pr.TotalQty
	}

	// Active discounts
	now := time.Now().UTC()
	var discounts []models.MenuDiscount
	h.db.Preload("Items").Where("starts_at <= ? AND ends_at > ?", now, now).Find(&discounts)
	activeDiscounts := make(map[uint]models.MenuDiscount)
	for _, d := range discounts {
		for _, di := range d.Items {
			activeDiscounts[di.MenuItemID] = d
		}
	}

	results := make([]MenuItemResponse, 0, len(items))
	for _, item := range items {
		catIDs := itemCatMap[item.ID]
		if catIDs == nil {
			catIDs = []uint{}
		}
		catNames := make([]string, 0, len(catIDs))
		for _, cid := range catIDs {
			if n, ok := catNameMap[cid]; ok {
				catNames = append(catNames, n)
			}
		}

		var primaryCatID *uint
		primaryCatName := ""
		if len(catIDs) > 0 {
			primaryCatID = &catIDs[0]
			primaryCatName = catNameMap[catIDs[0]]
		}

		imageURLs := []string{}
		if item.ImageURLs != "" && item.ImageURLs != "[]" {
			_ = json.Unmarshal([]byte(item.ImageURLs), &imageURLs)
		}

		var primaryImage *string
		if len(imageURLs) > 0 {
			primaryImage = &imageURLs[0]
		}

		variations := []map[string]any{}
		if item.Variations != "" && item.Variations != "[]" {
			_ = json.Unmarshal([]byte(item.Variations), &variations)
		}

		isPaused := item.PausedUntil != nil && item.PausedUntil.After(now)

		discPercent := 0
		var discPrice *int
		var campName *string
		if d, ok := activeDiscounts[item.ID]; ok {
			discPercent = d.DiscountPercent
			p := (item.PricePaise*(100-d.DiscountPercent) + 50) / 100
			if p < 1 {
				p = 1
			}
			discPrice = &p
			campName = d.CampaignName
		}

		results = append(results, MenuItemResponse{
			ID:                   item.ID,
			Name:                 item.Name,
			Description:          item.Description,
			CategoryID:           primaryCatID,
			Category:             primaryCatName,
			Categories:           catNames,
			CategoryIDs:          catIDs,
			PricePaise:           item.PricePaise,
			BasePricePaise:       item.PricePaise,
			DiscountPercent:      discPercent,
			DiscountedPricePaise: discPrice,
			ImageURL:             primaryImage,
			ImageURLs:            imageURLs,
			IsVegetarian:         item.IsVegetarian,
			IsAvailable:          item.IsAvailable,
			IsPaused:             isPaused,
			IsFeatured:           item.IsFeatured,
			IsCustomizable:       item.IsCustomizable,
			Variations:           variations,
			Sections:             []map[string]any{},
			DiscountCampaignName: campName,
			PopularityCount:      popMap[item.ID],
		})
	}

	bytes, _ := json.Marshal(results)
	h.cache.Set(ctx, cacheKey, bytes, 60*time.Second, true)

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Cache", "MISS")
	_, _ = w.Write(bytes)
}

func (h *PublicHandler) GetCustomMenu(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	cacheKey := "custom_menu:public_list_v2"

	if val, ok := h.cache.Get(ctx, cacheKey); ok {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Cache", "HIT")
		_, _ = w.Write(val)
		return
	}

	var items []models.MenuItem
	h.db.Preload("Sections").Where("is_available = ? AND is_customizable = ?", true, true).Order("name asc").Find(&items)

	// Fetch category map
	var categories []models.Category
	h.db.Find(&categories)
	catNameMap := make(map[uint]string)
	for _, c := range categories {
		catNameMap[c.ID] = c.Name
	}

	// Fetch menu_item_categories relations
	var itemCats []models.MenuItemCategory
	h.db.Find(&itemCats)
	itemCatMap := make(map[uint][]uint)
	for _, ic := range itemCats {
		itemCatMap[ic.MenuItemID] = append(itemCatMap[ic.MenuItemID], ic.CategoryID)
	}

	now := time.Now().UTC()
	var discounts []models.MenuDiscount
	h.db.Preload("Items").Where("starts_at <= ? AND ends_at > ?", now, now).Find(&discounts)
	activeDiscounts := make(map[uint]models.MenuDiscount)
	for _, d := range discounts {
		for _, di := range d.Items {
			activeDiscounts[di.MenuItemID] = d
		}
	}

	results := make([]map[string]any, 0, len(items))
	for _, item := range items {
		catIDs := itemCatMap[item.ID]
		if catIDs == nil {
			catIDs = []uint{}
		}
		catNames := make([]string, 0, len(catIDs))
		for _, cid := range catIDs {
			if n, ok := catNameMap[cid]; ok {
				catNames = append(catNames, n)
			}
		}

		var primaryCatID *uint
		primaryCatName := ""
		if len(catIDs) > 0 {
			primaryCatID = &catIDs[0]
			primaryCatName = catNameMap[catIDs[0]]
		} else {
			primaryCatName = "Specialty Rolls"
			catNames = []string{"Specialty Rolls"}
		}

		imageURLs := []string{}
		if item.ImageURLs != "" {
			_ = json.Unmarshal([]byte(item.ImageURLs), &imageURLs)
		}
		var primaryImage *string
		if len(imageURLs) > 0 {
			primaryImage = &imageURLs[0]
		}

		secOuts := make([]map[string]any, 0, len(item.Sections))
		lowestPrice := item.PricePaise
		for _, sec := range item.Sections {
			opts := []map[string]any{}
			if sec.Options != "" && sec.Options != "[]" {
				_ = json.Unmarshal([]byte(sec.Options), &opts)
			}

			if sec.Required && len(opts) > 0 {
				minExtra := -1
				for _, op := range opts {
					extra := 0
					if ep, ok := op["extra_paise"].(float64); ok {
						extra = int(ep)
					} else if ep, ok := op["extra_paise"].(int); ok {
						extra = ep
					}
					if minExtra == -1 || extra < minExtra {
						minExtra = extra
					}
				}
				if minExtra > 0 {
					lowestPrice += minExtra
				}
			}

			secOuts = append(secOuts, map[string]any{
				"id":           sec.ID,
				"name":         sec.Name,
				"position":     sec.Position,
				"required":     sec.Required,
				"options":      opts,
				"section_type": sec.SectionType,
			})
		}

		discPercent := 0
		var discBasePrice *int
		var campName *string
		if d, ok := activeDiscounts[item.ID]; ok {
			discPercent = d.DiscountPercent
			p := (item.PricePaise*(100-d.DiscountPercent) + 50) / 100
			if p < 1 {
				p = 1
			}
			discBasePrice = &p
			campName = d.CampaignName
		}

		isPaused := item.PausedUntil != nil && item.PausedUntil.After(now)

		results = append(results, map[string]any{
			"id":                          item.ID,
			"name":                        item.Name,
			"description":                 item.Description,
			"category_id":                 primaryCatID,
			"category":                    primaryCatName,
			"categories":                  catNames,
			"category_ids":                catIDs,
			"base_price_paise":            item.PricePaise,
			"lowest_price_paise":          lowestPrice,
			"price_paise":                 lowestPrice,
			"discount_percent":            discPercent,
			"discounted_base_price_paise": discBasePrice,
			"discount_campaign_name":      campName,
			"image_url":                   primaryImage,
			"image_urls":                  imageURLs,
			"is_vegetarian":               item.IsVegetarian,
			"is_available":                item.IsAvailable,
			"is_paused":                   isPaused,
			"is_featured":                 item.IsFeatured,
			"sections":                    secOuts,
			"popularity_count":            0,
		})
	}

	bytes, _ := json.Marshal(results)
	h.cache.Set(ctx, cacheKey, bytes, 60*time.Second, true)

	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(bytes)
}

type CartItemOut struct {
	ID             uint    `json:"id"`
	MenuID         uint    `json:"menu_id"`
	MenuItemID     uint    `json:"menu_item_id"`
	VariationName  *string `json:"variation_name"`
	Quantity       int     `json:"quantity"`
	UnitPricePaise int     `json:"unit_price_paise"`
	Customizations []any   `json:"customizations"`
}

func (h *PublicHandler) buildCartItemOut(ci *models.CartItem, menuMap map[uint]*models.MenuItem) CartItemOut {
	customs := []any{}
	if ci.Customizations != "" && ci.Customizations != "[]" {
		_ = json.Unmarshal([]byte(ci.Customizations), &customs)
	}

	unitPrice := 0
	if mi, ok := menuMap[ci.MenuID]; ok {
		unitPrice = mi.PricePaise
		if ci.VariationName != nil && *ci.VariationName != "" && mi.Variations != "" && mi.Variations != "[]" {
			var vars []map[string]any
			if err := json.Unmarshal([]byte(mi.Variations), &vars); err == nil {
				for _, v := range vars {
					if n, ok := v["name"].(string); ok && strings.EqualFold(n, *ci.VariationName) {
						if p, ok := v["price_paise"].(float64); ok {
							unitPrice = int(p)
						}
						break
					}
				}
			}
		}
		for _, c := range customs {
			if cm, ok := c.(map[string]any); ok {
				if ex, ok := cm["extra_paise"].(float64); ok && ex > 0 {
					unitPrice += int(ex)
				}
			}
		}
	}

	return CartItemOut{
		ID:             ci.ID,
		MenuID:         ci.MenuID,
		MenuItemID:     ci.MenuID,
		VariationName:  ci.VariationName,
		Quantity:       ci.Quantity,
		UnitPricePaise: unitPrice,
		Customizations: customs,
	}
}

func (h *PublicHandler) getCartResponse(customerID uint) []CartItemOut {
	var items []models.CartItem
	h.db.Where("customer_id = ?", customerID).Order("id asc").Find(&items)
	if len(items) == 0 {
		return []CartItemOut{}
	}

	menuIDs := make([]uint, 0, len(items))
	for _, ci := range items {
		menuIDs = append(menuIDs, ci.MenuID)
	}
	var menuItems []models.MenuItem
	h.db.Where("id IN ?", menuIDs).Find(&menuItems)
	menuMap := make(map[uint]*models.MenuItem)
	for i := range menuItems {
		menuMap[menuItems[i].ID] = &menuItems[i]
	}

	out := make([]CartItemOut, 0, len(items))
	for i := range items {
		out = append(out, h.buildCartItemOut(&items[i], menuMap))
	}
	return out
}

func (h *PublicHandler) GetCart(w http.ResponseWriter, r *http.Request) {
	accountVal := r.Context().Value(middleware.AccountContextKey)
	if accountVal == nil {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[]`))
		return
	}
	account := accountVal.(*models.Account)
	out := h.getCartResponse(account.ID)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}

func (h *PublicHandler) SyncCart(w http.ResponseWriter, r *http.Request) {
	accountVal := r.Context().Value(middleware.AccountContextKey)
	if accountVal == nil {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[]`))
		return
	}
	account := accountVal.(*models.Account)

	var reqItems []struct {
		MenuID           *uint   `json:"menu_id"`
		MenuItemID       *uint   `json:"menu_item_id"`
		CustomMenuItemID *uint   `json:"custom_menu_item_id"`
		VariationName    *string `json:"variation_name"`
		Quantity         int     `json:"quantity"`
		Customizations   []any   `json:"customizations"`
	}
	if err := json.NewDecoder(r.Body).Decode(&reqItems); err != nil {
		http.Error(w, `{"detail":"Invalid cart sync format"}`, http.StatusBadRequest)
		return
	}

	h.db.Where("customer_id = ?", account.ID).Delete(&models.CartItem{})

	now := time.Now().UTC()
	for _, it := range reqItems {
		if it.Quantity <= 0 {
			continue
		}
		mID := it.MenuID
		if mID == nil {
			mID = it.MenuItemID
		}
		if mID == nil {
			mID = it.CustomMenuItemID
		}
		if mID == nil {
			continue
		}

		custJSON, _ := json.Marshal(it.Customizations)
		if len(it.Customizations) == 0 {
			custJSON = []byte("[]")
		}

		cItem := models.CartItem{
			CustomerID:     account.ID,
			MenuID:         *mID,
			VariationName:  it.VariationName,
			Quantity:       it.Quantity,
			Customizations: string(custJSON),
			UpdatedAt:      now,
		}
		_ = h.db.Create(&cItem)
	}

	out := h.getCartResponse(account.ID)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}

func (h *PublicHandler) AddOrUpdateCartItem(w http.ResponseWriter, r *http.Request) {
	accountVal := r.Context().Value(middleware.AccountContextKey)
	if accountVal == nil {
		http.Error(w, `{"detail":"Unauthorized"}`, http.StatusUnauthorized)
		return
	}
	account := accountVal.(*models.Account)

	var req struct {
		MenuID           *uint   `json:"menu_id"`
		MenuItemID       *uint   `json:"menu_item_id"`
		CustomMenuItemID *uint   `json:"custom_menu_item_id"`
		VariationName    *string `json:"variation_name"`
		Quantity         int     `json:"quantity"`
		Customizations   []any   `json:"customizations"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"detail":"Invalid item payload"}`, http.StatusBadRequest)
		return
	}

	mID := req.MenuID
	if mID == nil {
		mID = req.MenuItemID
	}
	if mID == nil {
		mID = req.CustomMenuItemID
	}
	if mID == nil {
		http.Error(w, `{"detail":"Must specify a menu item"}`, http.StatusBadRequest)
		return
	}

	var existingItems []models.CartItem
	h.db.Where("customer_id = ? AND menu_id = ?", account.ID, *mID).Find(&existingItems)

	custJSON, _ := json.Marshal(req.Customizations)
	if len(req.Customizations) == 0 {
		custJSON = []byte("[]")
	}

	var matched *models.CartItem
	for i := range existingItems {
		ci := &existingItems[i]
		sameVar := (ci.VariationName == nil && req.VariationName == nil) ||
			(ci.VariationName != nil && req.VariationName != nil && *ci.VariationName == *req.VariationName)
		if sameVar {
			matched = ci
			break
		}
	}

	if req.Quantity <= 0 {
		if matched != nil {
			h.db.Delete(matched)
		}
	} else if matched != nil {
		matched.Quantity = req.Quantity
		matched.Customizations = string(custJSON)
		matched.UpdatedAt = time.Now().UTC()
		h.db.Save(matched)
	} else {
		newItem := models.CartItem{
			CustomerID:     account.ID,
			MenuID:         *mID,
			VariationName:  req.VariationName,
			Quantity:       req.Quantity,
			Customizations: string(custJSON),
			UpdatedAt:      time.Now().UTC(),
		}
		h.db.Create(&newItem)
	}

	out := h.getCartResponse(account.ID)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}

func (h *PublicHandler) UpdateStandardCartItem(w http.ResponseWriter, r *http.Request) {
	accountVal := r.Context().Value(middleware.AccountContextKey)
	if accountVal == nil {
		http.Error(w, `{"detail":"Unauthorized"}`, http.StatusUnauthorized)
		return
	}
	account := accountVal.(*models.Account)
	menuIDStr := chi.URLParam(r, "menu_item_id")
	menuID, err := strconv.ParseUint(menuIDStr, 10, 64)
	if err != nil {
		http.Error(w, `{"detail":"Invalid menu item ID"}`, http.StatusBadRequest)
		return
	}

	var req struct {
		Quantity int `json:"quantity"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"detail":"Invalid quantity"}`, http.StatusBadRequest)
		return
	}

	var existing models.CartItem
	found := h.db.Where("customer_id = ? AND menu_id = ? AND variation_name IS NULL", account.ID, uint(menuID)).First(&existing).Error == nil

	if req.Quantity <= 0 {
		if found {
			h.db.Delete(&existing)
		}
	} else if found {
		existing.Quantity = req.Quantity
		existing.UpdatedAt = time.Now().UTC()
		h.db.Save(&existing)
	} else {
		newItem := models.CartItem{
			CustomerID:     account.ID,
			MenuID:         uint(menuID),
			Quantity:       req.Quantity,
			Customizations: "[]",
			UpdatedAt:      time.Now().UTC(),
		}
		h.db.Create(&newItem)
	}

	out := h.getCartResponse(account.ID)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}

func (h *PublicHandler) DeleteCartItem(w http.ResponseWriter, r *http.Request) {
	accountVal := r.Context().Value(middleware.AccountContextKey)
	if accountVal == nil {
		http.Error(w, `{"detail":"Unauthorized"}`, http.StatusUnauthorized)
		return
	}
	account := accountVal.(*models.Account)
	itemIDStr := chi.URLParam(r, "item_id")
	if targetID, err := strconv.ParseUint(itemIDStr, 10, 64); err == nil {
		var ci models.CartItem
		if err := h.db.Where("customer_id = ? AND id = ?", account.ID, uint(targetID)).First(&ci).Error; err == nil {
			h.db.Delete(&ci)
		} else {
			h.db.Where("customer_id = ? AND menu_id = ?", account.ID, uint(targetID)).Delete(&models.CartItem{})
		}
	}

	out := h.getCartResponse(account.ID)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}

func (h *PublicHandler) ClearCart(w http.ResponseWriter, r *http.Request) {
	accountVal := r.Context().Value(middleware.AccountContextKey)
	if accountVal == nil {
		http.Error(w, `{"detail":"Unauthorized"}`, http.StatusUnauthorized)
		return
	}
	account := accountVal.(*models.Account)
	h.db.Where("customer_id = ?", account.ID).Delete(&models.CartItem{})

	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`[]`))
}

// -------------------------------------------------------------
// MENU MANAGEMENT (ADMIN)
// -------------------------------------------------------------

func (h *PublicHandler) GetMenuManage(w http.ResponseWriter, r *http.Request) {
	var items []models.MenuItem
	h.db.Where("is_customizable = ?", false).Order("name asc").Find(&items)

	var categories []models.Category
	h.db.Find(&categories)
	catNameMap := make(map[uint]string)
	for _, c := range categories {
		catNameMap[c.ID] = c.Name
	}

	var itemCats []models.MenuItemCategory
	h.db.Find(&itemCats)
	itemCatMap := make(map[uint][]uint)
	for _, ic := range itemCats {
		itemCatMap[ic.MenuItemID] = append(itemCatMap[ic.MenuItemID], ic.CategoryID)
	}

	results := make([]MenuItemResponse, 0, len(items))
	for _, item := range items {
		catIDs := itemCatMap[item.ID]
		catNames := make([]string, 0, len(catIDs))
		for _, cid := range catIDs {
			if n, ok := catNameMap[cid]; ok {
				catNames = append(catNames, n)
			}
		}

		var primaryCatID *uint
		primaryCatName := ""
		if len(catIDs) > 0 {
			primaryCatID = &catIDs[0]
			primaryCatName = catNameMap[catIDs[0]]
		}

		imageURLs := []string{}
		if item.ImageURLs != "" && item.ImageURLs != "[]" {
			_ = json.Unmarshal([]byte(item.ImageURLs), &imageURLs)
		}

		var primaryImage *string
		if len(imageURLs) > 0 {
			primaryImage = &imageURLs[0]
		}

		variations := []map[string]any{}
		if item.Variations != "" && item.Variations != "[]" {
			_ = json.Unmarshal([]byte(item.Variations), &variations)
		}

		isPaused := item.PausedUntil != nil && item.PausedUntil.After(time.Now().UTC())

		results = append(results, MenuItemResponse{
			ID:                   item.ID,
			Name:                 item.Name,
			Description:          item.Description,
			CategoryID:           primaryCatID,
			Category:             primaryCatName,
			Categories:           catNames,
			CategoryIDs:          catIDs,
			PricePaise:           item.PricePaise,
			BasePricePaise:       item.PricePaise,
			DiscountPercent:      0,
			DiscountedPricePaise: nil,
			ImageURL:             primaryImage,
			ImageURLs:            imageURLs,
			IsVegetarian:         item.IsVegetarian,
			IsAvailable:          item.IsAvailable,
			IsPaused:             isPaused,
			IsFeatured:           item.IsFeatured,
			IsCustomizable:       item.IsCustomizable,
			Variations:           variations,
			Sections:             []map[string]any{},
			PopularityCount:      0,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(results)
}

func (h *PublicHandler) CreateMenuItem(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name         string           `json:"name"`
		Description  string           `json:"description"`
		PricePaise   int              `json:"price_paise"`
		CategoryIDs  []uint           `json:"category_ids"`
		ImageURLs    []string         `json:"image_urls"`
		IsVegetarian bool             `json:"is_vegetarian"`
		IsAvailable  bool             `json:"is_available"`
		IsFeatured   bool             `json:"is_featured"`
		Variations   []map[string]any `json:"variations"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"detail":"Invalid menu item payload"}`, http.StatusBadRequest)
		return
	}

	imgJSON, _ := json.Marshal(req.ImageURLs)
	varJSON, _ := json.Marshal(req.Variations)

	item := models.MenuItem{
		Name:           req.Name,
		Description:    req.Description,
		PricePaise:     req.PricePaise,
		ImageURLs:      string(imgJSON),
		IsVegetarian:   req.IsVegetarian,
		IsAvailable:    req.IsAvailable,
		IsFeatured:     req.IsFeatured,
		IsCustomizable: false,
		Variations:     string(varJSON),
		CreatedAt:      time.Now().UTC(),
	}

	if err := h.db.Create(&item).Error; err != nil {
		http.Error(w, `{"detail":"Could not create menu item"}`, http.StatusInternalServerError)
		return
	}

	for _, cid := range req.CategoryIDs {
		_ = h.db.Create(&models.MenuItemCategory{
			MenuItemID: item.ID,
			CategoryID: cid,
		})
	}

	h.cache.Delete(r.Context(), "menu:public_list")

	w.WriteHeader(http.StatusCreated)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(item)
}

func (h *PublicHandler) UpdateMenuItem(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "item_id")
	var item models.MenuItem
	if err := h.db.First(&item, idStr).Error; err != nil {
		http.Error(w, `{"detail":"Item not found"}`, http.StatusNotFound)
		return
	}

	var req struct {
		Name         *string          `json:"name"`
		Description  *string          `json:"description"`
		PricePaise   *int             `json:"price_paise"`
		CategoryIDs  []uint           `json:"category_ids"`
		ImageURLs    []string         `json:"image_urls"`
		IsVegetarian *bool            `json:"is_vegetarian"`
		IsAvailable  *bool            `json:"is_available"`
		IsFeatured   *bool            `json:"is_featured"`
		Variations   []map[string]any `json:"variations"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"detail":"Invalid update payload"}`, http.StatusBadRequest)
		return
	}

	if req.Name != nil {
		item.Name = *req.Name
	}
	if req.Description != nil {
		item.Description = *req.Description
	}
	if req.PricePaise != nil {
		item.PricePaise = *req.PricePaise
	}
	if req.IsVegetarian != nil {
		item.IsVegetarian = *req.IsVegetarian
	}
	if req.IsAvailable != nil {
		item.IsAvailable = *req.IsAvailable
		if *req.IsAvailable {
			item.PausedUntil = nil
			item.PausedByID = nil
		}
	}
	if req.IsFeatured != nil {
		item.IsFeatured = *req.IsFeatured
	}
	if req.ImageURLs != nil {
		imgJSON, _ := json.Marshal(req.ImageURLs)
		item.ImageURLs = string(imgJSON)
	}
	if req.Variations != nil {
		varJSON, _ := json.Marshal(req.Variations)
		item.Variations = string(varJSON)
	}

	h.db.Save(&item)

	if req.CategoryIDs != nil {
		_ = h.db.Where("menu_item_id = ?", item.ID).Delete(&models.MenuItemCategory{})
		for _, cid := range req.CategoryIDs {
			_ = h.db.Create(&models.MenuItemCategory{
				MenuItemID: item.ID,
				CategoryID: cid,
			})
		}
	}

	h.cache.Delete(r.Context(), "menu:public_list")

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(item)
}

func (h *PublicHandler) DeleteMenuItem(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "item_id")
	h.db.Model(&models.MenuItem{}).Where("id = ?", idStr).Update("is_available", false)
	h.cache.Delete(r.Context(), "menu:public_list")
	w.WriteHeader(http.StatusNoContent)
}

func (h *PublicHandler) CreateCategory(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Name) == "" {
		http.Error(w, `{"detail":"Category name required"}`, http.StatusBadRequest)
		return
	}

	cat := models.Category{
		Name: strings.TrimSpace(req.Name),
	}
	if err := h.db.Create(&cat).Error; err != nil {
		http.Error(w, `{"detail":"Could not create category"}`, http.StatusInternalServerError)
		return
	}

	h.cache.Delete(r.Context(), "menu_categories")
	w.WriteHeader(http.StatusCreated)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(cat)
}

func (h *PublicHandler) DeleteCategory(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "category_id")
	_ = h.db.Where("category_id = ?", idStr).Delete(&models.MenuItemCategory{})
	_ = h.db.Delete(&models.Category{}, idStr)
	h.cache.Delete(r.Context(), "menu_categories")
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"deleted": true, "id": idStr})
}

// -------------------------------------------------------------
// CUSTOM MENU MANAGEMENT
// -------------------------------------------------------------

type CustomSectionOptionInput struct {
	Name       string `json:"name"`
	ExtraPaise int    `json:"extra_paise"`
}

type CustomSectionInput struct {
	Name     string                     `json:"name"`
	Required bool                       `json:"required"`
	Options  []CustomSectionOptionInput `json:"options"`
}

func (h *PublicHandler) GetCustomMenuManage(w http.ResponseWriter, r *http.Request) {
	var items []models.MenuItem
	h.db.Preload("Sections").Where("is_customizable = ?", true).Order("name asc").Find(&items)

	results := make([]map[string]any, 0, len(items))
	for _, item := range items {
		imageURLs := []string{}
		if item.ImageURLs != "" {
			_ = json.Unmarshal([]byte(item.ImageURLs), &imageURLs)
		}
		var primaryImage *string
		if len(imageURLs) > 0 {
			primaryImage = &imageURLs[0]
		}

		secOuts := make([]map[string]any, 0, len(item.Sections))
		for _, s := range item.Sections {
			opts := []map[string]any{}
			if s.Options != "" && s.Options != "[]" {
				_ = json.Unmarshal([]byte(s.Options), &opts)
			}
			secOuts = append(secOuts, map[string]any{
				"id":           s.ID,
				"name":         s.Name,
				"section_type": s.SectionType,
				"required":     s.Required,
				"position":     s.Position,
				"options":      opts,
			})
		}

		results = append(results, map[string]any{
			"id":               item.ID,
			"name":             item.Name,
			"description":      item.Description,
			"base_price_paise": item.PricePaise,
			"image_url":        primaryImage,
			"image_urls":       imageURLs,
			"is_vegetarian":    item.IsVegetarian,
			"is_available":     item.IsAvailable,
			"sections":         secOuts,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(results)
}

func (h *PublicHandler) CreateCustomMenuItem(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name           string               `json:"name"`
		Description    string               `json:"description"`
		BasePricePaise int                  `json:"base_price_paise"`
		ImageURLs      []string             `json:"image_urls"`
		IsVegetarian   bool                 `json:"is_vegetarian"`
		IsAvailable    bool                 `json:"is_available"`
		Sections       []CustomSectionInput `json:"sections"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"detail":"Invalid custom menu payload"}`, http.StatusBadRequest)
		return
	}

	imgJSON, _ := json.Marshal(req.ImageURLs)
	item := models.MenuItem{
		Name:           req.Name,
		Description:    req.Description,
		PricePaise:     req.BasePricePaise,
		ImageURLs:      string(imgJSON),
		IsVegetarian:   req.IsVegetarian,
		IsAvailable:    req.IsAvailable,
		IsCustomizable: true,
		CreatedAt:      time.Now().UTC(),
	}

	if err := h.db.Create(&item).Error; err != nil {
		http.Error(w, `{"detail":"Could not create custom item"}`, http.StatusInternalServerError)
		return
	}

	for idx, sec := range req.Sections {
		optsJSON, _ := json.Marshal(sec.Options)
		if len(sec.Options) == 0 {
			optsJSON = []byte("[]")
		}
		sRow := models.MenuSection{
			MenuItemID:  item.ID,
			SectionType: "CUSTOM",
			Name:        sec.Name,
			Position:    idx,
			Required:    sec.Required,
			Options:     string(optsJSON),
		}
		_ = h.db.Create(&sRow)
	}

	actorName := "Admin"
	var actorID *uint
	if accVal := r.Context().Value(middleware.AccountContextKey); accVal != nil {
		acc := accVal.(*models.Account)
		actorName = acc.Name
		actorID = &acc.ID
	}
	_ = h.db.Create(&models.AdminEvent{
		EventType: "custom_menu_item_created",
		Message:   fmt.Sprintf("Custom menu item '%s' created by %s", item.Name, actorName),
		ActorID:   actorID,
		CreatedAt: time.Now().UTC(),
		Details:   fmt.Sprintf(`{"item_id":%d,"name":"%s"}`, item.ID, item.Name),
	})

	h.cache.Delete(r.Context(), "custom_menu:public_list")
	h.db.Preload("Sections").First(&item, item.ID)
	w.WriteHeader(http.StatusCreated)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(item)
}

func (h *PublicHandler) UpdateCustomMenuItem(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "item_id")
	var item models.MenuItem
	if err := h.db.Where("id = ? AND is_customizable = ?", idStr, true).First(&item).Error; err != nil {
		http.Error(w, `{"detail":"Custom item not found"}`, http.StatusNotFound)
		return
	}

	var req struct {
		Name           *string              `json:"name"`
		Description    *string              `json:"description"`
		BasePricePaise *int                 `json:"base_price_paise"`
		ImageURLs      []string             `json:"image_urls"`
		IsVegetarian   *bool                `json:"is_vegetarian"`
		IsAvailable    *bool                `json:"is_available"`
		Sections       []CustomSectionInput `json:"sections"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"detail":"Invalid update payload"}`, http.StatusBadRequest)
		return
	}

	if req.Name != nil {
		item.Name = *req.Name
	}
	if req.Description != nil {
		item.Description = *req.Description
	}
	if req.BasePricePaise != nil {
		item.PricePaise = *req.BasePricePaise
	}
	if req.IsVegetarian != nil {
		item.IsVegetarian = *req.IsVegetarian
	}
	if req.IsAvailable != nil {
		item.IsAvailable = *req.IsAvailable
	}
	if req.ImageURLs != nil {
		imgJSON, _ := json.Marshal(req.ImageURLs)
		item.ImageURLs = string(imgJSON)
	}

	h.db.Save(&item)

	if req.Sections != nil {
		_ = h.db.Where("menu_item_id = ?", item.ID).Delete(&models.MenuSection{})
		for idx, sec := range req.Sections {
			optsJSON, _ := json.Marshal(sec.Options)
			if len(sec.Options) == 0 {
				optsJSON = []byte("[]")
			}
			sRow := models.MenuSection{
				MenuItemID:  item.ID,
				SectionType: "CUSTOM",
				Name:        sec.Name,
				Position:    idx,
				Required:    sec.Required,
				Options:     string(optsJSON),
			}
			_ = h.db.Create(&sRow)
		}
	}

	actorName := "Admin"
	var actorID *uint
	if accVal := r.Context().Value(middleware.AccountContextKey); accVal != nil {
		acc := accVal.(*models.Account)
		actorName = acc.Name
		actorID = &acc.ID
	}
	_ = h.db.Create(&models.AdminEvent{
		EventType: "custom_menu_item_updated",
		Message:   fmt.Sprintf("Custom menu item '%s' updated by %s", item.Name, actorName),
		ActorID:   actorID,
		CreatedAt: time.Now().UTC(),
		Details:   fmt.Sprintf(`{"item_id":%d}`, item.ID),
	})

	h.cache.Delete(r.Context(), "custom_menu:public_list")
	h.db.Preload("Sections").First(&item, item.ID)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(item)
}

func (h *PublicHandler) DeleteCustomMenuItem(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "item_id")
	h.db.Model(&models.MenuItem{}).Where("id = ? AND is_customizable = ?", idStr, true).Update("is_available", false)
	h.cache.Delete(r.Context(), "custom_menu:public_list")
	w.WriteHeader(http.StatusNoContent)
}

// -------------------------------------------------------------
// MENU IMAGES (UPLOAD, SERVE, DELETE, GOOGLE DRIVE PROXY)
// -------------------------------------------------------------

func (h *PublicHandler) UploadMenuImage(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		http.Error(w, `{"detail":"Image size must not exceed 1MB."}`, http.StatusRequestEntityTooLarge)
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, `{"detail":"Invalid file upload"}`, http.StatusBadRequest)
		return
	}
	defer file.Close()

	if header.Size == 0 {
		http.Error(w, `{"detail":"Uploaded file is empty."}`, http.StatusBadRequest)
		return
	}
	if header.Size > 1024*1024 {
		http.Error(w, fmt.Sprintf(`{"detail":"Image size must not exceed 1MB. (Uploaded size: %.2fMB)"}`, float64(header.Size)/(1024*1024)), http.StatusRequestEntityTooLarge)
		return
	}

	contentType := header.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "image/jpeg"
	}
	contentType = strings.ToLower(strings.TrimSpace(contentType))

	allowed := map[string]bool{
		"image/jpeg": true,
		"image/png":  true,
		"image/webp": true,
		"image/gif":  true,
		"image/avif": true,
	}
	if !allowed[contentType] {
		http.Error(w, `{"detail":"Only JPEG, PNG, WebP, GIF, and AVIF image formats are supported."}`, http.StatusBadRequest)
		return
	}

	fileBytes, err := io.ReadAll(file)
	if err != nil {
		http.Error(w, `{"detail":"Failed to read uploaded file"}`, http.StatusInternalServerError)
		return
	}

	ext := ".jpg"
	switch contentType {
	case "image/png":
		ext = ".png"
	case "image/webp":
		ext = ".webp"
	case "image/gif":
		ext = ".gif"
	case "image/avif":
		ext = ".avif"
	}

	sm := storage.GetStorage()
	if sm != nil {
		res, err := sm.UploadMenuImage(r.Context(), fileBytes, header.Filename, contentType)
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(res)
			return
		}
	}

	randBytes := make([]byte, 16)
	_, _ = rand.Read(randBytes)
	uniqueName := hex.EncodeToString(randBytes) + ext

	dir := filepath.Join("public", "menuImages")
	_ = os.MkdirAll(dir, 0755)
	filePath := filepath.Join(dir, uniqueName)
	if err := os.WriteFile(filePath, fileBytes, 0644); err != nil {
		http.Error(w, fmt.Sprintf(`{"detail":"Failed to save image: %v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"url":          "/menu/images/gcs/" + uniqueName,
		"gcs_uri":      fmt.Sprintf("gs://%s/%s/%s", h.cfg.GCSBucketName, h.cfg.GCSMenuImagesFolder, uniqueName),
		"filename":     uniqueName,
		"content_type": contentType,
		"size_bytes":   len(fileBytes),
	})
}

func (h *PublicHandler) ServeGCSMenuImage(w http.ResponseWriter, r *http.Request) {
	filename := chi.URLParam(r, "filename")
	cleanName := filepath.Base(filename)

	sm := storage.GetStorage()
	if sm != nil {
		data, ct, err := sm.GetMenuImageBlob(r.Context(), cleanName)
		if err == nil {
			w.Header().Set("Content-Type", ct)
			w.Header().Set("Cache-Control", "public, max-age=86400, immutable")
			w.Header().Set("X-Content-Type-Options", "nosniff")
			_, _ = w.Write(data)
			return
		}
	}

	paths := []string{
		filepath.Join("public", "menuImages", cleanName),
		filepath.Join("..", "frontend", "public", "menuImages", cleanName),
		filepath.Join("public", cleanName),
	}

	for _, p := range paths {
		if data, err := os.ReadFile(p); err == nil {
			ct := "image/jpeg"
			if strings.HasSuffix(cleanName, ".png") {
				ct = "image/png"
			} else if strings.HasSuffix(cleanName, ".webp") {
				ct = "image/webp"
			} else if strings.HasSuffix(cleanName, ".gif") {
				ct = "image/gif"
			} else if strings.HasSuffix(cleanName, ".avif") {
				ct = "image/avif"
			}
			w.Header().Set("Content-Type", ct)
			w.Header().Set("Cache-Control", "public, max-age=86400, immutable")
			w.Header().Set("X-Content-Type-Options", "nosniff")
			_, _ = w.Write(data)
			return
		}
	}

	http.Error(w, `{"detail":"Menu image not found"}`, http.StatusNotFound)
}

func (h *PublicHandler) DeleteGCSMenuImage(w http.ResponseWriter, r *http.Request) {
	filename := chi.URLParam(r, "filename")
	cleanName := filepath.Base(filename)

	var count int64
	h.db.Model(&models.MenuItem{}).Where("image_urls LIKE ?", "%"+cleanName+"%").Count(&count)
	if count > 0 {
		http.Error(w, `{"detail":"Cannot delete this image from Cloud Storage because it is currently assigned to a menu item."}`, http.StatusBadRequest)
		return
	}

	if sm := storage.GetStorage(); sm != nil {
		_ = sm.DeleteMenuImage(r.Context(), cleanName)
	}

	p := filepath.Join("public", "menuImages", cleanName)
	_ = os.Remove(p)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"deleted":  true,
		"filename": cleanName,
	})
}

var driveFileIDRegex = regexp.MustCompile(`^[A-Za-z0-9_-]{10,200}$`)

func (h *PublicHandler) DriveMenuImage(w http.ResponseWriter, r *http.Request) {
	fileID := chi.URLParam(r, "file_id")
	if !driveFileIDRegex.MatchString(fileID) {
		http.Error(w, `{"detail":"Menu image not found"}`, http.StatusNotFound)
		return
	}

	url := fmt.Sprintf("https://drive.google.com/thumbnail?id=%s&sz=w1200", fileID)
	client := &http.Client{Timeout: 12 * time.Second}
	resp, err := client.Get(url)
	if err != nil || resp.StatusCode != http.StatusOK {
		http.Error(w, `{"detail":"Menu image could not be loaded"}`, http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	ct := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(strings.ToLower(ct), "image/") {
		http.Error(w, `{"detail":"Menu image link did not return an image"}`, http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", ct)
	w.Header().Set("Cache-Control", "public, max-age=300")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = io.Copy(w, resp.Body)
}
