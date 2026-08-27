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
# stack's port-forwarded services instead, override REDIS_URL, e.g.:
#   REDIS_URL=redis://localhost:6379/1
# (this is how these tests were actually verified to pass during development,
# from a Windows host venv against the compose stack's mapped 5432/6379 ports).
#
# SAFETY — read before touching TEST_DATABASE_URL below:
# This suite's `engine` fixture runs Base.metadata.drop_all()/create_all()
# every session. An earlier version of this file derived the engine URL from
# `os.environ["DATABASE_URL"]` (set here via `os.environ.setdefault`, a no-op
# whenever the variable is already present). Inside the running
# `inv_tracking_backend` container, DATABASE_URL is ALREADY set by
# docker-compose to the real dev database — so `setdefault` silently did
# nothing, `os.environ["DATABASE_URL"]` resolved to the live `investment_db`,
# and running `docker exec inv_tracking_backend python -m pytest` (the
# suite's own documented invocation) dropped every ft_* table in the live
# dev database, permanently destroying real data. This actually happened.
#
# The fix: TEST_DATABASE_URL below is a HARDCODED literal, exactly mirroring
# applications/dashboard/backend/tests/conftest.py's already-safe pattern
# (see that file's TEST_DATABASE_URL) — it can NEVER resolve to whatever
# DATABASE_URL happens to be set in the ambient environment, no matter how or
# where this suite is invoked. Do not change this back to read from
# os.environ. The assert_test_database() guard directly below is a second,
# independent safety net in case this constant is ever edited carelessly.

TEST_SECRET_KEY = "test-secret-key-that-is-at-least-32-chars-long!"
TEST_DATABASE_URL = "postgresql+asyncpg://postgres:postgres@postgres:5432/investment_test_db"

# APP_SECRET_KEY is force-set (NOT setdefault) for the same reason as
# TEST_DATABASE_URL above: inside the running inv_tracking_backend container,
# APP_SECRET_KEY is ALREADY set (to the real shared secret from
# .env.shared), so `setdefault` would silently no-op and this suite's
# make_token() helper would sign JWTs with TEST_SECRET_KEY while the app
# verifies them against the real secret — every authenticated test then
# fails with 401 "Signature verification failed". Forcing it here guarantees
# the signer and verifier always agree, regardless of the ambient
# environment this suite happens to run in.
os.environ["APP_SECRET_KEY"] = TEST_SECRET_KEY
os.environ.setdefault("REDIS_URL", "redis://redis:6379/1")
os.environ.setdefault("APP_ENV", "development")


def _assert_test_database(url: str) -> None:
    """Hard-fail rather than silently run destructive fixtures against a
    non-test database. Defense-in-depth alongside the hardcoded
    TEST_DATABASE_URL above — see the SAFETY note above this function."""
    if "test" not in url.rsplit("/", 1)[-1].lower():
        raise RuntimeError(
            f"Refusing to run tracking-backend tests against {url!r} — the "
            "database name doesn't contain 'test'. This suite drops and "
            "recreates every ft_* table every run; pointing it at a non-test "
            "database will destroy real data. Fix TEST_DATABASE_URL in "
            "tests/conftest.py instead of routing around this check."
        )


_assert_test_database(TEST_DATABASE_URL)

from jose import jwt as jose_jwt  # noqa: E402

from app.database.session import Base, get_db  # noqa: E402
from app.models.category import Category  # noqa: F401,E402
from app.models.initial_investment_entry import InitialInvestmentEntry  # noqa: F401,E402
from app.models.sub_category import SubCategory  # noqa: F401,E402
from app.models.tracking_item import TrackingItem  # noqa: F401,E402
from app.models.tracking_set import TrackingSet  # noqa: F401,E402
from app.models.update_tracking_list import UpdateTrackingList  # noqa: F401,E402
from app.models.update_tracking_list_balance import UpdateTrackingListBalance  # noqa: F401,E402
from main import fastapi_app  # noqa: E402

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
