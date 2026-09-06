"""Fixtures for the backup/restore test suite.

DATA SAFETY
-----------
These tests NEVER touch ``investment_db`` or ``investment_test_db``. They run
against a dedicated, disposable database ``investment_backup_test_db`` that is
CREATEd at the start of the session and DROPped at the end. Tests may TRUNCATE
freely inside it.

The parent ``tests/conftest.py`` still applies (env vars, the autouse
``mock_redis`` fixture, the session-scoped ``event_loop``). We deliberately do
NOT use its ``engine`` / ``*_client`` fixtures — those bind to
``investment_test_db``.
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import AsyncIterator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

# Import every model module so Base.metadata is fully populated before
# create_all. Mirrors main.py's lifespan imports.
from app.auth.jwt import create_access_token, hash_password
from app.database.session import Base, get_db
from app.models.action_plan import ActionPlan, PortfolioPlanItem, PurchasePlanItem  # noqa: F401
from app.models.daily_performance import DailyPerformance  # noqa: F401
from app.models.dr_mapping import DrMapping  # noqa: F401
from app.models.portfolio import Holding, InvestmentTransaction, Portfolio  # noqa: F401
from app.models.portfolio_cash_transaction import PortfolioCashTransaction  # noqa: F401
from app.models.portfolio_db import PortfolioDbPosition  # noqa: F401
from app.models.symbol_note import SymbolNote  # noqa: F401
from app.models.user import User
from app.models.weekly_review import WeeklyReview, WeeklyReviewItem  # noqa: F401
from app.models.weekly_scan import (  # noqa: F401
    PeScanResult, UserScanConfig, UserSymbolList, WeeklyScan, WeeklyScanItem,
)
from main import fastapi_app

BK_DB_NAME = "investment_backup_test_db"
_PG_BASE = os.getenv(
    "BACKUP_TEST_PG_BASE", "postgresql+asyncpg://postgres:postgres@postgres:5432"
)
_ADMIN_URL = f"{_PG_BASE}/postgres"
_BK_URL = f"{_PG_BASE}/{BK_DB_NAME}"

_FT_SCHEMA_SQL = Path(__file__).resolve().parents[1] / "fixtures" / "ft_schema.sql"

# Known-good alembic markers for the disposable DB (values are arbitrary but
# fixed, so schema-version-drift assertions are deterministic).
CORE_ALEMBIC_VERSION = "d4e5f6a7b8c9"
FT_ALEMBIC_VERSION = "00f7a890545d"


def _split_sql(raw: str) -> list[str]:
    lines = [ln for ln in raw.splitlines() if not ln.strip().startswith("--")]
    body = "\n".join(lines)
    return [s.strip() for s in body.split(";") if s.strip()]


async def _run_autocommit(url: str, statements: list[str]) -> None:
    eng = create_async_engine(url, isolation_level="AUTOCOMMIT", poolclass=NullPool)
    try:
        async with eng.connect() as conn:
            for stmt in statements:
                await conn.execute(text(stmt))
    finally:
        await eng.dispose()


@pytest_asyncio.fixture(scope="session")
async def bk_engine():
    await _run_autocommit(
        _ADMIN_URL,
        [
            f"DROP DATABASE IF EXISTS {BK_DB_NAME} WITH (FORCE)",
            f"CREATE DATABASE {BK_DB_NAME}",
        ],
    )

    eng = create_async_engine(_BK_URL, poolclass=NullPool)
    async with eng.begin() as conn:
        await conn.execute(text('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"'))
        await conn.execute(text('CREATE EXTENSION IF NOT EXISTS "pg_trgm"'))
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(
            text(
                "CREATE TABLE IF NOT EXISTS alembic_version "
                "(version_num VARCHAR(32) NOT NULL, "
                "CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num))"
            )
        )
        for stmt in _split_sql(_FT_SCHEMA_SQL.read_text(encoding="utf-8")):
            await conn.execute(text(stmt))
        # Tiny throwaway table with a binary column, so backup/restore of a
        # bytea value can be exercised end-to-end (see H-1).
        await conn.execute(
            text(
                "CREATE TABLE IF NOT EXISTS bk_bytea_probe ("
                "id integer NOT NULL, payload bytea, "
                "CONSTRAINT bk_bytea_probe_pkey PRIMARY KEY (id))"
            )
        )
        await conn.execute(
            text("INSERT INTO alembic_version (version_num) VALUES (:v) ON CONFLICT DO NOTHING"),
            {"v": CORE_ALEMBIC_VERSION},
        )
        await conn.execute(
            text("INSERT INTO ft_alembic_version (version_num) VALUES (:v) ON CONFLICT DO NOTHING"),
            {"v": FT_ALEMBIC_VERSION},
        )

    yield eng

    await eng.dispose()
    await _run_autocommit(_ADMIN_URL, [f"DROP DATABASE IF EXISTS {BK_DB_NAME} WITH (FORCE)"])


@pytest_asyncio.fixture
async def bk_clean(bk_engine) -> AsyncIterator[None]:
    """Truncate every data table (keeps the two alembic marker rows)."""
    async with bk_engine.begin() as conn:
        rows = (
            await conn.execute(
                text(
                    "SELECT c.relname FROM pg_class c "
                    "JOIN pg_namespace n ON n.oid = c.relnamespace "
                    "WHERE c.relkind = 'r' AND NOT c.relispartition "
                    "AND n.nspname = 'public' "
                    "AND c.relname NOT IN ('alembic_version', 'ft_alembic_version')"
                )
            )
        ).fetchall()
        names = [r[0] for r in rows]
        if names:
            idents = ", ".join(f'"{n}"' for n in names)
            await conn.execute(text(f"TRUNCATE TABLE {idents} RESTART IDENTITY CASCADE"))
    yield


@pytest_asyncio.fixture
def bk_sessionmaker(bk_engine):
    return async_sessionmaker(bk_engine, expire_on_commit=False, autoflush=False)


@pytest_asyncio.fixture
async def bk_session(bk_sessionmaker) -> AsyncIterator:
    async with bk_sessionmaker() as s:
        yield s
        try:
            await s.rollback()
        except Exception:
            pass


@pytest_asyncio.fixture
async def bk_tokens(bk_clean, bk_sessionmaker) -> dict[str, str]:
    """Create an admin and an analyst user; return {'admin': jwt, 'analyst': jwt}."""
    wanted = {
        "admin": "bk_admin@example.com",
        "analyst": "bk_analyst@example.com",
    }
    async with bk_sessionmaker() as s:
        for role, email in wanted.items():
            exists = (
                await s.execute(select(User).where(User.email == email))
            ).scalar_one_or_none()
            if not exists:
                s.add(
                    User(
                        email=email,
                        name=email,
                        hashed_password=hash_password("StrongPass123!"),
                        role=role,
                        is_active=True,
                    )
                )
        await s.commit()
        users = (await s.execute(select(User))).scalars().all()

    tokens: dict[str, str] = {}
    for u in users:
        tok, _ = create_access_token(str(u.id), extra={"role": u.role, "email": u.email})
        tokens[u.role] = tok
    return tokens


def _override_db(bk_sessionmaker):
    async def _dep():
        async with bk_sessionmaker() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise
    return _dep


@pytest_asyncio.fixture
async def admin_bk_client(bk_clean, bk_sessionmaker) -> AsyncIterator[AsyncClient]:
    """Admin client whose auth is stubbed via ``require_admin`` override.

    Auth is decoupled from the ``users`` table so restore tests may truncate
    every data table (``users`` included) without breaking the request's own
    authentication.
    """
    from app.auth.dependencies import require_admin

    fake_admin = User(
        id=uuid.uuid4(),
        email="stub-admin@backup.test",
        name="Stub Admin",
        hashed_password="x",
        role="admin",
        is_active=True,
    )
    fastapi_app.dependency_overrides[get_db] = _override_db(bk_sessionmaker)
    fastapi_app.dependency_overrides[require_admin] = lambda: fake_admin
    async with AsyncClient(
        transport=ASGITransport(app=fastapi_app), base_url="http://test"
    ) as c:
        yield c
    fastapi_app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def analyst_bk_client(bk_sessionmaker, bk_tokens) -> AsyncIterator[AsyncClient]:
    fastapi_app.dependency_overrides[get_db] = _override_db(bk_sessionmaker)
    async with AsyncClient(
        transport=ASGITransport(app=fastapi_app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {bk_tokens['analyst']}"},
    ) as c:
        yield c
    fastapi_app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def noauth_bk_client(bk_sessionmaker, bk_clean) -> AsyncIterator[AsyncClient]:
    fastapi_app.dependency_overrides[get_db] = _override_db(bk_sessionmaker)
    async with AsyncClient(
        transport=ASGITransport(app=fastapi_app), base_url="http://test"
    ) as c:
        yield c
    fastapi_app.dependency_overrides.clear()


@pytest.fixture
def bk_backup_dir(tmp_path, monkeypatch):
    """Point the endpoint module's BACKUP_DIR at an isolated tmp dir."""
    import app.api.v1.endpoints.backup as backup_mod

    d = tmp_path / "backups"
    d.mkdir()
    monkeypatch.setattr(backup_mod, "BACKUP_DIR", d)
    return d
