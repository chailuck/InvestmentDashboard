"""FastAPI auth dependencies — token verification, plus a thin admin gate.

This service is a bounded context with NO foreign key to (and no query
access against) the main backend's `users` table. It only ever knows the
caller's user_id (the JWT `sub` claim) as an opaque string, and enforces
per-row ownership via `user_id` columns on its own `ft_*` tables.

`require_admin` (ADR-027, OQ-3) does NOT break that isolation: it reads the
signed `role` claim the main backend already puts in every access token —
no `users` lookup, no FK. It is used only by the item-type-config write
endpoints; every pre-existing endpoint keeps using `get_current_user_id`
unchanged.

Behavior of the shared verification path (must match the main backend's
get_current_user_id exactly, since both services must reject/accept the same
tokens identically):
  1. Missing Authorization header -> 401
  2. Invalid signature / expired / wrong token type -> 401
  3. Token missing `jti` claim -> 401
  4. Redis unreachable while checking the blacklist -> 503 (fail CLOSED)
  5. Token jti present in blacklist:{jti} -> 401
  6. Otherwise -> the decoded payload
`get_current_user_id` returns payload["sub"]; `require_admin` additionally
requires payload["role"] == "admin" (else 403) and then returns the sub.
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


async def _verified_payload(
    credentials: HTTPAuthorizationCredentials | None,
) -> dict:
    """Steps 1-5 of the module docstring — the shared verify + jti +
    Redis-blacklist path. Returns the decoded JWT payload on success."""
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

    return payload


async def get_current_user_id(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> str:
    payload = await _verified_payload(credentials)
    return str(payload["sub"])


async def require_admin(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> str:
    """Admin gate for the item-type-config write endpoints (ADR-027, OQ-3).

    Same verify + jti + blacklist path as `get_current_user_id`, then a role
    check against the signed `role` claim — NO `users`-table access. Returns
    the caller's `sub` (used as the actor id in admin-mutation audit logs).
    """
    payload = await _verified_payload(credentials)
    if payload.get("role") != "admin":
        _log.warning("Rejected non-admin call to an admin endpoint", sub=str(payload.get("sub")))
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin role required",
        )
    return str(payload["sub"])
