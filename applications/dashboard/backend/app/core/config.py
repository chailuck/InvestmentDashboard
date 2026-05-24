"""Application configuration via Pydantic BaseSettings."""

from __future__ import annotations

import secrets
from functools import lru_cache
from typing import Literal

from pydantic import AnyHttpUrl, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # App
    app_name: str = "Investment Dashboard API"
    app_env: Literal["development", "staging", "production"] = "development"
    app_debug: bool = False
    app_secret_key: str = secrets.token_urlsafe(32)
    log_level: str = "INFO"
    api_prefix: str = "/api/v1"

    # Database
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/investment_db"
    database_pool_size: int = 20
    database_max_overflow: int = 10
    database_echo: bool = False

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # Auth
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7

    # CORS
    cors_origins: list[str] = ["http://localhost:3000"]

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors(cls, v: str | list[str]) -> list[str]:
        if isinstance(v, str):
            import json
            return json.loads(v)
        return v

    # AI
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    ai_default_model: str = "claude-sonnet-4-6"

    # File upload
    upload_dir: str = "./uploads"
    max_upload_size_mb: int = 50

    # Monitoring
    metrics_enabled: bool = True

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def is_development(self) -> bool:
        return self.app_env == "development"


@lru_cache
def get_settings() -> Settings:
    return Settings()
