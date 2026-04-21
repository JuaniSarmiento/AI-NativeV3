"""Configuración del content-service."""
from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    service_name: str = "content-service"
    service_port: int = 8009
    environment: str = Field(default="development")
    log_level: str = "info"
    log_format: str = "json"

    cors_origins: list[str] = Field(default_factory=lambda: ["*"])
    otel_endpoint: str = "http://localhost:4317"
    sentry_dsn: str = ""

    keycloak_url: str = "http://localhost:8180"
    keycloak_realm: str = "demo_uni"

    # content-service vive en la MISMA base que academic (ADR-003:
    # academic_main incluye contenido + evaluación + analítica)
    content_db_url: str = Field(
        default="postgresql+asyncpg://academic_user:academic_pass@localhost:5432/academic_main"
    )
    db_echo: bool = False

    # Storage
    s3_endpoint: str = "http://localhost:9000"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_bucket_materials: str = "materials"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
