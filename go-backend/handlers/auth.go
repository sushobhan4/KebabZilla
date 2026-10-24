package handlers

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/kebabzilla/go-backend/clustering"
	"github.com/kebabzilla/go-backend/config"
	"github.com/kebabzilla/go-backend/mailer"
	"github.com/kebabzilla/go-backend/middleware"
	"github.com/kebabzilla/go-backend/models"
	"github.com/kebabzilla/go-backend/security"
	"gorm.io/gorm"
)

type AuthHandler struct {
	cfg *config.Config
	db  *gorm.DB
}

func NewAuthHandler(cfg *config.Config, db *gorm.DB) *AuthHandler {
	return &AuthHandler{cfg: cfg, db: db}
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type GoogleLoginRequest struct {
	Credential string `json:"credential"`
}

type GoogleTokenInfo struct {
	Email         string `json:"email"`
	EmailVerified string `json:"email_verified"`
	Name          string `json:"name"`
	Sub           string `json:"sub"`
	Aud           string `json:"aud"`
}

type RegisterRequest struct {
	Name               string  `json:"name"`
	Email              string  `json:"email"`
	Phone              *string `json:"phone"`
	Password           string  `json:"password"`
	PromotionalConsent bool    `json:"promotional_consent"`
}

type ForgotPasswordRequest struct {
	Email string `json:"email"`
}

type ResetPasswordRequest struct {
	Email       string `json:"email"`
	OTP         string `json:"otp"`
	NewPassword string `json:"new_password"`
}

type TwoFactorVerifyRequest struct {
	TempToken string `json:"temp_token"`
	Code      string `json:"code"`
}

type AccountResponse struct {
	ID                    uint                    `json:"id"`
	Email                 string                  `json:"email"`
	Name                  string                  `json:"name"`
	Phone                 *string                 `json:"phone"`
	Addresses             []models.AccountAddress `json:"addresses"`
	Role                  models.Role             `json:"role"`
	MustChangePassword    bool                    `json:"must_change_password"`
	IsAcceptingDeliveries bool                    `json:"is_accepting_deliveries"`
	PromotionalConsent    bool                    `json:"promotional_consent"`
	CreatedAt             time.Time               `json:"created_at"`
}

type TokenResponse struct {
	AccessToken  string           `json:"access_token,omitempty"`
	RefreshToken string           `json:"refresh_token,omitempty"`
	TokenType    string           `json:"token_type"`
	ExpiresIn    int              `json:"expires_in,omitempty"`
	CSRFToken    string           `json:"csrf_token,omitempty"`
	Account      *AccountResponse `json:"account,omitempty"`
	Requires2FA  bool             `json:"requires_2fa"`
	TempToken    *string          `json:"temp_token,omitempty"`
	Email        *string          `json:"email,omitempty"`
	Role         *models.Role     `json:"role,omitempty"`
}

func (h *AuthHandler) buildAccountResponse(account *models.Account) AccountResponse {
	isAccepting := false
	mustChange := false
	var staff models.StaffInfo
	if err := h.db.Where("account_id = ?", account.ID).First(&staff).Error; err == nil {
		if account.Role == models.RoleDelivery || account.Role == models.RoleAdmin {
			isAccepting = staff.IsAcceptingDeliveries
		}
		if account.Role != models.RoleUser {
			mustChange = staff.MustChangePassword
		}
	}

	var addresses []models.AccountAddress
	h.db.Where("account_id = ?", account.ID).Order("is_default desc, id desc").Find(&addresses)
	if addresses == nil {
		addresses = []models.AccountAddress{}
	}

	// Calculate and persist distance_meters for any address that has coordinates but missing distance
	var config models.RestaurantSettings
	hasConfig := h.db.First(&config).Error == nil && config.Latitude != nil && config.Longitude != nil
	routingFactor := config.HaversineRoutingFactor
	if routingFactor <= 1.0 {
		routingFactor = 1.3627
	}
	for i := range addresses {
		if addresses[i].DistanceMeters == nil && addresses[i].Latitude != nil && addresses[i].Longitude != nil && hasConfig {
			distKm := clustering.RoadDistanceKm(*config.Latitude, *config.Longitude, *addresses[i].Latitude, *addresses[i].Longitude, routingFactor)
			distM := int(math.Round(distKm * 1000.0))
			addresses[i].DistanceMeters = &distM
			_ = h.db.Model(&models.AccountAddress{}).Where("id = ?", addresses[i].ID).Update("distance_meters", distM)
		}
	}

	return AccountResponse{
		ID:                    account.ID,
		Email:                 account.Email,
		Name:                  account.Name,
		Phone:                 account.Phone,
		Addresses:             addresses,
		Role:                  account.Role,
		MustChangePassword:    mustChange,
		IsAcceptingDeliveries: isAccepting,
		PromotionalConsent:    account.PromotionalConsent,
		CreatedAt:             account.CreatedAt,
	}
}

func (h *AuthHandler) issueSessionAndRespond(w http.ResponseWriter, r *http.Request, account *models.Account) {
	rawRefreshToken := security.GenerateSecureToken(32)
	tokenHash := security.HashToken(rawRefreshToken)
	csrfToken := security.GenerateSecureToken(16)

	ua := r.UserAgent()
	ip := getIP(r)
	clientFP := r.Header.Get("X-Device-Fingerprint")
	devName := r.Header.Get("X-Device-Name")
	if devName == "" {
		devName = "Device"
	}
	fp := security.ComputeCompositeDeviceFingerprint(clientFP, ua)

	now := time.Now().UTC()
	session := models.UserSession{
		AccountID:         account.ID,
		TokenHash:         tokenHash,
		UserAgent:         ua,
		IPAddress:         ip,
		DeviceFingerprint: fp,
		DeviceName:        devName,
		CreatedAt:         now,
		LastActiveAt:      now,
		ExpiresAt:         now.Add(time.Duration(h.cfg.RefreshTokenDays) * 24 * time.Hour),
		IsRevoked:         false,
	}

	if err := h.db.Create(&session).Error; err != nil {
		http.Error(w, `{"detail":"Could not create session"}`, http.StatusInternalServerError)
		return
	}

	accessJWT, err := security.CreateAccessToken(account.ID, session.ID, account.Role, h.cfg)
	if err != nil {
		http.Error(w, `{"detail":"Could not generate token"}`, http.StatusInternalServerError)
		return
	}

	security.SetAuthCookies(w, h.cfg, accessJWT, rawRefreshToken, csrfToken)
	w.Header().Set("X-CSRF-Token", csrfToken)
	w.Header().Set("Content-Type", "application/json")

	accountResp := h.buildAccountResponse(account)
	_ = json.NewEncoder(w).Encode(TokenResponse{
		AccessToken:  accessJWT,
		RefreshToken: rawRefreshToken,
		TokenType:    "bearer",
		ExpiresIn:    h.cfg.AccessTokenSeconds,
		CSRFToken:    csrfToken,
		Account:      &accountResp,
		Requires2FA:  false,
	})
}

func (h *AuthHandler) initiate2FAChallenge(w http.ResponseWriter, account *models.Account) {
	code := security.GenerateOTP(6)
	codeHash := security.Hash2FACode(code, h.cfg.JWTSecret)
	tempToken := security.Generate2FATempToken()
	tokenHash := security.Hash2FATempToken(tempToken)
	now := time.Now().UTC()
	expiresAt := now.Add(10 * time.Minute)

	// Clean up older 2FA codes for this account
	h.db.Where("account_id = ? AND purpose = ?", account.ID, "2fa").Delete(&models.AllOtp{})

	challenge := models.AllOtp{
		AccountID: &account.ID,
		Email:     &account.Email,
		Purpose:   "2fa",
		TokenHash: &tokenHash,
		OtpCode:   codeHash,
		ExpiresAt: expiresAt,
		Attempts:  0,
		CreatedAt: now,
	}
	if err := h.db.Create(&challenge).Error; err != nil {
		http.Error(w, `{"detail":"Could not initiate 2-step verification"}`, http.StatusInternalServerError)
		return
	}

	// Dispatch 2FA email in background
	mailer.GetMailer().Send2FACode(account.Name, account.Email, code)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(TokenResponse{
		TokenType:   "bearer",
		Requires2FA: true,
		TempToken:   &tempToken,
		Email:       &account.Email,
		Role:        &account.Role,
	})
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"detail":"Invalid credentials format"}`, http.StatusBadRequest)
		return
	}

	email := strings.ToLower(strings.TrimSpace(req.Email))
	var account models.Account
	if err := h.db.Where("email = ?", email).First(&account).Error; err != nil {
		http.Error(w, `{"detail":"Invalid email or password"}`, http.StatusUnauthorized)
		return
	}

	pwdHash := account.GetPasswordHash()
	if pwdHash == "" || !security.VerifyPassword(req.Password, pwdHash) {
		http.Error(w, `{"detail":"Invalid email or password"}`, http.StatusUnauthorized)
		return
	}

	// Enforce 2FA for all staff roles (ADMIN, EMPLOYEE, DELIVERY) exactly matching backend-fastAPI
	roleStr := strings.ToUpper(strings.TrimSpace(string(account.Role)))
	if roleStr == "ADMIN" || roleStr == "EMPLOYEE" || roleStr == "DELIVERY" {
		h.initiate2FAChallenge(w, &account)
		return
	}

	h.issueSessionAndRespond(w, r, &account)
}

func (h *AuthHandler) Verify2FA(w http.ResponseWriter, r *http.Request) {
	var req TwoFactorVerifyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.TempToken) == "" || strings.TrimSpace(req.Code) == "" {
		http.Error(w, `{"detail":"Verification code and session token are required"}`, http.StatusBadRequest)
		return
	}

	tokenHash := security.Hash2FATempToken(req.TempToken)
	var challenge models.AllOtp
	err := h.db.Where("token_hash = ? AND purpose = ?", tokenHash, "2fa").First(&challenge).Error
	if err != nil {
		http.Error(w, `{"detail":"Invalid or expired 2-step verification session"}`, http.StatusBadRequest)
		return
	}

	now := time.Now().UTC()
	if challenge.ExpiresAt.Before(now) {
		h.db.Delete(&challenge)
		http.Error(w, `{"detail":"Verification code has expired. Please log in again."}`, http.StatusBadRequest)
		return
	}

	if challenge.Attempts >= 5 {
		h.db.Delete(&challenge)
		http.Error(w, `{"detail":"Too many invalid attempts. Please log in again."}`, http.StatusTooManyRequests)
		return
	}

	if !security.Verify2FACode(req.Code, challenge.OtpCode, h.cfg.JWTSecret) {
		challenge.Attempts++
		if challenge.Attempts >= 5 {
			h.db.Delete(&challenge)
		} else {
			h.db.Save(&challenge)
		}
		http.Error(w, `{"detail":"Invalid verification code"}`, http.StatusBadRequest)
		return
	}

	if challenge.AccountID == nil {
		h.db.Delete(&challenge)
		http.Error(w, `{"detail":"Account not found"}`, http.StatusNotFound)
		return
	}

	var account models.Account
	if err := h.db.First(&account, *challenge.AccountID).Error; err != nil {
		h.db.Delete(&challenge)
		http.Error(w, `{"detail":"Account not found"}`, http.StatusNotFound)
		return
	}

	// Clean up successful challenge immediately
	h.db.Delete(&challenge)

	h.issueSessionAndRespond(w, r, &account)
}

func (h *AuthHandler) GoogleLogin(w http.ResponseWriter, r *http.Request) {
	var req GoogleLoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Credential) == "" {
		http.Error(w, `{"detail":"Missing Google ID token"}`, http.StatusBadRequest)
		return
	}

	token := strings.TrimSpace(req.Credential)
	verifyURL := fmt.Sprintf("https://oauth2.googleapis.com/tokeninfo?id_token=%s", url.QueryEscape(token))

	resp, err := http.Get(verifyURL)
	if err != nil || resp.StatusCode != http.StatusOK {
		http.Error(w, `{"detail":"Google verification failed"}`, http.StatusUnauthorized)
		return
	}
	defer resp.Body.Close()

	var tInfo GoogleTokenInfo
	if err := json.NewDecoder(resp.Body).Decode(&tInfo); err != nil || tInfo.Email == "" {
		http.Error(w, `{"detail":"Invalid Google token data"}`, http.StatusUnauthorized)
		return
	}

	email := strings.ToLower(strings.TrimSpace(tInfo.Email))
	var account models.Account
	err = h.db.Where("email = ?", email).First(&account).Error
	if err != nil {
		// New Google user registration
		now := time.Now().UTC()
		name := strings.TrimSpace(tInfo.Name)
		if name == "" {
			name = strings.Split(email, "@")[0]
		}
		account = models.Account{
			Email:              email,
			Name:               name,
			Role:               models.RoleUser,
			PromotionalConsent: true,
			CreatedAt:          now,
		}
		if err := h.db.Create(&account).Error; err != nil {
			http.Error(w, `{"detail":"Could not create user account"}`, http.StatusInternalServerError)
			return
		}
	}

	// Enforce 2FA for staff/admin on Google login as well
	if account.Role == models.RoleAdmin || account.Role == models.RoleEmployee || account.Role == models.RoleDelivery {
		h.initiate2FAChallenge(w, &account)
		return
	}

	h.issueSessionAndRespond(w, r, &account)
}

func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var req RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"detail":"Invalid registration payload"}`, http.StatusBadRequest)
		return
	}

	email := strings.ToLower(strings.TrimSpace(req.Email))
	if email == "" || req.Password == "" || req.Name == "" {
		http.Error(w, `{"detail":"Name, email, and password are required"}`, http.StatusBadRequest)
		return
	}

	var count int64
	h.db.Model(&models.Account{}).Where("email = ?", email).Count(&count)
	if count > 0 {
		http.Error(w, `{"detail":"An account with this email already exists"}`, http.StatusConflict)
		return
	}

	hashed, err := security.HashPassword(req.Password)
	if err != nil {
		http.Error(w, `{"detail":"Could not hash password"}`, http.StatusInternalServerError)
		return
	}

	now := time.Now().UTC()
	account := models.Account{
		Email:        email,
		Name:         strings.TrimSpace(req.Name),
		Phone:        req.Phone,
		PasswordHash: &hashed,
		Role:         models.RoleUser,
		IsActive:     true,
		CreatedAt:    now,
	}

	if err := h.db.Create(&account).Error; err != nil {
		http.Error(w, `{"detail":"Could not create account"}`, http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
	h.issueSessionAndRespond(w, r, &account)
}

func (h *AuthHandler) CheckEmail(w http.ResponseWriter, r *http.Request) {
	email := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("email")))
	var count int64
	if email != "" {
		h.db.Model(&models.Account{}).Where("email = ?", email).Count(&count)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"exists":    count > 0,
		"available": count == 0,
	})
}

func (h *AuthHandler) GetMe(w http.ResponseWriter, r *http.Request) {
	accountVal := r.Context().Value(middleware.AccountContextKey)
	if accountVal == nil {
		http.Error(w, `{"detail":"Not authenticated"}`, http.StatusUnauthorized)
		return
	}

	account := accountVal.(*models.Account)
	csrfToken := ""
	if cookie, err := r.Cookie(h.cfg.CsrfCookieName); err == nil && cookie.Value != "" {
		csrfToken = cookie.Value
	} else {
		csrfToken = security.GenerateSecureToken(16)
		security.SetAuthCookies(w, h.cfg, "", "", csrfToken)
	}
	w.Header().Set("X-CSRF-Token", csrfToken)
	w.Header().Set("Content-Type", "application/json")

	accountResp := h.buildAccountResponse(account)
	_ = json.NewEncoder(w).Encode(accountResp)
}

func (h *AuthHandler) GetCSRF(w http.ResponseWriter, r *http.Request) {
	csrfToken := ""
	if cookie, err := r.Cookie(h.cfg.CsrfCookieName); err == nil && cookie.Value != "" {
		csrfToken = cookie.Value
	} else {
		csrfToken = security.GenerateSecureToken(16)
		security.SetAuthCookies(w, h.cfg, "", "", csrfToken)
	}
	w.Header().Set("X-CSRF-Token", csrfToken)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"csrf_token": csrfToken})
}

func (h *AuthHandler) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	accountVal := r.Context().Value(middleware.AccountContextKey)
	if accountVal == nil {
		http.Error(w, `{"detail":"Not authenticated"}`, http.StatusUnauthorized)
		return
	}
	account := accountVal.(*models.Account)

	var req struct {
		Name      string                  `json:"name"`
		Phone     *string                 `json:"phone"`
		Addresses []models.AccountAddress `json:"addresses"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"detail":"Invalid profile update payload"}`, http.StatusBadRequest)
		return
	}

	if strings.TrimSpace(req.Name) != "" {
		account.Name = strings.TrimSpace(req.Name)
	}
	account.Phone = req.Phone
	h.db.Save(account)

	if req.Addresses != nil {
		var config models.RestaurantSettings
		hasConfig := h.db.First(&config).Error == nil && config.Latitude != nil && config.Longitude != nil
		routingFactor := config.HaversineRoutingFactor
		if routingFactor <= 1.0 {
			routingFactor = 1.3627
		}

		// Replace saved addresses
		h.db.Where("account_id = ?", account.ID).Delete(&models.AccountAddress{})
		now := time.Now().UTC()
		for _, addr := range req.Addresses {
			addr.ID = 0
			addr.AccountID = account.ID
			if addr.AddressID == "" {
				addr.AddressID = fmt.Sprintf("addr_%d_%d", account.ID, time.Now().UnixNano()%100000)
			}
			if addr.Latitude != nil && addr.Longitude != nil && hasConfig {
				distKm := clustering.RoadDistanceKm(*config.Latitude, *config.Longitude, *addr.Latitude, *addr.Longitude, routingFactor)
				distM := int(math.Round(distKm * 1000.0))
				addr.DistanceMeters = &distM
			}
			addr.CreatedAt = now
			_ = h.db.Create(&addr)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(h.buildAccountResponse(account))
}

func (h *AuthHandler) ForgotPassword(w http.ResponseWriter, r *http.Request) {
	var req ForgotPasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"detail":"Invalid request"}`, http.StatusBadRequest)
		return
	}

	email := strings.ToLower(strings.TrimSpace(req.Email))
	var account models.Account
	if err := h.db.Where("email = ?", email).First(&account).Error; err == nil {
		otpCode := fmt.Sprintf("%06d", time.Now().UnixNano()%1000000)
		hashedOtp, _ := security.HashPassword(otpCode)
		now := time.Now().UTC()
		h.db.Where("email = ? AND purpose IN ('forgot_password', 'password_reset')", email).Delete(&models.AllOtp{})
		otpRecord := models.AllOtp{
			AccountID: &account.ID,
			Purpose:   "password_reset",
			OtpCode:   hashedOtp,
			Email:     &email,
			ExpiresAt: now.Add(15 * time.Minute),
			CreatedAt: now,
		}
		_ = h.db.Create(&otpRecord)
		mailer.GetMailer().SendPasswordReset(account.Name, email, otpCode)
	}

	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"message":"If an active account uses that email, a password reset code has been sent."}`))
}

func (h *AuthHandler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	var req ResetPasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"detail":"Invalid request"}`, http.StatusBadRequest)
		return
	}

	email := strings.ToLower(strings.TrimSpace(req.Email))
	var otpRecord models.AllOtp
	err := h.db.Where("email = ? AND purpose IN ('forgot_password', 'password_reset') AND expires_at > ?", email, time.Now().UTC()).
		Order("created_at desc").First(&otpRecord).Error
	if err != nil || !security.VerifyPassword(req.OTP, otpRecord.OtpCode) {
		http.Error(w, `{"detail":"Invalid or expired recovery code"}`, http.StatusBadRequest)
		return
	}

	hashed, err := security.HashPassword(req.NewPassword)
	if err != nil {
		http.Error(w, `{"detail":"Could not hash password"}`, http.StatusInternalServerError)
		return
	}

	h.db.Model(&models.Account{}).Where("email = ?", email).Updates(map[string]any{
		"password_hash": hashed,
	})
	var target models.Account
	if err := h.db.Where("email = ?", email).First(&target).Error; err == nil {
		_ = h.db.Model(&models.StaffInfo{}).Where("account_id = ?", target.ID).Update("must_change_password", false)
	}

	_ = h.db.Delete(&otpRecord)
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"message":"Password reset successful. You may now log in."}`))
}

func (h *AuthHandler) SendVerificationOTP(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email   string `json:"email"`
		Purpose string `json:"purpose"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	email := strings.ToLower(strings.TrimSpace(req.Email))
	if email == "" {
		http.Error(w, `{"detail":"Email is required"}`, http.StatusBadRequest)
		return
	}
	if req.Purpose == "" {
		req.Purpose = "registration"
	}

	if req.Purpose == "registration" || req.Purpose == "register" {
		var cnt int64
		h.db.Model(&models.Account{}).Where("email = ?", email).Count(&cnt)
		if cnt > 0 {
			http.Error(w, `{"detail":"An account with this email already exists"}`, http.StatusConflict)
			return
		}
	}

	otpCode := fmt.Sprintf("%06d", time.Now().UnixNano()%1000000)
	hashedOtp, _ := security.HashPassword(otpCode)
	now := time.Now().UTC()
	h.db.Where("email = ? AND purpose = ?", email, req.Purpose).Delete(&models.AllOtp{})
	otpRecord := models.AllOtp{
		Purpose:   req.Purpose,
		OtpCode:   hashedOtp,
		Email:     &email,
		ExpiresAt: now.Add(10 * time.Minute),
		CreatedAt: now,
	}
	_ = h.db.Create(&otpRecord)
	mailer.GetMailer().SendVerificationOTP(email, otpCode, req.Purpose)

	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"status":"OTP_SENT","message":"Verification code sent"}`))
}

func (h *AuthHandler) VerifyEmailOTP(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email string `json:"email"`
		OTP   string `json:"otp"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	email := strings.ToLower(strings.TrimSpace(req.Email))

	var otpRecord models.AllOtp
	err := h.db.Where("email = ? AND expires_at > ?", email, time.Now().UTC()).
		Order("created_at desc").First(&otpRecord).Error
	if err != nil || !security.VerifyPassword(req.OTP, otpRecord.OtpCode) {
		http.Error(w, `{"detail":"Invalid or expired verification code"}`, http.StatusBadRequest)
		return
	}

	_ = h.db.Delete(&otpRecord)
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"status":"VERIFIED","message":"Email verified successfully"}`))
}

func (h *AuthHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	var candidates []string
	if headerToken := strings.TrimSpace(r.Header.Get("X-Refresh-Token")); headerToken != "" {
		candidates = append(candidates, headerToken)
	}
	for _, cookie := range r.Cookies() {
		if (cookie.Name == h.cfg.RefreshCookieName || cookie.Name == h.cfg.SessionCookieName) && strings.TrimSpace(cookie.Value) != "" {
			candidates = append(candidates, strings.TrimSpace(cookie.Value))
		}
	}

	if len(candidates) == 0 {
		http.Error(w, `{"detail":"Refresh token missing"}`, http.StatusUnauthorized)
		return
	}

	var session models.UserSession
	var matchedToken string
	var matchedHash string
	found := false

	for _, cand := range candidates {
		hash := security.HashToken(cand)
		var s models.UserSession
		if err := h.db.Where("token_hash = ? OR previous_token_hash = ?", hash, hash).First(&s).Error; err == nil {
			session = s
			matchedToken = cand
			matchedHash = hash
			found = true
			break
		}
	}

	if !found || session.IsRevoked {
		security.ClearAuthCookies(w, h.cfg)
		http.Error(w, `{"detail":"Invalid or revoked session"}`, http.StatusUnauthorized)
		return
	}

	now := time.Now().UTC()
	if session.ExpiresAt.Before(now) {
		session.IsRevoked = true
		h.db.Save(&session)
		security.ClearAuthCookies(w, h.cfg)
		http.Error(w, `{"detail":"Session expired"}`, http.StatusUnauthorized)
		return
	}

	var account models.Account
	if err := h.db.First(&account, session.AccountID).Error; err != nil {
		security.ClearAuthCookies(w, h.cfg)
		http.Error(w, `{"detail":"Account not found"}`, http.StatusUnauthorized)
		return
	}

	// Case 1: Matched current token_hash
	if matchedHash == session.TokenHash {
		// If rotated very recently (< 15 seconds ago) and grace window is active,
		// avoid thrashing the session hash on rapid parallel requests; return fresh access token with current refresh token.
		if session.PreviousTokenHash != nil && session.GracePeriodUntil != nil && now.Before(*session.GracePeriodUntil) {
			accessJWT, _ := security.CreateAccessToken(account.ID, session.ID, account.Role, h.cfg)
			csrfToken := security.GenerateSecureToken(16)
			security.SetAuthCookies(w, h.cfg, accessJWT, matchedToken, csrfToken)
			w.Header().Set("X-CSRF-Token", csrfToken)
			w.Header().Set("Content-Type", "application/json")

			accResp := h.buildAccountResponse(&account)
			_ = json.NewEncoder(w).Encode(TokenResponse{
				AccessToken:  accessJWT,
				RefreshToken: matchedToken,
				TokenType:    "bearer",
				ExpiresIn:    h.cfg.AccessTokenSeconds,
				CSRFToken:    csrfToken,
				Account:      &accResp,
				Requires2FA:  false,
			})
			return
		}

		// Normal Rotation
		newRefreshToken := security.GenerateSecureToken(32)
		newHash := security.HashToken(newRefreshToken)
		oldHash := session.TokenHash
		graceUntil := now.Add(15 * time.Second) // 15-second grace window

		session.PreviousTokenHash = &oldHash
		session.TokenHash = newHash
		session.GracePeriodUntil = &graceUntil
		session.LastActiveAt = now
		session.ExpiresAt = now.Add(time.Duration(h.cfg.RefreshTokenDays) * 24 * time.Hour)
		h.db.Save(&session)

		accessJWT, _ := security.CreateAccessToken(account.ID, session.ID, account.Role, h.cfg)
		csrfToken := security.GenerateSecureToken(16)
		security.SetAuthCookies(w, h.cfg, accessJWT, newRefreshToken, csrfToken)
		w.Header().Set("X-CSRF-Token", csrfToken)
		w.Header().Set("Content-Type", "application/json")

		accResp := h.buildAccountResponse(&account)
		_ = json.NewEncoder(w).Encode(TokenResponse{
			AccessToken:  accessJWT,
			RefreshToken: newRefreshToken,
			TokenType:    "bearer",
			ExpiresIn:    h.cfg.AccessTokenSeconds,
			CSRFToken:    csrfToken,
			Account:      &accResp,
			Requires2FA:  false,
		})
		return
	}

	// Case 2: Parallel multi-tab request within 60-second grace window
	if session.PreviousTokenHash != nil && matchedHash == *session.PreviousTokenHash {
		if session.GracePeriodUntil != nil && now.Before(*session.GracePeriodUntil) {
			accessJWT, _ := security.CreateAccessToken(account.ID, session.ID, account.Role, h.cfg)
			csrfToken := security.GenerateSecureToken(16)
			security.SetAuthCookies(w, h.cfg, accessJWT, matchedToken, csrfToken)
			w.Header().Set("X-CSRF-Token", csrfToken)
			w.Header().Set("Content-Type", "application/json")

			accResp := h.buildAccountResponse(&account)
			_ = json.NewEncoder(w).Encode(TokenResponse{
				AccessToken:  accessJWT,
				RefreshToken: matchedToken,
				TokenType:    "bearer",
				ExpiresIn:    h.cfg.AccessTokenSeconds,
				CSRFToken:    csrfToken,
				Account:      &accResp,
				Requires2FA:  false,
			})
			return
		}

		session.IsRevoked = true
		h.db.Save(&session)
		security.ClearAuthCookies(w, h.cfg)
		http.Error(w, `{"detail":"Session compromised and terminated"}`, http.StatusUnauthorized)
		return
	}

	// Neither current nor previous hash
	security.ClearAuthCookies(w, h.cfg)
	http.Error(w, `{"detail":"Invalid or revoked session"}`, http.StatusUnauthorized)
}

func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	if claimsVal := r.Context().Value(middleware.ClaimsContextKey); claimsVal != nil {
		claims := claimsVal.(*security.JWTClaims)
		if claims.SessionID > 0 {
			h.db.Model(&models.UserSession{}).Where("id = ?", claims.SessionID).Update("is_revoked", true)
		}
	} else if cookie, err := r.Cookie(h.cfg.RefreshCookieName); err == nil && cookie.Value != "" {
		hsh := security.HashToken(cookie.Value)
		h.db.Model(&models.UserSession{}).Where("token_hash = ? OR previous_token_hash = ?", hsh, hsh).Update("is_revoked", true)
	}
	security.ClearAuthCookies(w, h.cfg)
	w.WriteHeader(http.StatusNoContent)
}

type ChangePasswordRequest struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

func (h *AuthHandler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	account := r.Context().Value(middleware.AccountContextKey).(*models.Account)

	var req ChangePasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.NewPassword) < 6 {
		http.Error(w, `{"detail":"Password must be at least 6 characters"}`, http.StatusBadRequest)
		return
	}

	if !account.MustChangePassword {
		if account.PasswordHash == nil || !security.VerifyPassword(req.CurrentPassword, *account.PasswordHash) {
			http.Error(w, `{"detail":"Current password is incorrect"}`, http.StatusBadRequest)
			return
		}
	}

	if account.PasswordHash != nil && security.VerifyPassword(req.NewPassword, *account.PasswordHash) {
		http.Error(w, `{"detail":"Choose a new password you have not used before"}`, http.StatusBadRequest)
		return
	}

	hashed, err := security.HashPassword(req.NewPassword)
	if err != nil {
		http.Error(w, `{"detail":"Failed to hash password"}`, http.StatusInternalServerError)
		return
	}

	account.PasswordHash = &hashed
	account.MustChangePassword = false
	h.db.Save(account)

	// Update StaffInfo if account has staff profile
	var staffInfo models.StaffInfo
	if err := h.db.Where("account_id = ?", account.ID).First(&staffInfo).Error; err == nil {
		staffInfo.MustChangePassword = false
		h.db.Save(&staffInfo)
	}

	// Revoke sessions on all other devices, keeping current device active
	var currentSessionID uint
	if claimsVal := r.Context().Value(middleware.ClaimsContextKey); claimsVal != nil {
		claims := claimsVal.(*security.JWTClaims)
		currentSessionID = claims.SessionID
	}
	if currentSessionID > 0 {
		h.db.Model(&models.UserSession{}).Where("account_id = ? AND id != ? AND is_revoked = false", account.ID, currentSessionID).Update("is_revoked", true)
	} else {
		h.db.Model(&models.UserSession{}).Where("account_id = ? AND is_revoked = false", account.ID).Update("is_revoked", true)
	}

	w.WriteHeader(http.StatusNoContent)
}

type PromotionalConsentRequest struct {
	PromotionalConsent bool `json:"promotional_consent"`
}

func (h *AuthHandler) UpdatePromotionalConsent(w http.ResponseWriter, r *http.Request) {
	account := r.Context().Value(middleware.AccountContextKey).(*models.Account)

	var req PromotionalConsentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"detail":"Invalid request body"}`, http.StatusBadRequest)
		return
	}

	account.PromotionalConsent = req.PromotionalConsent
	h.db.Save(account)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(h.buildAccountResponse(account))
}

type UserSessionOut struct {
	ID           uint      `json:"id"`
	DeviceName   string    `json:"device_name"`
	DeviceType   string    `json:"device_type"`
	Country      string    `json:"country"`
	Region       string    `json:"region"`
	City         string    `json:"city"`
	Location     string    `json:"location"`
	IPAddress    string    `json:"ip_address"`
	CreatedAt    time.Time `json:"created_at"`
	LastActiveAt time.Time `json:"last_active_at"`
	IsCurrent    bool      `json:"is_current"`
	IsRevoked    bool      `json:"is_revoked"`
}

func (h *AuthHandler) ListSessions(w http.ResponseWriter, r *http.Request) {
	account := r.Context().Value(middleware.AccountContextKey).(*models.Account)

	var currentSessionID uint
	if claimsVal := r.Context().Value(middleware.ClaimsContextKey); claimsVal != nil {
		claims := claimsVal.(*security.JWTClaims)
		currentSessionID = claims.SessionID
	}

	var sessions []models.UserSession
	h.db.Where("account_id = ?", account.ID).Order("is_revoked asc, last_active_at desc").Find(&sessions)

	out := make([]UserSessionOut, 0, len(sessions))
	for _, s := range sessions {
		devName := s.DeviceName
		if devName == "" {
			devName = "Desktop Browser"
		}
		locParts := []string{}
		if s.City != "" && s.City != "Unknown" {
			locParts = append(locParts, s.City)
		}
		if s.Country != "" && s.Country != "Unknown" {
			locParts = append(locParts, s.Country)
		}
		loc := strings.Join(locParts, ", ")
		if loc == "" {
			loc = "Unknown location"
		}

		out = append(out, UserSessionOut{
			ID:           s.ID,
			DeviceName:   devName,
			DeviceType:   "desktop",
			Country:      s.Country,
			Region:       s.Region,
			City:         s.City,
			Location:     loc,
			IPAddress:    s.IPAddress,
			CreatedAt:    s.CreatedAt,
			LastActiveAt: s.LastActiveAt,
			IsCurrent:    currentSessionID > 0 && s.ID == currentSessionID,
			IsRevoked:    s.IsRevoked,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}

func (h *AuthHandler) RevokeSession(w http.ResponseWriter, r *http.Request) {
	account := r.Context().Value(middleware.AccountContextKey).(*models.Account)
	sessionIDStr := chi.URLParam(r, "session_id")
	sessionID, err := strconv.ParseUint(sessionIDStr, 10, 64)
	if err != nil {
		http.Error(w, `{"detail":"Invalid session ID"}`, http.StatusBadRequest)
		return
	}

	var session models.UserSession
	if err := h.db.Where("id = ? AND account_id = ?", sessionID, account.ID).First(&session).Error; err != nil {
		http.Error(w, `{"detail":"Session not found"}`, http.StatusNotFound)
		return
	}

	session.IsRevoked = true
	h.db.Save(&session)

	var currentSessionID uint
	if claimsVal := r.Context().Value(middleware.ClaimsContextKey); claimsVal != nil {
		claims := claimsVal.(*security.JWTClaims)
		currentSessionID = claims.SessionID
	}
	isCurrent := currentSessionID > 0 && uint(sessionID) == currentSessionID
	if isCurrent {
		security.ClearAuthCookies(w, h.cfg)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"revoked":    true,
		"is_current": isCurrent,
	})
}

func (h *AuthHandler) RevokeOtherSessions(w http.ResponseWriter, r *http.Request) {
	account := r.Context().Value(middleware.AccountContextKey).(*models.Account)

	var currentSessionID uint
	if claimsVal := r.Context().Value(middleware.ClaimsContextKey); claimsVal != nil {
		claims := claimsVal.(*security.JWTClaims)
		currentSessionID = claims.SessionID
	}

	tx := h.db.Model(&models.UserSession{}).Where("account_id = ? AND is_revoked = false", account.ID)
	if currentSessionID > 0 {
		tx = tx.Where("id != ?", currentSessionID)
	}
	res := tx.Update("is_revoked", true)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"revoked_count": res.RowsAffected,
	})
}

func getIP(r *http.Request) string {
	forwarded := r.Header.Get("X-Forwarded-For")
	if forwarded != "" {
		parts := strings.Split(forwarded, ",")
		return strings.TrimSpace(parts[0])
	}
	return r.RemoteAddr
}
