"""Health check endpoints."""


import time

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import text

from app.database.session import engine
from app.database.redis import get_redis

router = APIRouter(prefix="/health", tags=["Health"])

START_TIME = time.time()


class HealthStatus(BaseModel):
    status: str
    uptime_seconds: float
    version: str
    checks: dict[str, str]


@router.get("", response_model=HealthStatus)
async def health_check() -> HealthStatus:
    checks: dict[str, str] = {}

    # DB ping
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:
        checks["database"] = f"error: {exc}"

    # Redis ping
    try:
        r = await get_redis()
        await r.ping()
        checks["redis"] = "ok"
    except Exception as exc:
        checks["redis"] = f"error: {exc}"

    overall = "healthy" if all(v == "ok" for v in checks.values()) else "degraded"
    return HealthStatus(
        status=overall,
        uptime_seconds=round(time.time() - START_TIME, 1),
        version="1.0.0",
        checks=checks,
    )


@router.get("/ready")
async def readiness() -> dict[str, str]:
    return {"status": "ready"}


@router.get("/live")
async def liveness() -> dict[str, str]:
    return {"status": "alive"}
