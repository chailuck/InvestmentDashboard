"""FastAPI application entry point."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

import socketio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from prometheus_fastapi_instrumentator import Instrumentator
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.api.v1.router import v1_router
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.core.rate_limit import limiter
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
    from app.models.portfolio_db import PortfolioDbPosition  # noqa: F401
    from app.models.portfolio import Portfolio, Holding, InvestmentTransaction  # noqa: F401
    from app.models.weekly_scan import UserScanConfig, WeeklyScan, WeeklyScanItem, UserSymbolList, PeScanResult  # noqa: F401
    from app.models.dr_mapping import DrMapping  # noqa: F401
    from app.auth.jwt import hash_password

    async with engine.begin() as conn:
        await conn.execute(text('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"'))
        await conn.execute(text('CREATE EXTENSION IF NOT EXISTS "pg_trgm"'))
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(text("ALTER TABLE weekly_scan_items ADD COLUMN IF NOT EXISTS list_name VARCHAR(100)"))
        await conn.execute(text("ALTER TABLE weekly_scan_items ADD COLUMN IF NOT EXISTS market VARCHAR(20) NOT NULL DEFAULT 'SET'"))
        await conn.execute(text("ALTER TABLE user_symbol_lists ADD COLUMN IF NOT EXISTS market VARCHAR(20) NOT NULL DEFAULT 'SET'"))
        await conn.execute(text("ALTER TABLE user_symbol_lists ADD COLUMN IF NOT EXISTS is_dr BOOLEAN NOT NULL DEFAULT false"))
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS excel_source_path VARCHAR(1024)"))
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS excel_working_path VARCHAR(1024)"))
        # Portfolio columns added to existing portfolios table
        await conn.execute(text("ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false"))
        await conn.execute(text("ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS portfolio_mode VARCHAR(10) NOT NULL DEFAULT 'excel'"))
        await conn.execute(text("ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS excel_source_path VARCHAR(1024)"))
        await conn.execute(text("ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS excel_working_path VARCHAR(1024)"))
        await conn.execute(text("ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0"))
        # Add unique constraint on (user_id, name) if not exists
        await conn.execute(text("""
            DO $$ BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint WHERE conname = 'uq_portfolio_user_name'
                ) THEN
                    ALTER TABLE portfolios ADD CONSTRAINT uq_portfolio_user_name UNIQUE (user_id, name);
                END IF;
            END $$
        """))
        # Add portfolio_id to positions table
        await conn.execute(text("ALTER TABLE portfolio_positions_db ADD COLUMN IF NOT EXISTS portfolio_id UUID REFERENCES portfolios(id) ON DELETE SET NULL"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_portfolio_positions_db_portfolio_id ON portfolio_positions_db (portfolio_id)"))

    # Seed default portfolios for existing users (idempotent)
    async with engine.begin() as conn:
        # Ensure every user has at least one portfolio — use ON CONFLICT DO NOTHING
        await conn.execute(text("""
            INSERT INTO portfolios (id, user_id, name, currency, benchmark_symbol, cash, is_default, portfolio_mode, excel_source_path, excel_working_path, sort_order)
            SELECT
                uuid_generate_v4(),
                u.id,
                'Default',
                'USD',
                'SPY',
                0.0,
                true,
                COALESCE(u.portfolio_mode, 'excel'),
                u.excel_source_path,
                u.excel_working_path,
                0
            FROM users u
            WHERE NOT EXISTS (
                SELECT 1 FROM portfolios p WHERE p.user_id = u.id
            )
            ON CONFLICT (user_id, name) DO NOTHING
        """))
        # Ensure exactly one portfolio is default per user (in case is_default was never set)
        await conn.execute(text("""
            UPDATE portfolios p
            SET is_default = true
            WHERE p.id = (
                SELECT p2.id FROM portfolios p2
                WHERE p2.user_id = p.user_id
                ORDER BY p2.created_at ASC
                LIMIT 1
            )
            AND NOT EXISTS (
                SELECT 1 FROM portfolios p3 WHERE p3.user_id = p.user_id AND p3.is_default = true
            )
        """))
        # Assign default portfolio to positions without portfolio_id
        await conn.execute(text("""
            UPDATE portfolio_positions_db pos
            SET portfolio_id = (
                SELECT p.id FROM portfolios p
                WHERE p.user_id = pos.user_id AND p.is_default = true
                LIMIT 1
            )
            WHERE pos.portfolio_id IS NULL
        """))

    # Seed first admin from env vars (skipped if ADMIN_EMAIL not set)
    if settings.admin_email and settings.admin_password:
        async with engine.begin() as conn:
            await conn.execute(
                text("""
                    INSERT INTO users (id, email, name, hashed_password, role, is_active, portfolio_mode)
                    VALUES (uuid_generate_v4(), :email, :name, :pwd, 'admin', true, 'excel')
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

    # Rate limiter — attach to app state before middleware is registered
    app.state.limiter = limiter

    # Middleware (order matters — outermost runs last on response)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestIdMiddleware)
    app.add_middleware(SlowAPIMiddleware)
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

    # Rate limit exceeded handler
    @app.exception_handler(RateLimitExceeded)
    async def rate_limit_handler(request, exc: RateLimitExceeded):  # type: ignore[override]
        retry_after = str(getattr(exc, "retry_after", 60))
        return JSONResponse(
            status_code=429,
            content={"detail": "Rate limit exceeded. Please try again later."},
            headers={"Retry-After": retry_after},
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
