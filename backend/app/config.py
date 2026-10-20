from functools import lru_cache
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "backend/.env"), env_file_encoding="utf-8", extra="ignore")

    app_name: str = "KebabZilla API"
    environment: str = "development"
    api_prefix: str = "/api/v1"
    database_url: str = "sqlite:///./kebabzilla.db"
    jwt_secret: str = "local-development-secret-change-me"
    jwt_issuer: str = "kebabzilla-api"
    access_token_minutes: int = 60
    session_cookie_name: str = "kz_session"
    session_cookie_samesite: str = "lax"
    session_cookie_secure: bool | None = None
    session_lifetime_days: int = 30
    cors_origins: list[str] | str = ["http://localhost:5173", "http://127.0.0.1:5173"]
    business_timezone: str = "Asia/Kolkata"
    razorpay_key_id: str | None = None
    razorpay_key_secret: str | None = None
    razorpay_webhook_secret: str | None = None
    razorpay_api_base: str = "https://api.razorpay.com/v1"
    google_client_id: str | None = None
    google_client_secret: str | None = None
    google_identity_platform_project_id: str | None = None
    google_maps_api_key: str | None = None
    seed_admin_email: str = "admin@kebabzilla.local"
    seed_admin_password: str | None = None
    delivery_otp_api_url: str | None = None
    delivery_otp_api_token: str | None = None
    delivery_otp_sender: str = "KebabZilla"
    offer_sms_api_url: str | None = None
    offer_sms_api_token: str | None = None
    offer_email_api_url: str | None = None
    offer_email_api_token: str | None = None
    offer_sender: str = "KebabZilla"
    email_from_address: str = "support@kebabzilla.in"
    email_from_name: str = "KebabZilla"
    gmail_client_id: str | None = None
    gmail_client_secret: str | None = None
    gmail_refresh_token: str | None = None
    gmail_service_account_json: str | None = None
    gmail_service_account_file: str | None = None
    gmail_delegated_user: str | None = None
    email_sender_backend: str = "auto"
    gcs_bucket_name: str = "kebabzilla_cloud_storage"
    gcs_project_id: str = "kebabzilla"
    gcs_menu_images_folder: str = "menuImages"
    gcs_email_images_folder: str = "emailImages"
    public_backend_url: str = "https://api.kebabzilla.in"
    redis_url: str | None = None

    @model_validator(mode="before")
    @classmethod
    def map_legacy_env_aliases(cls, data: dict) -> dict:
        import os
        alias_map = {
            "public_backend_url": ["PUBLIC_BACKEND_URL", "BACKEND_URL", "publicBackendUrl", "BACKEND_PUBLIC_URL"],
            "redis_url": ["REDIS_URL", "redisUrl", "REDIS_URI", "redis_uri"],
            "jwt_secret": ["JWTsecret", "jwtSecret", "JWT_SECRET"],
            "database_url": ["databaseURL", "databaseUrl", "DATABASE_URL"],
            "cors_origins": ["corsOrigins", "CORS_ORIGINS"],
            "gcs_bucket_name": ["GCSbucket", "gcsBucket", "GCS_BUCKET_NAME"],
            "gcs_project_id": ["GCSprojectID", "gcsProjectID", "GCS_PROJECT_ID"],
            "google_client_id": ["googleClientID", "GOOGLE_CLIENT_ID"],
            "google_client_secret": ["googleClientSecret", "GOOGLE_CLIENT_SECRET"],
            "google_maps_api_key": ["googleMapAPIkey", "googleMapsApiKey", "GOOGLE_MAPS_API_KEY"],
            "razorpay_key_id": ["razorpayKeyID", "razorpayKeyId", "RAZORPAY_KEY_ID"],
            "razorpay_key_secret": ["razorpayKeySecret", "RAZORPAY_KEY_SECRET"],
            "seed_admin_email": ["seedAdminEmail", "SEED_ADMIN_EMAIL"],
            "seed_admin_password": ["seedAdminPassword", "SEED_ADMIN_PASSWORD"],
            "email_from_address": ["EMAIL_FROM_ADDRESS", "emailFromAddress", "SMTP_FROM_EMAIL", "SMTP_EMAIL", "smtp_from_email", "smtp_email"],
            "email_from_name": ["EMAIL_FROM_NAME", "emailFromName", "SMTP_FROM_NAME", "smtp_from_name"],
            "gmail_client_id": ["GMAIL_CLIENT_ID", "gmailClientId"],
            "gmail_client_secret": ["GMAIL_CLIENT_SECRET", "gmailClientSecret"],
            "gmail_refresh_token": ["GMAIL_REFRESH_TOKEN", "gmailRefreshToken"],
            "gmail_service_account_json": ["GMAIL_SERVICE_ACCOUNT_JSON", "gmailServiceAccountJson"],
            "gmail_service_account_file": ["GMAIL_SERVICE_ACCOUNT_FILE", "gmailServiceAccountFile"],
            "gmail_delegated_user": ["GMAIL_DELEGATED_USER", "gmailDelegatedUser"],
            "email_sender_backend": ["EMAIL_SENDER_BACKEND", "emailSenderBackend"],
        }
        res = dict(data) if isinstance(data, dict) else {}
        for field, aliases in alias_map.items():
            if res.get(field) is None:
                for alias in aliases:
                    if alias in res and res[alias] is not None:
                        res[field] = res[alias]
                        break
                    elif alias in os.environ and os.environ[alias]:
                        res[field] = os.environ[alias]
                        break
        return res

    @field_validator("database_url", mode="before")
    @classmethod
    def normalize_database_url(cls, value: object) -> object:
        if isinstance(value, str):
            val = value.strip().strip("'\"")
            # Handle accidental "DATABASE_URL=" or "database_url=" prefix
            if "=" in val and val.split("=", 1)[0].strip().upper() == "DATABASE_URL":
                val = val.split("=", 1)[1].strip().strip("'\"")
            if val.startswith("postgres://"):
                return val.replace("postgres://", "postgresql+psycopg://", 1)
            if val.startswith("postgresql://") and not val.startswith("postgresql+"):
                return val.replace("postgresql://", "postgresql+psycopg://", 1)
            return val
        return value

    @field_validator("session_cookie_samesite", mode="before")
    @classmethod
    def normalize_samesite(cls, value: object) -> str:
        if isinstance(value, str):
            val = value.strip().lower()
            if val in ("lax", "strict"):
                return val
            if val == "none":
                return "lax"
        return "lax"

    @field_validator("cors_origins", mode="after")
    @classmethod
    def split_origins(cls, value: object) -> list[str]:
        if isinstance(value, str):
            trimmed = value.strip()
            if trimmed.startswith("[") and trimmed.endswith("]"):
                try:
                    import json
                    parsed = json.loads(trimmed)
                    if isinstance(parsed, list):
                        return [str(origin).strip() for origin in parsed if str(origin).strip()]
                except Exception:
                    pass
            return [origin.strip().strip("'\"") for origin in value.split(",") if origin.strip().strip("'\"")]
        if isinstance(value, list):
            return [str(origin).strip().strip("'\"") for origin in value if str(origin).strip().strip("'\"")]
        return []

    @model_validator(mode="after")
    def validate_runtime_configuration(self):
        try:
            ZoneInfo(self.business_timezone)
        except ZoneInfoNotFoundError as exc:
            raise ValueError("BUSINESS_TIMEZONE must be a valid IANA timezone") from exc
        if self.environment.casefold() == "production":
            if self.jwt_secret == "local-development-secret-change-me" or len(self.jwt_secret) < 32:
                raise ValueError("Production requires a unique JWT_SECRET of at least 32 characters")
            if not self.database_url.startswith("postgresql"):
                raise ValueError("Production requires PostgreSQL")
            if not self.cors_origins or "*" in self.cors_origins:
                raise ValueError("Production CORS_ORIGINS must explicitly list trusted frontend origins")
        if not self.gmail_client_id and self.google_client_id:
            self.gmail_client_id = self.google_client_id
        if not self.gmail_client_secret and self.google_client_secret:
            self.gmail_client_secret = self.google_client_secret
        if not self.gmail_delegated_user:
            self.gmail_delegated_user = self.email_from_address or "support@kebabzilla.in"
        return self

    @property
    def smtp_from_email(self) -> str:
        return self.email_from_address

    @property
    def smtp_from_name(self) -> str:
        return self.email_from_name


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
