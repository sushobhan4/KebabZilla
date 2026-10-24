package security

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/kebabzilla/go-backend/config"
	"github.com/kebabzilla/go-backend/models"
	"golang.org/x/crypto/argon2"
)

type JWTClaims struct {
	Sub       string `json:"sub"`
	AccountID uint   `json:"account_id,omitempty"`
	SessionID uint   `json:"sid,omitempty"`
	Role      string `json:"role"`
	Type      string `json:"type,omitempty"`
	jwt.RegisteredClaims
}

func HashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	// Argon2id parameters matching standard production security
	hash := argon2.IDKey([]byte(password), salt, 1, 64*1024, 4, 32)
	encoded := fmt.Sprintf("$argon2id$v=19$m=65536,t=1,p=4$%s$%s",
		hex.EncodeToString(salt),
		hex.EncodeToString(hash),
	)
	return encoded, nil
}

func isHexString(s string) bool {
	if len(s) == 0 {
		return false
	}
	for _, c := range s {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			return false
		}
	}
	return true
}

func decodeSaltOrHash(s string) ([]byte, error) {
	// If 32 or 64 hex characters (Go backend format), decode as hex first
	if (len(s) == 32 || len(s) == 64) && isHexString(s) {
		if b, err := hex.DecodeString(s); err == nil {
			return b, nil
		}
	}
	// Raw Base64 (FastAPI pwdlib / passlib format)
	if b, err := base64.RawStdEncoding.DecodeString(s); err == nil {
		return b, nil
	}
	// Standard Base64 with padding
	if b, err := base64.StdEncoding.DecodeString(s); err == nil {
		return b, nil
	}
	// General Hex fallback
	return hex.DecodeString(s)
}

func VerifyPassword(password, encodedHash string) bool {
	parts := strings.Split(encodedHash, "$")
	if len(parts) < 6 || parts[1] != "argon2id" {
		return false
	}

	var memory uint32 = 64 * 1024
	var iterations uint32 = 1
	var threads uint8 = 4

	for _, param := range strings.Split(parts[3], ",") {
		kv := strings.Split(param, "=")
		if len(kv) == 2 {
			val, _ := strconv.Atoi(kv[1])
			switch kv[0] {
			case "m":
				memory = uint32(val)
			case "t":
				iterations = uint32(val)
			case "p":
				threads = uint8(val)
			}
		}
	}

	salt, err := decodeSaltOrHash(parts[4])
	if err != nil {
		return false
	}

	expectedHash, err := decodeSaltOrHash(parts[5])
	if err != nil {
		return false
	}

	computedHash := argon2.IDKey([]byte(password), salt, iterations, memory, threads, uint32(len(expectedHash)))
	return subtle.ConstantTimeCompare(expectedHash, computedHash) == 1
}

func GenerateSecureToken(byteLength int) string {
	b := make([]byte, byteLength)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func HashToken(rawToken string) string {
	h := sha256.Sum256([]byte(strings.TrimSpace(rawToken)))
	return hex.EncodeToString(h[:])
}

// ComputeCompositeDeviceFingerprint combines client hardware signals (WebGL, CPU arch) with normalized UA
func ComputeCompositeDeviceFingerprint(clientFp, userAgent string) string {
	normalizedUA := normalizeUserAgent(userAgent)
	raw := fmt.Sprintf("%s###%s", strings.TrimSpace(clientFp), normalizedUA)
	h := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(h[:])
}

func normalizeUserAgent(ua string) string {
	clean := strings.TrimSpace(ua)
	// Strip volatile patch versions to avoid false-positive session drops
	re := regexp.MustCompile(`\b(Chrome|Firefox|Safari|Version|Edg)/(\d+)\.[\d\.]+`)
	clean = re.ReplaceAllString(clean, "$1/$2.0")
	return clean
}

func CreateAccessToken(accountID, sessionID uint, role models.Role, cfg *config.Config) (string, error) {
	now := time.Now().UTC()
	claims := JWTClaims{
		Sub:       strconv.FormatUint(uint64(accountID), 10),
		AccountID: accountID,
		SessionID: sessionID,
		Role:      string(role),
		Type:      "access",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Duration(cfg.AccessTokenSeconds) * time.Second)),
			IssuedAt:  jwt.NewNumericDate(now),
			Issuer:    "kebabzilla-api",
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(cfg.JWTSecret))
}

func ParseAccessToken(tokenString string, cfg *config.Config) (*JWTClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &JWTClaims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return []byte(cfg.JWTSecret), nil
	})
	if err != nil {
		return nil, err
	}
	if claims, ok := token.Claims.(*JWTClaims); ok && token.Valid {
		if claims.AccountID == 0 && claims.Sub != "" {
			if id, err := strconv.ParseUint(claims.Sub, 10, 64); err == nil {
				claims.AccountID = uint(id)
			}
		}
		return claims, nil
	}
	return nil, fmt.Errorf("invalid token claims")
}

// 2FA Security Helpers (1:1 with backend-fastAPI)

func GenerateOTP(digits int) string {
	b := make([]byte, digits)
	_, _ = rand.Read(b)
	result := make([]byte, digits)
	for i := 0; i < digits; i++ {
		result[i] = '0' + (b[i] % 10)
	}
	return string(result)
}

func Hash2FACode(code, jwtSecret string) string {
	mac := hmac.New(sha256.New, []byte(jwtSecret))
	mac.Write([]byte(strings.TrimSpace(code)))
	return hex.EncodeToString(mac.Sum(nil))
}

func Verify2FACode(code, hashed, jwtSecret string) bool {
	expected := Hash2FACode(code, jwtSecret)
	return subtle.ConstantTimeCompare([]byte(expected), []byte(strings.TrimSpace(hashed))) == 1
}

func Generate2FATempToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func Hash2FATempToken(tempToken string) string {
	h := sha256.Sum256([]byte(strings.TrimSpace(tempToken)))
	return hex.EncodeToString(h[:])
}

func SetAuthCookies(w http.ResponseWriter, cfg *config.Config, accessToken, refreshToken, csrfToken string) {
	isSecure := cfg.Environment == "production"

	// 1. kz_access (JWT access token)
	if accessToken != "" {
		http.SetCookie(w, &http.Cookie{
			Name:     cfg.AccessCookieName,
			Value:    accessToken,
			Path:     "/",
			MaxAge:   cfg.AccessTokenSeconds,
			HttpOnly: true,
			Secure:   isSecure,
			SameSite: http.SameSiteLaxMode,
		})
	}

	// 2. kz_refresh (30-day rotating session token)
	if refreshToken != "" {
		http.SetCookie(w, &http.Cookie{
			Name:     cfg.RefreshCookieName,
			Value:    refreshToken,
			Path:     "/",
			MaxAge:   cfg.RefreshTokenDays * 86400,
			HttpOnly: true,
			Secure:   isSecure,
			SameSite: http.SameSiteLaxMode,
		})
	}

	// 3. kz_csrf_token
	if csrfToken != "" {
		http.SetCookie(w, &http.Cookie{
			Name:     cfg.CsrfCookieName,
			Value:    csrfToken,
			Path:     "/",
			MaxAge:   cfg.RefreshTokenDays * 86400,
			HttpOnly: false, // readable by client for Double-Submit CSRF
			Secure:   isSecure,
			SameSite: http.SameSiteLaxMode,
		})
	}

	// Clear out any legacy subpath cookies (e.g. from FastAPI or old setups) that could conflict
	legacyPaths := []string{"/api/v1/auth", "/auth", "/api/v1"}
	names := []string{cfg.AccessCookieName, cfg.RefreshCookieName, cfg.SessionCookieName}
	for _, p := range legacyPaths {
		for _, name := range names {
			http.SetCookie(w, &http.Cookie{
				Name:     name,
				Value:    "",
				Path:     p,
				MaxAge:   -1,
				HttpOnly: true,
				Secure:   isSecure,
				SameSite: http.SameSiteLaxMode,
			})
		}
	}
}

func ClearAuthCookies(w http.ResponseWriter, cfg *config.Config) {
	isSecure := cfg.Environment == "production"
	names := []string{cfg.AccessCookieName, cfg.RefreshCookieName, cfg.SessionCookieName, cfg.CsrfCookieName}
	paths := []string{"/", "/api/v1/auth", "/auth", "/api/v1"}
	for _, p := range paths {
		for _, name := range names {
			http.SetCookie(w, &http.Cookie{
				Name:     name,
				Value:    "",
				Path:     p,
				MaxAge:   -1,
				HttpOnly: true,
				Secure:   isSecure,
				SameSite: http.SameSiteLaxMode,
			})
		}
	}
}
