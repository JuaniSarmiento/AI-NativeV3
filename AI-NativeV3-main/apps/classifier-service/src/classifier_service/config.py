"""Config del classifier-service."""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    service_name: str = "classifier-service"
    service_port: int = 8008
    environment: str = "development"
    log_level: str = "info"
    log_format: str = "json"

    cors_origins: list[str] = Field(default_factory=lambda: ["*"])
    otel_endpoint: str = "http://127.0.0.1:4317"
    sentry_dsn: str = ""

    # Base dedicada: classifier_db (ADR-003). La tabla `classifications` vive acá,
    # no en ctr_store. El fallback default asume dev local con los users que crea
    # scripts/setup-dev-permissions.sh.
    classifier_db_url: str = Field(
        default="postgresql+asyncpg://classifier_user:classifier_pass@127.0.0.1:5432/classifier_db"
    )
    db_echo: bool = False

    redis_url: str = "redis://127.0.0.1:6379/3"

    # URLs de servicios dependientes
    ctr_service_url: str = "http://127.0.0.1:8007"

    # ADR-023 / ADR-045 (Mejora 3 plan post-piloto-1, sub-componente G8b):
    # override lexico de `anotacion_creada` sobre contenido textual con
    # precedencia sobre el override temporal v1.1.0. OFF por default.
    # Mientras este False, `event_labeler.label_event()` produce exactamente
    # las mismas etiquetas que la heuristica temporal v1.1.0 (preserva
    # reproducibilidad bit-a-bit del classifier_config_hash sobre todas las
    # classifications historicas del piloto-1). Activacion bloqueada hasta
    # validacion intercoder kappa >= 0.6 sobre 50+ anotaciones etiquetadas
    # por 2 docentes independientes (mismo gate humano que ADR-027 / ADR-044).
    # El esqueleto tecnico vive en
    # `classifier_service.services.event_labeler_lexical`.
    # Cuando se prenda el flag, bumpear LABELER_VERSION a "2.0.0" (cambio
    # semantico mayor: contenido textual con precedencia sobre temporal).
    lexical_anotacion_override_enabled: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
