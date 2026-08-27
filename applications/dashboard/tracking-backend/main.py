"""FastAPI application entry point for tracking-backend (Financial Tracker API).

Fully independent from applications/dashboard/backend/main.py — no shared
imports, no socket.io wrapper (this service exposes plain REST only).

Schema management: this service owns its schema via its own Alembic chain
(see alembic.ini / alembic/env.py, `version_table = ft_alembic_version`).
Unlike the main backend, this service does NOT run `create_all`/ad-hoc
`ALTER TABLE` at startup — migrations must be applied out-of-band
(`alembic upgrade head`) before the service starts. See README for the
deployment sequence.
"""

from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from typing import AsyncIterator

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.api.v1.router import v1_router
from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.database.redis import close_redis, get_redis
from app.database.session import engine

settings = get_settings()
configure_logging(log_level=settings.log_level, json_output=settings.is_production)

_log = get_logger("startup")


# ── Request context middleware ───────────────────────────────────────────────
# Binds request_id/correlation_id into structlog's contextvars for the
# duration of the request, so every log line emitted while handling it
# carries both — satisfying the org's structured-logging standard without
# needing a shared dependency on the main backend's middleware package.
class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
        correlation_id = request.headers.get("X-Correlation-ID", request_id)
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(
            request_id=request_id, correlation_id=correlation_id
        )
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Correlation-ID"] = correlation_id
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Content-Security-Policy"] = (
            "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
        )
        return response


# ── Lifespan ──────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    await get_redis()
    _log.info("Financial Tracker API starting", env=settings.app_env)
    yield
    await engine.dispose()
    await close_redis()
    _log.info("Financial Tracker API shutdown complete")


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        version="1.0.0",
        description="Financial Tracker API — Tracking Set / Category / Sub-category / "
        "Tracking Item / Initial Investment Entry CRUD (Phase 1), plus Update Tracking "
        "Lists with read-time delta computation (Phase 2).",
        docs_url="/api/docs" if not settings.is_production else None,
        redoc_url="/api/redoc" if not settings.is_production else None,
        openapi_url="/api/openapi.json" if not settings.is_production else None,
        lifespan=lifespan,
    )

    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestContextMiddleware)

    wildcard = settings.cors_origins == ["*"]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=r".*" if wildcard else None,
        allow_credentials=not wildcard,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(v1_router, prefix=settings.api_prefix)

    return app


fastapi_app = create_app()
app = fastapi_app


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8001,
        reload=settings.is_development,
        log_level=settings.log_level.lower(),
    )
