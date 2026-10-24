package main

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	chiMiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/kebabzilla/go-backend/cache"
	"github.com/kebabzilla/go-backend/config"
	"github.com/kebabzilla/go-backend/handlers"
	"github.com/kebabzilla/go-backend/mailer"
	"github.com/kebabzilla/go-backend/middleware"
	"github.com/kebabzilla/go-backend/models"
	"github.com/kebabzilla/go-backend/storage"
)

//go:embed public/*
var embeddedPublic embed.FS

func main() {
	cfg := config.LoadConfig()
	db := models.InitDB(cfg)
	c := cache.InitCache(cfg)
	mailer.InitMailer(cfg)
	storage.InitStorage(cfg)

	// Flush any legacy / stale menu and restaurant cache keys to ensure fresh Postgres rendering
	ctx := context.Background()
	c.Delete(ctx, "menu:public_list")
	c.Delete(ctx, "menu:public_list_v2")
	c.Delete(ctx, "menu_categories")
	c.Delete(ctx, "menu_categories_v2")
	c.Delete(ctx, "custom_menu:public_list")
	c.Delete(ctx, "custom_menu:public_list_v2")
	c.Delete(ctx, "store:public_status")
	c.Delete(ctx, "public_restaurant")
	c.Delete(ctx, "restaurant:public")
	c.Delete(ctx, "restaurant:public:v2")
	c.DeletePrefix(ctx, "store:")
	c.DeletePrefix(ctx, "restaurant:")

	r := chi.NewRouter()

	// 1. Core Chi Middlewares
	r.Use(chiMiddleware.RequestID)
	r.Use(chiMiddleware.RealIP)
	r.Use(chiMiddleware.Logger)
	r.Use(chiMiddleware.Recoverer)

	// 2. CORS matching FastAPI configuration
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.CORSOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token", "X-Refresh-Token", "X-Device-Fingerprint", "X-Device-Name", "X-Razorpay-Signature"},
		ExposedHeaders:   []string{"Link", "X-CSRF-Token", "X-Refresh-Token"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// Handlers
	authHandler := handlers.NewAuthHandler(cfg, db)
	publicHandler := handlers.NewPublicHandler(cfg, db, c)
	orderHandler := handlers.NewOrderHandler(cfg, db)
	staffDeliveryHandler := handlers.NewStaffDeliveryHandler(cfg, db)
	adminHandler := handlers.NewAdminHandler(cfg, db, c)

	// Static public email-images helper
	serveEmailImage := func(w http.ResponseWriter, r *http.Request) {
		filename := chi.URLParam(r, "filename")
		cleanName := filepath.Base(filename)

		// 1. Check embedded assets first (compiled directly into the binary)
		data, err := embeddedPublic.ReadFile("public/" + cleanName)
		if err == nil {
			w.Header().Set("Cache-Control", "public, max-age=86400, immutable")
			w.Header().Set("Access-Control-Allow-Origin", "*")
			if strings.HasSuffix(cleanName, ".png") {
				w.Header().Set("Content-Type", "image/png")
			} else if strings.HasSuffix(cleanName, ".jpg") || strings.HasSuffix(cleanName, ".jpeg") {
				w.Header().Set("Content-Type", "image/jpeg")
			} else if strings.HasSuffix(cleanName, ".svg") {
				w.Header().Set("Content-Type", "image/svg+xml")
			}
			_, _ = w.Write(data)
			return
		}

		// 2. Check local disk fallbacks
		path := filepath.Join("public", cleanName)
		if _, err := os.Stat(path); err == nil {
			w.Header().Set("Cache-Control", "public, max-age=86400, immutable")
			w.Header().Set("Access-Control-Allow-Origin", "*")
			http.ServeFile(w, r, path)
			return
		}
		pathFront := filepath.Join("..", "frontend", "public", cleanName)
		if _, err := os.Stat(pathFront); err == nil {
			w.Header().Set("Cache-Control", "public, max-age=86400, immutable")
			w.Header().Set("Access-Control-Allow-Origin", "*")
			http.ServeFile(w, r, pathFront)
			return
		}

		// 3. Check GCS / dynamic email images storage
		if sm := storage.GetStorage(); sm != nil {
			if blob, ct, err := sm.GetEmailImageBlob(r.Context(), cleanName); err == nil {
				w.Header().Set("Content-Type", ct)
				w.Header().Set("Cache-Control", "public, max-age=86400, immutable")
				w.Header().Set("Access-Control-Allow-Origin", "*")
				w.Header().Set("X-Content-Type-Options", "nosniff")
				_, _ = w.Write(blob)
				return
			}
		}

		http.NotFound(w, r)
	}

	// Static file helper for fonts and SEO assets
	serveStaticFile := func(filename, contentType string) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			cleanName := filepath.Base(filename)
			paths := []string{
				filepath.Join("public", cleanName),
				filepath.Join("..", "frontend", "public", cleanName),
				filepath.Join("..", "firebase-public", cleanName),
			}
			for _, p := range paths {
				if _, err := os.Stat(p); err == nil {
					w.Header().Set("Content-Type", contentType)
					w.Header().Set("Cache-Control", "public, max-age=86400, immutable")
					w.Header().Set("Access-Control-Allow-Origin", "*")
					http.ServeFile(w, r, p)
					return
				}
			}
			http.NotFound(w, r)
		}
	}

	// Font serving helper
	serveFont := func(w http.ResponseWriter, r *http.Request) {
		filename := chi.URLParam(r, "filename")
		cleanName := filepath.Base(filename)
		paths := []string{
			filepath.Join("public", "fonts", cleanName),
			filepath.Join("..", "frontend", "public", "fonts", cleanName),
			filepath.Join("public", cleanName),
		}
		for _, p := range paths {
			if _, err := os.Stat(p); err == nil {
				mt := "font/ttf"
				if strings.HasSuffix(cleanName, ".woff2") {
					mt = "font/woff2"
				}
				w.Header().Set("Content-Type", mt)
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				w.Header().Set("Access-Control-Allow-Origin", "*")
				w.Header().Set("X-Content-Type-Options", "nosniff")
				http.ServeFile(w, r, p)
				return
			}
		}
		http.NotFound(w, r)
	}

	// Email images proxy helper
	serveProxyEmailImage := func(w http.ResponseWriter, r *http.Request) {
		imgURL := r.URL.Query().Get("url")
		if imgURL == "" {
			http.Error(w, `{"detail":"Invalid URL"}`, http.StatusBadRequest)
			return
		}
		parsed, err := url.Parse(imgURL)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
			http.Error(w, `{"detail":"Invalid URL"}`, http.StatusBadRequest)
			return
		}

		client := &http.Client{Timeout: 10 * time.Second}
		resp, err := client.Get(imgURL)
		if err != nil || resp.StatusCode != http.StatusOK {
			http.Error(w, `{"detail":"Upstream image failed"}`, http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()

		ct := resp.Header.Get("Content-Type")
		if ct == "" {
			ct = "image/jpeg"
		}
		w.Header().Set("Content-Type", ct)
		w.Header().Set("Cache-Control", "public, max-age=86400, immutable")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		_, _ = io.Copy(w, resp.Body)
	}

	copyOtpHandler := func(w http.ResponseWriter, r *http.Request) {
		code := r.URL.Query().Get("code")
		email := r.URL.Query().Get("email")
		redirectUrl := "/login"
		if email != "" {
			redirectUrl = fmt.Sprintf("/forgot-password?email=%s&otp=%s", url.QueryEscape(email), url.QueryEscape(code))
		}
		html := fmt.Sprintf(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>KebabZilla — Verification Code</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: #0b0d10;
      color: #f3f4f6;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px 16px;
    }
    .card {
      background-color: #111318;
      border: 1px solid #282c37;
      border-radius: 18px;
      max-width: 480px;
      width: 100%%;
      overflow: hidden;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.65);
      text-align: center;
      padding: 36px 28px;
    }
    .brand-title {
      font-size: 36px;
      color: #fdfbf7;
      margin-bottom: 20px;
      font-weight: 800;
    }
    .code-box {
      background-color: rgba(20, 24, 32, 0.85);
      border: 2px solid #e05334;
      border-radius: 14px;
      padding: 20px 24px;
      margin: 0 auto 16px;
      cursor: pointer;
    }
    .code-digits {
      font-family: monospace;
      font-size: 40px;
      font-weight: 800;
      letter-spacing: 8px;
      color: #fbf1df;
    }
    .btn-primary {
      display: block;
      width: 100%%;
      background-color: #c34226;
      color: #ffffff;
      text-decoration: none;
      padding: 15px 24px;
      font-size: 15px;
      font-weight: 800;
      border-radius: 10px;
      border: none;
      cursor: pointer;
      margin-top: 16px;
    }
    .btn-secondary {
      display: block;
      width: 100%%;
      margin-top: 12px;
      background: rgba(255, 255, 255, 0.08);
      color: #f3f4f6;
      border: 1px solid rgba(255, 255, 255, 0.15);
      padding: 13px 20px;
      font-size: 14px;
      font-weight: 600;
      border-radius: 10px;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand-title">KebabZilla</div>
    <div class="code-box" onclick="copyCode()">
      <div class="code-digits" id="otpText">%s</div>
    </div>
    <button class="btn-primary" onclick="copyCode()">📋 Copy Code to Clipboard</button>
    <a class="btn-secondary" href="%s">Continue to KebabZilla &rarr;</a>
  </div>
  <script>
    const code = %q;
    function copyCode() {
      if (!code) return;
      navigator.clipboard.writeText(code).then(() => {
        alert('Code copied to clipboard!');
      });
    }
    window.addEventListener('DOMContentLoaded', () => { if (code) copyCode(); });
  </script>
</body>
</html>`, code, redirectUrl, code)
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(html))
	}

	// SEO & Static Fallbacks
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok","backend":"go","framework":"chi"}`))
	})
	r.Get("/robots.txt", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /ops\nDisallow: /delivery\nSitemap: https://kebabzilla.in/sitemap.xml\n"))
	})
	r.Get("/sitemap.xml", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/xml")
		_, _ = w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://kebabzilla.in/</loc><changefreq>daily</changefreq><priority>1.0</priority></url></urlset>`))
	})
	r.Get("/copy-otp", copyOtpHandler)
	r.Get("/favicon.ico", serveStaticFile("favicon.ico", "image/x-icon"))
	r.Get("/og-image.jpg", serveStaticFile("og-image.jpg", "image/jpeg"))
	r.Get("/og-image.webp", serveStaticFile("og-image.webp", "image/webp"))
	r.Get("/kebab-thumbnail.jpg", serveStaticFile("kebab-thumbnail.jpg", "image/jpeg"))
	r.Get("/kebab-thumbnail.webp", serveStaticFile("kebab-thumbnail.webp", "image/webp"))
	r.Get("/public/email-images/{filename}", serveEmailImage)
	r.Get("/email-images/{filename}", serveEmailImage)
	r.Get("/fonts/{filename}", serveFont)
	r.Get("/email-images-proxy", serveProxyEmailImage)
	r.Get("/menu/images/{file_id}", publicHandler.DriveMenuImage)
	r.Get("/menu/images/gcs/{filename}", publicHandler.ServeGCSMenuImage)
	r.Post("/system/backup", adminHandler.SystemDatabaseBackup)

	// Common API Route Installer (mounted at /api/v1, /api, and root)
	installAPIRoutes := func(sub chi.Router) {
		// Static Public Email Images & Helpers
		sub.Get("/public/email-images/{filename}", serveEmailImage)
		sub.Get("/email-images/{filename}", serveEmailImage)
		sub.Get("/public/emailImages/{filename}", serveEmailImage)
		sub.Get("/emailImages/{filename}", serveEmailImage)
		sub.Get("/public/fonts/{filename}", serveFont)
		sub.Get("/fonts/{filename}", serveFont)
		sub.Get("/public/email-images-proxy", serveProxyEmailImage)
		sub.Get("/email-images-proxy", serveProxyEmailImage)
		sub.Get("/public/copy-otp", copyOtpHandler)
		sub.Get("/copy-otp", copyOtpHandler)
		sub.Get("/og-image.jpg", serveStaticFile("og-image.jpg", "image/jpeg"))
		sub.Get("/og-image.webp", serveStaticFile("og-image.webp", "image/webp"))
		sub.Get("/kebab-thumbnail.jpg", serveStaticFile("kebab-thumbnail.jpg", "image/jpeg"))
		sub.Get("/kebab-thumbnail.webp", serveStaticFile("kebab-thumbnail.webp", "image/webp"))
		sub.Get("/menu/images/{file_id}", publicHandler.DriveMenuImage)
		sub.Get("/menu/images/gcs/{filename}", publicHandler.ServeGCSMenuImage)
		sub.Post("/system/backup", adminHandler.SystemDatabaseBackup)

		// Public Storefront Endpoints
		sub.Get("/restaurant", publicHandler.GetRestaurant)
		sub.Get("/restaurant/delivery-estimate", publicHandler.EstimateDelivery)
		sub.Get("/menu", publicHandler.GetMenuItems)
		sub.Get("/menu/categories", publicHandler.GetCategories)
		sub.Get("/custom-menu", publicHandler.GetCustomMenu)

		// Menu Management (Admin)
		sub.Group(func(m chi.Router) {
			m.Use(middleware.RequireAuth(cfg, db))
			m.Use(middleware.RequireRole(models.RoleAdmin))
			m.Get("/menu/manage", publicHandler.GetMenuManage)
			m.Post("/menu", publicHandler.CreateMenuItem)
			m.Patch("/menu/{item_id}", publicHandler.UpdateMenuItem)
			m.Delete("/menu/{item_id}", publicHandler.DeleteMenuItem)
			m.Post("/menu/categories", publicHandler.CreateCategory)
			m.Delete("/menu/categories/{category_id}", publicHandler.DeleteCategory)
			m.Post("/menu/images/upload", publicHandler.UploadMenuImage)
			m.Delete("/menu/images/gcs/{filename}", publicHandler.DeleteGCSMenuImage)

			m.Post("/custom-menu", publicHandler.CreateCustomMenuItem)
			m.Patch("/custom-menu/{item_id}", publicHandler.UpdateCustomMenuItem)
			m.Delete("/custom-menu/{item_id}", publicHandler.DeleteCustomMenuItem)
		})

		// Custom Menu Manage (Admin and Staff)
		sub.Group(func(cm chi.Router) {
			cm.Use(middleware.RequireAuth(cfg, db))
			cm.Use(middleware.RequireRole(models.RoleAdmin, models.RoleEmployee))
			cm.Get("/custom-menu/manage", publicHandler.GetCustomMenuManage)
		})

		// Cart Endpoints
		sub.Group(func(c chi.Router) {
			c.Use(middleware.RequireAuth(cfg, db))
			c.Get("/cart", publicHandler.GetCart)
			c.Put("/cart", publicHandler.SyncCart)
			c.Post("/cart/items", publicHandler.AddOrUpdateCartItem)
			c.Put("/cart/items/{menu_item_id}", publicHandler.UpdateStandardCartItem)
			c.Delete("/cart/items/{item_id}", publicHandler.DeleteCartItem)
			c.Delete("/cart", publicHandler.ClearCart)
		})

		// Auth Routes
		sub.Route("/auth", func(a chi.Router) {
			a.Post("/login", authHandler.Login)
			a.Post("/verify-2fa", authHandler.Verify2FA)
			a.Post("/google", authHandler.GoogleLogin)
			a.Post("/register", authHandler.Register)
			a.Get("/check-email", authHandler.CheckEmail)
			a.Get("/csrf", authHandler.GetCSRF)
			a.Post("/forgot-password", authHandler.ForgotPassword)
			a.Post("/reset-password", authHandler.ResetPassword)
			a.Post("/send-verification-otp", authHandler.SendVerificationOTP)
			a.Post("/verify-email-otp", authHandler.VerifyEmailOTP)
			a.Post("/refresh", authHandler.Refresh)
			a.Post("/logout", authHandler.Logout)

			// Authenticated auth routes
			a.Group(func(authGroup chi.Router) {
				authGroup.Use(middleware.RequireAuth(cfg, db))
				authGroup.Get("/me", authHandler.GetMe)
				authGroup.Patch("/profile", authHandler.UpdateProfile)
				authGroup.Patch("/promotional-consent", authHandler.UpdatePromotionalConsent)
				authGroup.Post("/change-password", authHandler.ChangePassword)
				authGroup.Get("/sessions", authHandler.ListSessions)
				authGroup.Post("/sessions/{session_id}/revoke", authHandler.RevokeSession)
				authGroup.Post("/sessions/revoke-others", authHandler.RevokeOtherSessions)
			})
		})

		// Customer Orders & Tracking
		sub.Route("/orders", func(o chi.Router) {
			o.Use(middleware.RequireAuth(cfg, db))
			o.Post("/", orderHandler.CreateOrder)
			o.Get("/", orderHandler.GetOrders)
			o.Get("/{order_id}", orderHandler.GetOrder)
			o.Post("/{order_id}/cancel", orderHandler.CancelOrder)
			o.Post("/{order_id}/abandon", orderHandler.AbandonOrder)
			o.Post("/{order_id}/switch-to-cash", orderHandler.SwitchToCash)
			o.Post("/{order_id}/payment-session", orderHandler.PaymentSession)
		})

		// Payments
		sub.Route("/payments", func(p chi.Router) {
			p.Post("/razorpay/webhook", orderHandler.RazorpayWebhook)
			p.Group(func(authPay chi.Router) {
				authPay.Use(middleware.RequireAuth(cfg, db))
				authPay.Post("/verify-razorpay", orderHandler.VerifyRazorpayPayment)
				authPay.Post("/razorpay/verify", orderHandler.VerifyRazorpayPayment)
			})
		})

		// Staff / Kitchen Queue Operations
		sub.Route("/staff", func(s chi.Router) {
			s.Use(middleware.RequireAuth(cfg, db))
			s.Use(middleware.RequireRole(models.RoleEmployee, models.RoleAdmin))
			s.Get("/orders", staffDeliveryHandler.GetKitchenQueue)
			s.Post("/orders/{order_id}/transition", staffDeliveryHandler.TransitionKitchenOrder)
			s.Patch("/orders/{order_id}/status", staffDeliveryHandler.TransitionKitchenOrder)
			s.Get("/menu", staffDeliveryHandler.GetStaffMenu)
			s.Get("/menu-pauses", staffDeliveryHandler.GetStaffMenuPauses)
			s.Post("/menu/{item_id}/pause", staffDeliveryHandler.PauseMenuItem)
			s.Delete("/menu/{item_id}/pause", staffDeliveryHandler.ResumeMenuItem)
			s.Post("/custom-menu/{item_id}/pause", staffDeliveryHandler.PauseMenuItem)
			s.Delete("/custom-menu/{item_id}/pause", staffDeliveryHandler.ResumeMenuItem)
			s.Post("/walk-in", staffDeliveryHandler.CreateWalkInOrder)
			s.Get("/drafts", staffDeliveryHandler.GetStaffDrafts)
			s.Post("/drafts", staffDeliveryHandler.SaveStaffDraft)
			s.Delete("/drafts/{draft_id}", staffDeliveryHandler.DeleteStaffDraft)
		})

		// Delivery / Rider Operations & ALNS Clustering
		sub.Route("/delivery", func(d chi.Router) {
			d.Use(middleware.RequireAuth(cfg, db))
			d.Use(middleware.RequireRole(models.RoleDelivery, models.RoleAdmin))
			d.Get("/recommended-batches", staffDeliveryHandler.GetRecommendedBatches)
			d.Post("/recommended-batches/claim", staffDeliveryHandler.ClaimRecommendedBatches)
			d.Post("/batches", staffDeliveryHandler.CreateBatch)
			d.Get("/batches", staffDeliveryHandler.ListBatches)
			d.Post("/orders/{order_id}/claim", staffDeliveryHandler.ClaimDeliveryOrder)
			d.Post("/duty", staffDeliveryHandler.ToggleDuty)
			d.Get("/duty-status", staffDeliveryHandler.GetDeliveryDutyStatus)
			d.Post("/duty-status", staffDeliveryHandler.GetDeliveryDutyStatus)
			d.Get("/queue", staffDeliveryHandler.GetDeliveryQueue)
			d.Get("/available", staffDeliveryHandler.GetDeliveryAvailable)
			d.Get("/history", staffDeliveryHandler.GetDeliveryHistory)
			d.Post("/orders/{order_id}/verify-otp", staffDeliveryHandler.VerifyDeliveryOTP)
		})

		// Admin Console Endpoints
		sub.Route("/admin", func(adm chi.Router) {
			adm.Use(middleware.RequireAuth(cfg, db))
			adm.Use(middleware.RequireRole(models.RoleAdmin))
			adm.Get("/orders", adminHandler.GetAdminOrders)
			adm.Patch("/orders/{order_id}/status", adminHandler.UpdateOrderStatus)
			adm.Post("/orders/{order_id}/unassign-delivery", adminHandler.UnassignDelivery)
			adm.Post("/orders/{order_id}/refund", adminHandler.RefundOrder)
			adm.Get("/accounts", adminHandler.GetAccounts)
			adm.Post("/accounts", adminHandler.CreateAccount)
			adm.Patch("/accounts/{account_id}/role", adminHandler.UpdateAccountRole)
			adm.Get("/accounts/{account_id}/orders", adminHandler.GetAccountOrders)
			adm.Get("/reports/sales", adminHandler.GetSalesReport)
			adm.Get("/events", adminHandler.GetAdminEvents)
			adm.Get("/settings", adminHandler.GetSettings)
			adm.Put("/settings", adminHandler.UpdateSettings)
			adm.Post("/settings/recalculate-distances", adminHandler.RecalculateDistances)
			adm.Get("/email-status", adminHandler.GetEmailStatus)
			adm.Get("/discounts", adminHandler.GetDiscounts)
			adm.Post("/discounts", adminHandler.CreateDiscount)
			adm.Put("/discounts/{discount_id}", adminHandler.UpdateDiscount)
			adm.Delete("/discounts/{discount_id}", adminHandler.DeleteDiscount)
			adm.Get("/offers", adminHandler.GetOffers)
			adm.Post("/offers", adminHandler.CreateOffer)
			adm.Get("/email-images", adminHandler.ListEmailImages)
			adm.Post("/email-images/upload", adminHandler.UploadEmailImage)
			adm.Delete("/email-images/{filename}", adminHandler.DeleteEmailImage)
			adm.Post("/database/backup", adminHandler.TriggerDatabaseBackup)
			adm.Get("/database/backups", adminHandler.ListDatabaseBackups)
			adm.Get("/delivery-preview", func(w http.ResponseWriter, r *http.Request) {
				var drivers []models.Account
				db.Where("role = ?", models.RoleDelivery).Order("name asc").Find(&drivers)
				res := make([]map[string]any, 0, len(drivers))
				for _, d := range drivers {
					res = append(res, map[string]any{
						"id":    d.ID,
						"name":  d.Name,
						"phone": d.Phone,
					})
				}
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(res)
			})
		})

		sub.Get("/admin-preview/delivery", func(w http.ResponseWriter, r *http.Request) {
			var drivers []models.Account
			db.Where("role = ?", models.RoleDelivery).Order("name asc").Find(&drivers)
			res := make([]map[string]any, 0, len(drivers))
			for _, d := range drivers {
				res = append(res, map[string]any{
					"id":    d.ID,
					"name":  d.Name,
					"phone": d.Phone,
				})
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(res)
		})
	}

	// Mount routes across all client-supported prefixes
	r.Route("/api/v1", installAPIRoutes)
	r.Route("/api", installAPIRoutes)
	installAPIRoutes(r)

	addr := fmt.Sprintf(":%s", cfg.Port)
	log.Printf("🚀 [Go Backend] Chi HTTP server starting on %s (env: %s)", addr, cfg.Environment)
	if err := http.ListenAndServe(addr, r); err != nil {
		log.Fatalf("Server failed: %v", err)
		os.Exit(1)
	}
}
