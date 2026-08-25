"""Application configuration via Pydantic BaseSettings.

This service (tracking-backend / Financial Tracker API) is a fully independent
microservice — it does NOT import anything from applications/dashboard/backend.
Its config mirrors that service's `app/core/config.py` pattern for consistency,
but only carries the settings this service actually needs.

IMPORTANT: `app_secret_key` MUST be byte-for-byte identical to the main
backend's APP_SECRET_KEY. This service verifies JWTs signed by the main
backend; if the keys diverge, every request will be rejected with 401.
Both services should load the same value from a shared `.env.shared` file
(see applications/dashboard/.env.shared.example) to prevent drift.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # App
    app_name: str = "Financial Tracker API"
    app_env: Literal["development", "staging", "production"] = "development"
    # APP_SECRET_KEY is required — no default. Server will refuse to start without it.
    # MUST match the main backend's APP_SECRET_KEY byte-for-byte (see docstring above).
    # Minimum 32 characters to ensure adequate entropy for HMAC-SHA256 signing.
    app_secret_key: str = Field(min_length=32)
    log_level: str = "INFO"
    api_prefix: str = "/api/v1/tracking"

    # Database — separate connection pool from the main backend, but points at
    # the SAME Postgres instance/database (tables are prefixed `ft_` and carry
    # no foreign keys into the main app's tables — bounded-context isolation).
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/investment_db"
    database_pool_size: int = 10
    database_max_overflow: int = 5
    database_echo: bool = False

    # Redis — used only for the JWT blacklist check (shared with main backend).
    redis_url: str = "redis://localhost:6379/0"

    # Auth — verification only. This service never issues tokens.
    jwt_algorithm: str = "HS256"

    # CORS
    cors_origins: list[str] = ["http://localhost:3000"]

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def is_development(self) -> bool:
        return self.app_env == "development"


@lru_cache
def get_settings() -> Settings:
    return Settings()
