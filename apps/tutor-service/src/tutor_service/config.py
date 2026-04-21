"""Config del tutor-service."""
from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    service_name: str = "tutor-service"
    service_port: int = 8006
    environment: str = "development"
    log_level: str = "info"
    log_format: str = "json"

    cors_origins: list[str] = Field(default_factory=lambda: ["*"])
    otel_endpoint: str = "http://localhost:4317"
    sentry_dsn: str = ""

    redis_url: str = "redis://localhost:6379/2"

    # URLs de los servicios dependientes
    governance_service_url: str = "http://localhost:8010"
    content_service_url: str = "http://localhost:8009"
    ai_gateway_url: str = "http://localhost:8011"
    ctr_service_url: str = "http://localhost:8007"

    # Prompt y modelo default (override por tenant vía active_configs)
    default_prompt_name: str = "tutor"
    default_prompt_version: str = "v1.0.0"
    default_model: str = "claude-sonnet-4-6"
    opus_model: str = "claude-opus-4-7"

    # Feature flags por tenant (F6)
    feature_flags_path: str = "/etc/platform/feature_flags.yaml"
    feature_flags_reload_seconds: int = 60


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
