"""Config del ai-gateway."""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    service_name: str = "ai-gateway"
    service_port: int = 8011
    environment: str = "development"
    log_level: str = "info"
    log_format: str = "json"

    cors_origins: list[str] = Field(default_factory=lambda: ["*"])
    otel_endpoint: str = "http://127.0.0.1:4317"
    sentry_dsn: str = ""

    redis_url: str = "redis://127.0.0.1:6379/1"  # DB 1 separada del CTR

    # Budgets default por tenant/feature/mes (USD)
    default_monthly_budget_usd: float = 100.0

    # Secrets (no commitear al repo; setear por env var o secret manager)
    anthropic_api_key: str = ""
    openai_api_key: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
