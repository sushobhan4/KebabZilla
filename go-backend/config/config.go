package config

import (
	"os"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	Port                 string
	Environment          string
	DatabaseURL          string
	JWTSecret            string
	AccessTokenSeconds   int
	RefreshTokenDays     int
	SessionCookieName    string
	AccessCookieName     string
	RefreshCookieName    string
	CsrfCookieName       string
	CORSOrigins          []string
	RedisURL             string
	GoogleClientID       string
	GoogleClientSecret   string
	GmailRefreshToken    string
	GmailClientID        string
	GmailClientSecret    string
	EmailFromAddress     string
	EmailFromName        string
	PublicBackendURL     string
	RazorpayKeyID        string
	RazorpayKeySecret    string
	RazorpayWebhookSecret string
	RazorpayAPIBase      string
	SeedAdminEmail       string
	SeedAdminPassword    string
	BackupAuthSecret     string
	GCSBucketName        string
	GCSProjectID         string
	GCSMenuImagesFolder  string
	GCSEmailImagesFolder string
}

func LoadConfig() *Config {
	// Load .env if present (try parent and current directory)
	_ = godotenv.Load(".env")
	_ = godotenv.Load("../backend-fastAPI/.env")
	_ = godotenv.Load("../backend/.env")

	port := getEnv("PORT", "8080")
	env := getEnv("ENVIRONMENT", "development")
	dbURL := getEnv("DATABASE_URL", "sqlite:kebabzilla.db")
	jwtSecret := getEnv("JWT_SECRET", "kebabzilla-super-secret-dev-key-change-in-prod-min-32-chars")
	redisURL := getEnv("REDIS_URL", "")

	accessSeconds, err := strconv.Atoi(getEnv("ACCESS_TOKEN_SECONDS", "120"))
	if err != nil {
		accessSeconds = 120
	}

	refreshDays, err := strconv.Atoi(getEnv("SESSION_LIFETIME_DAYS", "30"))
	if err != nil {
		refreshDays = 30
	}

	corsRaw := getEnv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,https://kebabzilla.in,https://www.kebabzilla.in,https://sushobhan4.github.io")
	corsList := []string{}
	for _, origin := range strings.Split(corsRaw, ",") {
		origin = strings.TrimSpace(origin)
		if origin != "" {
			corsList = append(corsList, origin)
		}
	}

	googleClientID := getEnv("GOOGLE_CLIENT_ID", "246180384663-jf752n3net3tf4caq3laquoneicitstu.apps.googleusercontent.com")
	googleClientSecret := getEnv("GOOGLE_CLIENT_SECRET", "")
	gmailRefreshToken := getEnv("GMAIL_REFRESH_TOKEN", "")
	gmailClientID := getEnv("GMAIL_CLIENT_ID", googleClientID)
	gmailClientSecret := getEnv("GMAIL_CLIENT_SECRET", googleClientSecret)

	return &Config{
		Port:               port,
		Environment:        env,
		DatabaseURL:        dbURL,
		JWTSecret:          jwtSecret,
		AccessTokenSeconds: accessSeconds,
		RefreshTokenDays:   refreshDays,
		SessionCookieName:  getEnv("SESSION_COOKIE_NAME", "kz_session"),
		AccessCookieName:   getEnv("ACCESS_COOKIE_NAME", "kz_access"),
		RefreshCookieName:  getEnv("REFRESH_COOKIE_NAME", "kz_refresh"),
		CsrfCookieName:     getEnv("CSRF_COOKIE_NAME", "kz_csrf_token"),
		CORSOrigins:        corsList,
		RedisURL:           redisURL,
		GoogleClientID:     googleClientID,
		GoogleClientSecret: googleClientSecret,
		GmailRefreshToken:  gmailRefreshToken,
		GmailClientID:      gmailClientID,
		GmailClientSecret:  gmailClientSecret,
		EmailFromAddress:   getEnv("EMAIL_FROM_ADDRESS", "support@kebabzilla.in"),
		EmailFromName:      getEnv("EMAIL_FROM_NAME", "KebabZilla"),
		PublicBackendURL:   getEnv("PUBLIC_BACKEND_URL", "https://api.kebabzilla.in"),
		RazorpayKeyID:         getEnv("RAZORPAY_KEY_ID", ""),
		RazorpayKeySecret:     getEnv("RAZORPAY_KEY_SECRET", ""),
		RazorpayWebhookSecret: getEnv("RAZORPAY_WEBHOOK_SECRET", ""),
		RazorpayAPIBase:       getEnv("RAZORPAY_API_BASE", "https://api.razorpay.com/v1"),
		SeedAdminEmail:        getEnv("SEED_ADMIN_EMAIL", "admin@kebabzilla.in"),
		SeedAdminPassword:     getEnv("SEED_ADMIN_PASSWORD", "AdminPass123!"),
		BackupAuthSecret:      getEnv("BACKUP_AUTH_SECRET", ""),
		GCSBucketName:         getEnvMulti([]string{"GCS_BUCKET_NAME", "GCSbucket", "gcsBucket"}, "kebabzilla_cloud_storage"),
		GCSProjectID:          getEnvMulti([]string{"GCS_PROJECT_ID", "GCSprojectID", "gcsProjectID"}, "kebabzilla"),
		GCSMenuImagesFolder:   getEnv("GCS_MENU_IMAGES_FOLDER", "menuImages"),
		GCSEmailImagesFolder:  getEnv("GCS_EMAIL_IMAGES_FOLDER", "emailImages"),
	}
}

func getEnvMulti(keys []string, defaultVal string) string {
	for _, key := range keys {
		if val, ok := os.LookupEnv(key); ok && strings.TrimSpace(val) != "" {
			return strings.TrimSpace(val)
		}
	}
	return defaultVal
}

func getEnv(key, defaultVal string) string {
	if val, ok := os.LookupEnv(key); ok && strings.TrimSpace(val) != "" {
		return strings.TrimSpace(val)
	}
	return defaultVal
}
