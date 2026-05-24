"""Portfolio tracker endpoints — Excel-based positions + yfinance live prices."""

from __future__ import annotations

from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.auth.dependencies import get_current_user_id

router = APIRouter(prefix="/portfolio-tracker", tags=["Portfolio Tracker"])

UserId = Annotated[str, Depends(get_current_user_id)]


def _svc_error(exc: Exception) -> HTTPException:
    if isinstance(exc, FileNotFoundError):
        return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    return HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))


# ── Refresh (copy + reload) ───────────────────────────────────────────────────

@router.post("/refresh")
async def refresh_portfolio(_: UserId) -> dict[str, str]:
    """
    Copy Investment tracking.xlsx from the configured source path to the
    local working copy, then return success.  The next read will pick up
    the fresh data automatically.
    """
    from app.services.portfolio_excel import copy_excel_from_source
    try:
        path = copy_excel_from_source()
        return {"status": "ok", "message": f"Excel refreshed from source → {path}"}
    except Exception as exc:
        raise _svc_error(exc)


# ── Positions ─────────────────────────────────────────────────────────────────

@router.get("/positions")
async def list_positions(
    _: UserId,
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
    status: str = Query("active", description="active | closed | all"),
) -> dict[str, Any]:
    from app.services.portfolio_excel import get_positions
    try:
        positions = get_positions(from_date=from_date, to_date=to_date, status=status)
    except Exception as exc:
        raise _svc_error(exc)
    total_pnl = sum(p["netPnl"] for p in positions)
    return {"positions": positions, "total": len(positions), "totalNetPnl": round(total_pnl, 0)}


# ── Performance chart data ────────────────────────────────────────────────────

@router.get("/performance")
async def get_performance(
    _: UserId,
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
    period: str = Query("daily", description="daily | weekly | monthly"),
) -> list[dict[str, Any]]:
    from app.services.portfolio_excel import get_daily_performance
    try:
        return get_daily_performance(from_date=from_date, to_date=to_date, period=period)
    except Exception as exc:
        raise _svc_error(exc)


# ── Performance by date (table) ───────────────────────────────────────────────

@router.get("/performance/by-date")
async def get_performance_by_date(
    _: UserId,
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
    period: str = Query("daily", description="daily | weekly | monthly"),
) -> list[dict[str, Any]]:
    from app.services.portfolio_excel import get_performance_by_date
    try:
        return get_performance_by_date(from_date=from_date, to_date=to_date, period=period)
    except Exception as exc:
        raise _svc_error(exc)


# ── Performance by stock ──────────────────────────────────────────────────────

@router.get("/performance/by-stock")
async def get_performance_by_stock(
    _: UserId,
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
) -> list[dict[str, Any]]:
    from app.services.portfolio_excel import get_performance_by_stock
    try:
        return get_performance_by_stock(from_date=from_date, to_date=to_date)
    except Exception as exc:
        raise _svc_error(exc)


# ── SET index prices ──────────────────────────────────────────────────────────

@router.get("/market/set-indices")
async def get_set_indices(_: UserId) -> list[dict[str, Any]]:
    from app.services.portfolio_excel import fetch_set_indices
    try:
        return fetch_set_indices()
    except Exception as exc:
        raise _svc_error(exc)


# ── Global index prices (S&P500, NASDAQ, DOW, BTC, Gold) ──────────────────────

@router.get("/market/global-indices")
async def get_global_indices(_: UserId) -> list[dict[str, Any]]:
    from app.services.portfolio_excel import fetch_global_indices
    try:
        return fetch_global_indices()
    except Exception as exc:
        raise _svc_error(exc)
