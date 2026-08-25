"""Async SQLAlchemy engine and session factory.

Mirrors applications/dashboard/backend/app/database/session.py. This service
has its own `Base` / metadata — it does NOT share Base with the main backend
(fully independent codebase, per the approved design). It connects to the
same physical Postgres database as the main backend, but only ever touches
its own `ft_*` tables.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import get_settings

settings = get_settings()

engine = create_async_engine(
    settings.database_url,
    pool_size=settings.database_pool_size,
    max_overflow=settings.database_max_overflow,
    pool_pre_ping=True,
    echo=settings.database_echo,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


class Base(DeclarativeBase):
    pass


@asynccontextmanager
async def get_db_session() -> AsyncIterator[AsyncSession]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def get_db() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency.

    NOTE: endpoints that need multi-statement transactional guarantees (e.g.
    the tracking-set creation cascade in app/services/cascade.py) manage their
    own commit explicitly and rely on the fact that a single AsyncSession is
    one transaction until commit/rollback — they must NOT call db.commit()
    partway through, and this outer wrapper's commit-on-success / rollback-on-
    exception behavior gives them atomicity for free.
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
