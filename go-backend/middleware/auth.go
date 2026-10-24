package middleware

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/kebabzilla/go-backend/config"
	"github.com/kebabzilla/go-backend/models"
	"github.com/kebabzilla/go-backend/security"
	"gorm.io/gorm"
)

type contextKey string

const (
	AccountContextKey contextKey = "account"
	ClaimsContextKey  contextKey = "claims"
)

func RequireAuth(cfg *config.Config, db *gorm.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			tokenString := ""

			// 1. Try Bearer header
			authHeader := r.Header.Get("Authorization")
			if strings.HasPrefix(authHeader, "Bearer ") {
				tokenString = strings.TrimPrefix(authHeader, "Bearer ")
			}

			// 2. Try kz_access cookie
			if tokenString == "" {
				if cookie, err := r.Cookie(cfg.AccessCookieName); err == nil {
					tokenString = cookie.Value
				}
			}

			if tokenString != "" {
				claims, err := security.ParseAccessToken(tokenString, cfg)
				if err == nil && claims != nil {
					accountID := claims.AccountID
					if accountID == 0 && claims.Sub != "" {
						if id, err := strconv.ParseUint(claims.Sub, 10, 64); err == nil {
							accountID = uint(id)
						}
					}
					var account models.Account
					if err := db.First(&account, accountID).Error; err == nil && account.ID > 0 {
						ctx := context.WithValue(r.Context(), AccountContextKey, &account)
						ctx = context.WithValue(ctx, ClaimsContextKey, claims)
						next.ServeHTTP(w, r.WithContext(ctx))
						return
					}
				}

				// Also check if tokenString itself is an opaque session/refresh token
				tokenHash := security.HashToken(tokenString)
				var session models.UserSession
				err = db.Where("(token_hash = ? OR previous_token_hash = ?) AND is_revoked = false AND expires_at > ?",
					tokenHash, tokenHash, time.Now().UTC()).First(&session).Error
				if err == nil && session.AccountID > 0 {
					var account models.Account
					if err := db.First(&account, session.AccountID).Error; err == nil && account.ID > 0 {
						ctx := context.WithValue(r.Context(), AccountContextKey, &account)
						next.ServeHTTP(w, r.WithContext(ctx))
						return
					}
				}
			}

			// 3. Fallback: Try X-Refresh-Token header or kz_refresh / kz_session cookies
			var candidateTokens []string
			if rToken := strings.TrimSpace(r.Header.Get("X-Refresh-Token")); rToken != "" {
				candidateTokens = append(candidateTokens, rToken)
			}
			for _, cookie := range r.Cookies() {
				if (cookie.Name == cfg.RefreshCookieName || cookie.Name == cfg.SessionCookieName) && strings.TrimSpace(cookie.Value) != "" {
					candidateTokens = append(candidateTokens, strings.TrimSpace(cookie.Value))
				}
			}

			now := time.Now().UTC()
			for _, sessionToken := range candidateTokens {
				tokenHash := security.HashToken(sessionToken)
				var session models.UserSession
				err := db.Where("(token_hash = ? OR previous_token_hash = ?) AND is_revoked = false AND expires_at > ?",
					tokenHash, tokenHash, now).First(&session).Error
				if err == nil && session.AccountID > 0 {
					var account models.Account
					if err := db.First(&account, session.AccountID).Error; err == nil && account.ID > 0 {
						ctx := context.WithValue(r.Context(), AccountContextKey, &account)
						next.ServeHTTP(w, r.WithContext(ctx))
						return
					}
				}
			}

			http.Error(w, `{"detail":"Not authenticated"}`, http.StatusUnauthorized)
		})
	}
}

func RequireRole(roles ...models.Role) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			accountVal := r.Context().Value(AccountContextKey)
			if accountVal == nil {
				http.Error(w, `{"detail":"Not authenticated"}`, http.StatusUnauthorized)
				return
			}

			account := accountVal.(*models.Account)
			allowed := false
			for _, role := range roles {
				if account.Role == role || account.Role == models.RoleAdmin {
					allowed = true
					break
				}
			}

			if !allowed {
				http.Error(w, `{"detail":"Forbidden"}`, http.StatusForbidden)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
