"""Portfolio tracker endpoints — reads Investment tracking.xlsx with live yfinance prices."""

from __future__ import annotations

from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.auth.dependencies import get_current_user_id

router = APIRouter(prefix="/portfolio-tracker", tags=["Portfolio Tracker"])

UserId = Annotated[str, Depends(get_current_user_id)]


@router.get("/positions")
async def list_positions(
    _: UserId,
    from_date: date | None = Query(None, description="Filter from date (YYYY-MM-DD)"),
    to_date: date | None = Query(None, description="Filter to date (YYYY-MM-DD)"),
    status: str = Query("active", description="active | closed | all"),
) -> dict[str, Any]:
    """
    Return portfolio positions from the Excel file.
    - status=active  → open positions (NOT SELL, Exit Price blank)
    - status=closed  → sold positions
    - status=all     → everything
    """
    from app.services.portfolio_excel import get_positions

    try:
        positions = get_positions(from_date=from_date, to_date=to_date, status=status)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))

    total_pnl = sum(p["netPnl"] for p in positions)
    return {
        "positions": positions,
        "total": len(positions),
        "totalNetPnl": round(total_pnl, 0),
    }


@router.get("/performance")
async def get_performance(
    _: UserId,
    from_date: date | None = Query(None, description="Start date (YYYY-MM-DD)"),
    to_date: date | None = Query(None, description="End date (YYYY-MM-DD)"),
) -> list[dict[str, Any]]:
    """
    Daily cumulative P&L for the line chart.
    Defaults to the last 30 days when no dates are provided.
    """
    from app.services.portfolio_excel import get_daily_performance

    try:
        return get_daily_performance(from_date=from_date, to_date=to_date)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))
