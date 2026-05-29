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
async def refresh_portfolio(_: UserId) -> dict[str, Any]:
    """
    Copy Investment tracking.xlsx from the configured source path to the
    local working copy, then return detailed status for the UI progress modal.
    """
    from pathlib import Path
    from app.services.portfolio_excel import (
        copy_excel_from_source, _source_path, _working_path,
    )
    src = _source_path()
    dst = _working_path()

    if not src.exists():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Source file not found: {src}",
        )

    src_size_kb = round(src.stat().st_size / 1024, 1)
    try:
        copy_excel_from_source()
        dst_size_kb = round(dst.stat().st_size / 1024, 1) if dst.exists() else 0
        return {
            "status": "ok",
            "source": str(src),
            "destination": str(dst),
            "source_size_kb": src_size_kb,
            "destination_size_kb": dst_size_kb,
            "message": "File copied and cache cleared successfully.",
        }
    except Exception as exc:
        raise _svc_error(exc)


# ── Raw Excel data ────────────────────────────────────────────────────────────

@router.get("/raw-data")
async def get_raw_data(_: UserId) -> dict[str, Any]:
    """Return all raw rows from the Excel file for inspection."""
    from app.services.portfolio_excel import _ensure_working_copy, _working_path
    import pandas as pd
    try:
        path = _ensure_working_copy()
        df = pd.read_excel(str(path), sheet_name="Sheet1")
        # Replace NaN / NaT with None for JSON serialisation
        df = df.where(pd.notna(df), None)
        # Convert timestamps to strings
        for col in df.select_dtypes(include=['datetime64[ns]', 'datetimetz']).columns:
            df[col] = df[col].astype(str).where(df[col].notna(), None)
        columns = list(df.columns)
        rows = df.values.tolist()
        return {
            "file": str(_working_path()),
            "columns": columns,
            "rows": rows,
            "total": len(rows),
        }
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


# ── Transactions for a period (drill-down) ───────────────────────────────────

@router.get("/performance/transactions")
async def get_period_transactions(
    _: UserId,
    period_key: str = Query(..., description="Period bucket key, e.g. '2024-01-15', '2024-W03', '2024-01'"),
    period: str = Query("daily", description="daily | weekly | monthly"),
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
) -> list[dict[str, Any]]:
    """Return individual closed transactions that fall within a specific period bucket."""
    from app.services.portfolio_excel import get_period_transactions
    try:
        return get_period_transactions(period_key=period_key, period=period, from_date=from_date, to_date=to_date)
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
