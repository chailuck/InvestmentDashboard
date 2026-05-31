"""FastAPI application entry point."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

import socketio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator

from app.api.v1.router import v1_router
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.database.redis import close_redis, get_redis
from app.database.session import engine
from app.middleware.security import RequestIdMiddleware, SecurityHeadersMiddleware
from app.websocket.manager import sio

settings = get_settings()
configure_logging(log_level=settings.log_level, json_output=settings.is_production)


# ── Lifespan ────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Startup
    await get_redis()

    from app.core.logging import get_logger
    log = get_logger("startup")
    log.info("Investment Dashboard API starting", env=settings.app_env)

    # Create tables and seed demo user on first run
    from sqlalchemy import text
    from app.database.session import Base
    from app.models.user import User  # noqa: F401 — registers model with Base
    from app.models.action_plan import ActionPlan, PurchasePlanItem, PortfolioPlanItem  # noqa: F401
    from app.models.symbol_note import SymbolNote  # noqa: F401
    from app.auth.jwt import hash_password

    async with engine.begin() as conn:
        await conn.execute(text('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"'))
        await conn.execute(text('CREATE EXTENSION IF NOT EXISTS "pg_trgm"'))
        await conn.run_sync(Base.metadata.create_all)

    # Seed first admin from env vars (skipped if ADMIN_EMAIL not set)
    if settings.admin_email and settings.admin_password:
        async with engine.begin() as conn:
            await conn.execute(
                text("""
                    INSERT INTO users (id, email, name, hashed_password, role, is_active)
                    VALUES (uuid_generate_v4(), :email, :name, :pwd, 'admin', true)
                    ON CONFLICT (email) DO NOTHING
                """),
                {"email": settings.admin_email,
                 "name": settings.admin_name,
                 "pwd": hash_password(settings.admin_password)},
            )
            log.info("Admin seed applied", email=settings.admin_email)

    yield

    # Shutdown
    await engine.dispose()
    await close_redis()
    log.info("Investment Dashboard API shutdown complete")


# ── FastAPI app ─────────────────────────────────────────────
def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        version="1.0.0",
        description="Enterprise AI Investment Dashboard API",
        docs_url="/api/docs" if not settings.is_production else None,
        redoc_url="/api/redoc" if not settings.is_production else None,
        openapi_url="/api/openapi.json" if not settings.is_production else None,
        lifespan=lifespan,
    )

    # Middleware (order matters — outermost runs last on response)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestIdMiddleware)
    # When origins = ["*"] we must disable allow_credentials (browser requirement).
    # The app now uses the Next.js proxy so the browser never calls the backend
    # directly — CORS is only needed for direct local curl/dev access.
    wildcard = settings.cors_origins == ["*"]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=r".*" if wildcard else None,
        allow_credentials=not wildcard,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Routes
    app.include_router(v1_router)

    # Prometheus metrics
    if settings.metrics_enabled:
        Instrumentator(
            should_group_status_codes=True,
            should_ignore_untemplated=True,
            excluded_handlers=[r"/api/v1/health.*"],
        ).instrument(app).expose(app, endpoint="/metrics")

    return app


fastapi_app = create_app()

# Mount Socket.IO alongside FastAPI
socket_app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app)

# `app` is what uvicorn serves
app = socket_app


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.is_development,
        log_level=settings.log_level.lower(),
    )
