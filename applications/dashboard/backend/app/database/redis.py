"""Redis connection pool and helpers."""

from __future__ import annotations

import json
from typing import Any

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


class CacheClient:
    def __init__(self, prefix: str = "", default_ttl: int = 300) -> None:
        self._prefix = prefix
        self._default_ttl = default_ttl

    def _key(self, key: str) -> str:
        return f"{self._prefix}:{key}" if self._prefix else key

    async def get(self, key: str) -> Any | None:
        r = await get_redis()
        val = await r.get(self._key(key))
        return json.loads(val) if val else None

    async def set(self, key: str, value: Any, ttl: int | None = None) -> None:
        r = await get_redis()
        await r.setex(self._key(key), ttl or self._default_ttl, json.dumps(value, default=str))

    async def delete(self, key: str) -> None:
        r = await get_redis()
        await r.delete(self._key(key))

    async def exists(self, key: str) -> bool:
        r = await get_redis()
        return bool(await r.exists(self._key(key)))


portfolio_cache = CacheClient(prefix="portfolio", default_ttl=30)
metrics_cache = CacheClient(prefix="metrics", default_ttl=300)
auth_cache = CacheClient(prefix="auth", default_ttl=3600)
