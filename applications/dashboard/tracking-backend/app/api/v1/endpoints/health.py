"""Health check endpoints — no auth required.

/health/live never touches the DB (pure liveness probe — must return fast
and cheap even if the DB/Redis are down, otherwise Kubernetes could kill a
perfectly healthy process during a transient dependency blip).
/health/ready checks both dependencies and is used for readiness gating.
"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.database.redis import get_redis
from app.database.session import engine

router = APIRouter(prefix="/health", tags=["Health"])


@router.get("/live")
async def liveness() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/ready")
async def readiness() -> JSONResponse:
    checks: dict[str, str] = {}

    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:  # noqa: BLE001 — surfaced in the readiness payload, not swallowed
        checks["database"] = f"error: {exc}"

    try:
        r = await get_redis()
        await r.ping()
        checks["redis"] = "ok"
    except Exception as exc:  # noqa: BLE001
        checks["redis"] = f"error: {exc}"

    healthy = all(v == "ok" for v in checks.values())
    return JSONResponse(
        status_code=200 if healthy else 503,
        content={"status": "ok" if healthy else "unavailable", "checks": checks},
    )
