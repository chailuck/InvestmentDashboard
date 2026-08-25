"""Shared pytest fixtures for the tracking-backend (Financial Tracker) test suite.

Architecture — mirrors applications/dashboard/backend/tests/conftest.py's
proven pattern (dedicated test DB, session-scoped event loop + engine,
NullPool, get_db override giving the app its own fresh session per request,
autouse fake Redis) so the two suites behave consistently and both survive
being run against the same shared Postgres instance.

Differences from the main backend's conftest, and why:
- No `users` table exists in this bounded context, so there is nothing to
  seed/lookup for "the current user" — `user_id` is just an opaque UUID
  string extracted from the JWT `sub` claim. Test fixtures mint that UUID
  themselves and encode it into a token.
- This service's app/auth/jwt.py intentionally has NO create_access_token
  (only the main backend issues tokens). Tests therefore mint tokens with
  `jose.jwt.encode` directly, using the exact same claim shape
  (sub/exp/iat/jti/type) the main backend produces, signed with the same
  APP_SECRET_KEY these tests set below — this is the only way to exercise
  get_current_user_id() without importing the sibling codebase.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import AsyncIterator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
from unittest.mock import AsyncMock, patch

# ── Env vars BEFORE any app import ──────────────────────────────────────────
#
# Defaults below assume this suite runs inside the same Docker network as the
# `postgres`/`redis` containers (hostnames "postgres"/"redis") — matching
# applications/dashboard/backend/tests/conftest.py's convention, since that
# is this project's actual documented test-execution path (see README:
# `docker exec inv_tracking_backend python -m pytest ...` once the service's
# own container exists, or any container attached to the same
# `dashboard-net` network in the meantime).
#
# To run this suite from a bare host (outside Docker) against the compose
# stack's port-forwarded services instead, override both explicitly, e.g.:
#   DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/investment_test_db
#   REDIS_URL=redis://localhost:6379/1
# (this is how these tests were actually verified to pass during development,
# from a Windows host venv against the compose stack's mapped 5432/6379 ports).

TEST_SECRET_KEY = "test-secret-key-that-is-at-least-32-chars-long!"

os.environ.setdefault("APP_SECRET_KEY", TEST_SECRET_KEY)
os.environ.setdefault(
    "DATABASE_URL", "postgresql+asyncpg://postgres:postgres@postgres:5432/investment_test_db"
)
os.environ.setdefault("REDIS_URL", "redis://redis:6379/1")
os.environ.setdefault("APP_ENV", "development")

from jose import jwt as jose_jwt  # noqa: E402

from app.database.session import Base, get_db  # noqa: E402
from app.models.category import Category  # noqa: F401,E402
from app.models.initial_investment_entry import InitialInvestmentEntry  # noqa: F401,E402
from app.models.sub_category import SubCategory  # noqa: F401,E402
from app.models.tracking_item import TrackingItem  # noqa: F401,E402
from app.models.tracking_set import TrackingSet  # noqa: F401,E402
from main import fastapi_app  # noqa: E402

# Single source of truth for the test engine — always the same value Settings()
# resolved DATABASE_URL to above, so the app's DB and the test-setup/assertion
# DB are never accidentally pointed at different databases.
TEST_DATABASE_URL = os.environ["DATABASE_URL"]


# ── Session-scoped event loop ────────────────────────────────────────────────

@pytest.fixture(scope="session")
def event_loop():
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
        # Drop then recreate — guarantees a clean slate even after an aborted run.
        # Only ft_* tables live in Base.metadata for this service, so this never
        # touches any table owned by the main backend even though they share
        # the same physical database.
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await eng.dispose()


def _make_factory(eng):
    return async_sessionmaker(eng, expire_on_commit=False, autoflush=False)


@pytest_asyncio.fixture
async def db_session(engine) -> AsyncIterator[AsyncSession]:
    factory = _make_factory(engine)
    async with factory() as session:
        yield session
        try:
            await session.rollback()
        except Exception:
            pass


def _make_db_override(eng):
    async def _override():
        factory = _make_factory(eng)
        async with factory() as session:
            yield session
    return _override


# ── Fake Redis ───────────────────────────────────────────────────────────────

@pytest.fixture
def fake_redis():
    fake = AsyncMock()
    fake.exists = AsyncMock(return_value=0)
    fake.ping = AsyncMock(return_value=True)
    fake.delete = AsyncMock(return_value=1)
    return fake


@pytest.fixture(autouse=True)
def mock_redis(fake_redis):
    with (
        patch("app.database.redis.get_redis", return_value=fake_redis),
        patch("app.auth.dependencies.get_redis", return_value=fake_redis),
    ):
        yield fake_redis


# ── Token minting (this service never issues tokens itself — see docstring) ─

def make_token(
    user_id: str,
    *,
    jti: str | None = None,
    expired: bool = False,
    token_type: str = "access",
    secret: str = TEST_SECRET_KEY,
) -> tuple[str, str]:
    """Mint a JWT with the exact claim shape the main backend produces.
    Returns (token, jti) so tests can blacklist a specific jti afterward."""
    jti = jti or str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    exp = now - timedelta(minutes=5) if expired else now + timedelta(minutes=30)
    payload = {
        "sub": user_id,
        "exp": exp,
        "iat": now,
        "jti": jti,
        "type": token_type,
    }
    token = jose_jwt.encode(payload, secret, algorithm="HS256")
    return token, jti


# ── Unauthenticated client ───────────────────────────────────────────────────

@pytest_asyncio.fixture
async def client(engine) -> AsyncIterator[AsyncClient]:
    fastapi_app.dependency_overrides[get_db] = _make_db_override(engine)
    async with AsyncClient(
        transport=ASGITransport(app=fastapi_app), base_url="http://test"
    ) as c:
        yield c
    fastapi_app.dependency_overrides.clear()


# ── Authenticated client (User A) ────────────────────────────────────────────

@pytest.fixture
def user_a_id() -> str:
    return str(uuid.uuid4())


@pytest.fixture
def user_b_id() -> str:
    return str(uuid.uuid4())


@pytest_asyncio.fixture
async def auth_client(engine, user_a_id) -> AsyncIterator[AsyncClient]:
    token, _ = make_token(user_a_id)
    fastapi_app.dependency_overrides[get_db] = _make_db_override(engine)
    async with AsyncClient(
        transport=ASGITransport(app=fastapi_app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {token}"},
    ) as c:
        yield c
    fastapi_app.dependency_overrides.clear()


# ── Second authenticated client (User B) — cross-user ownership tests ───────

@pytest_asyncio.fixture
async def auth_client_b(engine, user_b_id) -> AsyncIterator[AsyncClient]:
    token, _ = make_token(user_b_id)
    fastapi_app.dependency_overrides[get_db] = _make_db_override(engine)
    async with AsyncClient(
        transport=ASGITransport(app=fastapi_app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {token}"},
    ) as c:
        yield c
    fastapi_app.dependency_overrides.clear()
