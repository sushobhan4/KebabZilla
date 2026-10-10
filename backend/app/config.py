from functools import lru_cache
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

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
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
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
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_username: str = "support@kebabzilla.in"
    smtp_password: str | None = None
    smtp_from_email: str = "support@kebabzilla.in"
    smtp_from_name: str = "KebabZilla"

    @field_validator("cors_origins", mode="before")
    @classmethod
    def split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

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
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
