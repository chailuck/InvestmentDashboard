"""
Shared pytest fixtures for the InvestmentDashboard backend test suite.

Architecture
------------
* Dedicated PostgreSQL database (investment_test_db).
* A single event loop for the entire session (avoids "Future attached to a
  different loop" when asyncpg futures are used by anyio task groups).
* NullPool on the engine — each SQLAlchemy operation gets a fresh asyncpg
  connection, removing all pool-level loop-binding issues.
* The app (via get_db override) always receives its OWN fresh session, never
  the test's db_session.  This eliminates "another operation in progress"
  because two callers never share a single asyncpg connection.
* auth_client commits user setup so the app can see it from its own session.
  get_or_create avoids duplicate-email errors across tests in one run.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from typing import AsyncIterator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
from unittest.mock import AsyncMock, patch

# ── Env vars BEFORE any app import ──────────────────────────────────────────

os.environ.setdefault("APP_SECRET_KEY", "test-secret-key-that-is-at-least-32-chars-long!")
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://postgres:postgres@localhost:5432/investment_test_db")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/1")
os.environ.setdefault("METRICS_ENABLED", "false")
os.environ.setdefault("APP_ENV", "development")

from app.auth.jwt import create_access_token, hash_password
from app.database.session import Base, get_db
from app.models.action_plan import ActionPlan, PortfolioPlanItem, PurchasePlanItem  # noqa: F401
from app.models.portfolio_db import PortfolioDbPosition  # noqa: F401
from app.models.symbol_note import SymbolNote  # noqa: F401
from app.models.user import User
from app.models.weekly_scan import (  # noqa: F401
    UserScanConfig, UserSymbolList, WeeklyScan, WeeklyScanItem,
)
from app.models.weekly_review import WeeklyReview, WeeklyReviewItem  # noqa: F401
from main import fastapi_app

# Always point at the dedicated test DB — never the production one.
# Inside the Docker network, postgres is reachable at hostname "postgres".
TEST_DATABASE_URL = "postgresql+asyncpg://postgres:postgres@postgres:5432/investment_test_db"

# ── Session-scoped event loop ────────────────────────────────────────────────

@pytest.fixture(scope="session")
def event_loop():
    """Single loop for the whole session — required for session-scoped async fixtures."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    yield loop
    loop.close()


# ── Engine (session scope) ───────────────────────────────────────────────────

@pytest_asyncio.fixture(scope="session")
async def engine():
    eng = create_async_engine(TEST_DATABASE_URL, echo=False, poolclass=NullPool)
    async with eng.begin() as conn:
        await conn.execute(
            __import__("sqlalchemy").text('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')
        )
        # Drop then recreate — guarantees a clean slate even after an aborted run
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await eng.dispose()


# ── Session factory helper ───────────────────────────────────────────────────

def _make_factory(eng):
    return async_sessionmaker(eng, expire_on_commit=False, autoflush=False)


# ── Test DB session (for setup/assertions only — NOT shared with the app) ────

@pytest_asyncio.fixture
async def db_session(engine) -> AsyncIterator[AsyncSession]:
    factory = _make_factory(engine)
    async with factory() as session:
        yield session
        try:
            await session.rollback()
        except Exception:
            pass


# ── get_db override that gives the app its OWN fresh session per request ─────

def _make_db_override(eng):
    async def _override():
        factory = _make_factory(eng)
        async with factory() as session:
            yield session
    return _override


# ── Fake Redis ───────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def mock_redis():
    fake = AsyncMock()
    fake.exists = AsyncMock(return_value=0)
    fake.set = AsyncMock(return_value=True)
    fake.get = AsyncMock(return_value=None)
    fake.ping = AsyncMock(return_value=True)
    fake.delete = AsyncMock(return_value=1)
    fake.setex = AsyncMock(return_value=True)
    with (
        patch("app.database.redis.get_redis", return_value=fake),
        patch("app.auth.dependencies.get_redis", return_value=fake),
        patch("app.api.v1.endpoints.auth.get_redis", return_value=fake),
    ):
        yield fake


# ── User helpers ─────────────────────────────────────────────────────────────

async def _create_user(
    db: AsyncSession,
    email: str = "test@example.com",
    name: str = "Test User",
    password: str = "TestPass123!",
    role: str = "analyst",
) -> User:
    """Get-or-create a user; always commits so the app's session can see the row.
    Idempotent: returning an existing user avoids duplicate-key errors when the
    same email is used across multiple tests in one session."""
    result = await db.execute(select(User).where(User.email == email))
    existing = result.scalar_one_or_none()
    if existing:
        return existing
    user = User(
        email=email,
        name=name,
        hashed_password=hash_password(password),
        role=role,
        is_active=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _get_or_create_user(
    eng,
    email: str = "test@example.com",
    name: str = "Test User",
    password: str = "TestPass123!",
    role: str = "analyst",
) -> User:
    """Insert a user if not already present; return the user either way."""
    factory = _make_factory(eng)
    async with factory() as session:
        result = await session.execute(select(User).where(User.email == email))
        existing = result.scalar_one_or_none()
        if existing:
            return existing
        user = User(
            email=email,
            name=name,
            hashed_password=hash_password(password),
            role=role,
            is_active=True,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user


# ── Unauthenticated client ───────────────────────────────────────────────────

@pytest_asyncio.fixture
async def client(engine) -> AsyncIterator[AsyncClient]:
    """HTTP client; app gets its own session per request."""
    fastapi_app.dependency_overrides[get_db] = _make_db_override(engine)
    async with AsyncClient(
        transport=ASGITransport(app=fastapi_app), base_url="http://test"
    ) as c:
        yield c
    fastapi_app.dependency_overrides.clear()


# ── Authenticated analyst client ─────────────────────────────────────────────

@pytest_asyncio.fixture
async def auth_client(engine) -> AsyncIterator[AsyncClient]:
    """Client authenticated as an analyst. User is committed so the app can see it."""
    user = await _get_or_create_user(engine)
    token, _ = create_access_token(str(user.id), extra={"role": user.role, "email": user.email})
    fastapi_app.dependency_overrides[get_db] = _make_db_override(engine)
    async with AsyncClient(
        transport=ASGITransport(app=fastapi_app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {token}"},
    ) as c:
        yield c
    fastapi_app.dependency_overrides.clear()


# ── Second authenticated client (for cross-user tests) ───────────────────────

@pytest_asyncio.fixture
async def auth_client_b(engine) -> AsyncIterator[AsyncClient]:
    """Client authenticated as a second distinct user (User B).
    Used in cross-user authorization tests to verify ownership isolation."""
    user = await _get_or_create_user(
        engine, email="user_b@example.com", name="User B",
        password="UserBPass123!", role="analyst",
    )
    token, _ = create_access_token(str(user.id), extra={"role": user.role, "email": user.email})
    fastapi_app.dependency_overrides[get_db] = _make_db_override(engine)
    async with AsyncClient(
        transport=ASGITransport(app=fastapi_app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {token}"},
    ) as c:
        yield c
    fastapi_app.dependency_overrides.clear()


# ── Authenticated admin client ───────────────────────────────────────────────

@pytest_asyncio.fixture
async def admin_client(engine) -> AsyncIterator[AsyncClient]:
    """Client authenticated as an admin."""
    user = await _get_or_create_user(
        engine, email="admin@example.com", name="Admin User",
        password="AdminPass123!", role="admin",
    )
    token, _ = create_access_token(str(user.id), extra={"role": user.role, "email": user.email})
    fastapi_app.dependency_overrides[get_db] = _make_db_override(engine)
    async with AsyncClient(
        transport=ASGITransport(app=fastapi_app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {token}"},
    ) as c:
        yield c
    fastapi_app.dependency_overrides.clear()
