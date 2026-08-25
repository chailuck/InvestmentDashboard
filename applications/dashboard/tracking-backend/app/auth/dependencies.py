"""FastAPI auth dependency — verification only, no RBAC.

This service is a bounded context with NO foreign key to (and no query
access against) the main backend's `users` table. It therefore cannot and
must not implement `get_current_user` / `require_admin` / any role-check —
it only ever knows the caller's user_id (the JWT `sub` claim) as an opaque
string, and enforces per-row ownership via `user_id` columns on its own
`ft_*` tables.

Behavior (must match the main backend's get_current_user_id exactly, since
both services must reject/accept the same tokens identically):
  1. Missing Authorization header -> 401
  2. Invalid signature / expired / wrong token type -> 401
  3. Token missing `jti` claim -> 401
  4. Redis unreachable while checking the blacklist -> 503 (fail CLOSED)
  5. Token jti present in blacklist:{jti} -> 401
  6. Otherwise -> return payload["sub"] as the user id string
"""

from __future__ import annotations

import redis.asyncio as aioredis
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.auth.jwt import verify_token
from app.core.logging import get_logger
from app.database.redis import get_redis

bearer_scheme = HTTPBearer(auto_error=False)
_log = get_logger("auth.dependencies")

# Redis key prefix for blacklisted JTIs — must match the prefix used by the
# main backend's logout endpoint (they share the same Redis instance/db).
BLACKLIST_KEY_PREFIX = "blacklist:"


async def get_current_user_id(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> str:
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication credentials",
        )
    try:
        payload = verify_token(credentials.credentials)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
        ) from exc

    jti = payload.get("jti")
    if not jti:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing jti claim",
        )

    # Check Redis blacklist — fail closed if Redis is unavailable
    try:
        r = await get_redis()
        is_blacklisted = await r.exists(f"{BLACKLIST_KEY_PREFIX}{jti}")
    except aioredis.RedisError as exc:
        _log.error("Redis unavailable during auth blacklist check", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service temporarily unavailable",
        ) from exc

    if is_blacklisted:
        _log.warning("Rejected blacklisted token", jti=jti)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has been revoked",
        )

    return str(payload["sub"])
