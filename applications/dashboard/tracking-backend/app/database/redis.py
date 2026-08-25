"""Redis connection pool.

Mirrors applications/dashboard/backend/app/database/redis.py. This service
only ever reads the shared JWT blacklist (`blacklist:{jti}` keys written by
the main backend on logout) — it never writes to Redis.
"""

from __future__ import annotations

import redis.asyncio as aioredis

from app.core.config import get_settings

settings = get_settings()

_pool: aioredis.Redis | None = None


async def get_redis() -> aioredis.Redis:
    global _pool
    if _pool is None:
        _pool = aioredis.from_url(
            settings.redis_url,
            encoding="utf-8",
            decode_responses=True,
            max_connections=20,
        )
    return _pool


async def close_redis() -> None:
    global _pool
    if _pool:
        await _pool.aclose()
        _pool = None
