"""Configuración del servicio academic-service."""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Service
    service_name: str = "academic-service"
    service_port: int = 8002
    environment: str = Field(default="development")
    log_level: str = Field(default="info")
    log_format: str = Field(default="json")

    # CORS
    cors_origins: list[str] = Field(default_factory=lambda: ["*"])

    # Observability
    otel_endpoint: str = Field(default="http://127.0.0.1:4317")
    sentry_dsn: str = Field(default="")

    # Keycloak
    keycloak_url: str = Field(default="http://127.0.0.1:8180")
    keycloak_realm: str = Field(default="demo_uni")

    # Database
    academic_db_url: str = Field(
        default="postgresql+asyncpg://academic_user:academic_pass@127.0.0.1:5432/academic_main"
    )
    db_echo: bool = Field(default=False)

    # External services (Sec 11 epic ai-native-completion: TP-gen IA)
    governance_service_url: str = Field(default="http://127.0.0.1:8010")
    ai_gateway_url: str = Field(default="http://127.0.0.1:8011")
    content_service_url: str = Field(default="http://127.0.0.1:8009")
    tp_generator_prompt_version: str = Field(default="v1.0.0")
    tp_generator_default_model: str = Field(default="mistral-small-latest")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
