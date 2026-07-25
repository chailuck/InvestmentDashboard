"""Daily Performance endpoints.

Provides read access to stored daily snapshots, an on-demand snapshot trigger,
a manual correction endpoint, and a per-record delete endpoint.

Routes
------
  GET    /daily-performance                  — list snapshots in a date range
  POST   /daily-performance/backfill         — one-time historical backfill (destructive)
  POST   /daily-performance/run              — trigger snapshot for current user
  PUT    /daily-performance/{date_str}       — patch a stored snapshot record
  DELETE /daily-performance/{date_str}       — delete a single snapshot record
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user_id
from app.core.logging import get_logger
from app.database.session import get_db
from app.models.daily_performance import DailyPerformance
from app.models.portfolio import Portfolio
from app.services.daily_performance_service import run_daily_snapshot, run_historical_backfill

_log = get_logger("daily_performance.endpoint")

router = APIRouter(prefix="/daily-performance", tags=["daily-performance"])

UserId = Annotated[str, Depends(get_current_user_id)]
DB = Annotated[AsyncSession, Depends(get_db)]


# ── Schemas ───────────────────────────────────────────────────────────────────

class OpenPositionItem(BaseModel):
    """A single open position entry stored in the JSONB snapshot field."""

    symbol: str
    pnl: float
    pnl_pct: float


class DailyPerformanceUpdate(BaseModel):
    """Partial update body for manually correcting a stored snapshot.

    All fields are optional — only non-None values are written to the record.
    Percentage fields (closed_pnl_pct, open_pnl_pct) are recomputed from the
    new absolute values and the stored investment figure.
    """

    investment: Optional[float] = None
    closed_pnl: Optional[float] = None
    open_pnl: Optional[float] = None
    open_positions: Optional[list[OpenPositionItem]] = None


# ── Serialisation helper ──────────────────────────────────────────────────────

def _serialize(row: DailyPerformance) -> dict[str, Any]:
    """Serialise a DailyPerformance ORM row to a JSON-safe dict.

    Numeric columns are cast to float so that Decimal values from the DB
    driver are not passed raw to the JSON serialiser.
    """
    return {
        "id": str(row.id),
        "date": row.date.isoformat() if row.date else None,
        "portfolio_id": str(row.portfolio_id),
        "investment": float(row.investment) if row.investment is not None else 0.0,
        "closed_pnl": float(row.closed_pnl) if row.closed_pnl is not None else 0.0,
        "closed_pnl_pct": (
            float(row.closed_pnl_pct) if row.closed_pnl_pct is not None else 0.0
        ),
        "open_pnl": float(row.open_pnl) if row.open_pnl is not None else 0.0,
        "open_pnl_pct": (
            float(row.open_pnl_pct) if row.open_pnl_pct is not None else 0.0
        ),
        "open_positions": row.open_positions,
        "purchased_positions": row.purchased_positions,
        "sold_positions": row.sold_positions,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


# ── Portfolio resolution helper ───────────────────────────────────────────────

async def _resolve_portfolio_id(
    db: AsyncSession,
    uid: uuid.UUID,
    portfolio_id_param: uuid.UUID | None,
) -> uuid.UUID:
    """Resolve the target portfolio UUID, applying IDOR protection.

    If ``portfolio_id_param`` is provided, confirm it belongs to ``uid`` and
    return it.  If ``None``, look up the user's default portfolio.

    Raises:
        HTTPException 404: No default portfolio found (when param is None).
        HTTPException 403: Portfolio does not belong to the authenticated user.
        HTTPException 404: Portfolio UUID provided does not exist.
    """
    if portfolio_id_param is not None:
        result = await db.execute(
            select(Portfolio).where(Portfolio.id == portfolio_id_param)
        )
        portfolio = result.scalar_one_or_none()
        if portfolio is None:
            raise HTTPException(status_code=404, detail="Portfolio not found.")
        if portfolio.user_id != uid:
            raise HTTPException(
                status_code=403,
                detail="Portfolio does not belong to the authenticated user.",
            )
        return portfolio.id

    # Default portfolio lookup
    result = await db.execute(
        select(Portfolio).where(
            Portfolio.user_id == uid,
            Portfolio.is_default.is_(True),
        )
    )
    portfolio = result.scalar_one_or_none()
    if portfolio is None:
        raise HTTPException(
            status_code=404,
            detail=(
                "No default portfolio configured for this user. "
                "Pass ?portfolio_id=<uuid> explicitly or mark a portfolio as default."
            ),
        )
    return portfolio.id


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("", response_model=list[dict])
async def list_daily_performance(
    user_id: UserId,
    db: DB,
    date_from: date | None = Query(None, description="Start date (YYYY-MM-DD). Defaults to today − 60 days."),
    date_to: date | None = Query(None, description="End date (YYYY-MM-DD). Defaults to today."),
    portfolio_id: uuid.UUID | None = Query(None, description="Portfolio UUID. Defaults to user's default portfolio."),
) -> list[dict[str, Any]]:
    """Return daily performance snapshots for the authenticated user's portfolio.

    Records are ordered by date ascending so callers can render a chart
    without additional sorting.  The default window covers the last 60 days.

    Args:
        user_id:      Injected from the JWT bearer token.
        db:           Async DB session.
        date_from:    Optional window start; defaults to today - 60 days.
        date_to:      Optional window end; defaults to today.
        portfolio_id: Optional portfolio UUID; defaults to the user's default portfolio.

    Returns:
        List of serialised DailyPerformance records, oldest first.
    """
    uid = uuid.UUID(user_id)
    resolved_portfolio_id = await _resolve_portfolio_id(db, uid, portfolio_id)
    today = date.today()
    df = date_from or (today - timedelta(days=60))
    dt = date_to or today

    # Hard cap: prevent full-table scan over unbounded date ranges.
    max_range_days = 366
    if (dt - df).days > max_range_days:
        raise HTTPException(
            status_code=400,
            detail=f"Date range cannot exceed {max_range_days} days.",
        )

    _log.info(
        "daily_performance.list",
        user_id=user_id,
        portfolio_id=str(resolved_portfolio_id),
        date_from=df.isoformat(),
        date_to=dt.isoformat(),
    )

    q = (
        select(DailyPerformance)
        .where(
            DailyPerformance.portfolio_id == resolved_portfolio_id,
            DailyPerformance.date >= df,
            DailyPerformance.date <= dt,
        )
        .order_by(DailyPerformance.date.asc())
    )
    result = await db.execute(q)
    rows = result.scalars().all()
    return [_serialize(r) for r in rows]


@router.post("/backfill")
async def trigger_historical_backfill(
    user_id: UserId,
    db: DB,
    portfolio_id: uuid.UUID | None = Query(
        None,
        description="Portfolio UUID. Defaults to the user's default portfolio.",
    ),
    start_date: date | None = Query(
        None,
        description=(
            "Backfill start date (YYYY-MM-DD). "
            "Defaults to the earliest entry_date found in the portfolio."
        ),
    ),
) -> dict[str, Any]:
    """Run a one-time historical backfill for the authenticated user's portfolio.

    Populates daily_performance for every SET trading day (Mon–Fri) from
    ``start_date`` (or the earliest recorded trade date) through today.
    Uses idempotent upsert semantics — safe to re-run; existing rows are
    refreshed, not duplicated.

    Prices for historical dates are fetched from yfinance in bulk (one call
    per symbol for the full date range) before day-by-day iteration begins,
    so network round-trips are proportional to the number of symbols, not days.

    This endpoint is synchronous.  Expect 10–60 seconds depending on the
    portfolio's history length and network conditions.

    Args:
        user_id:      Injected from the JWT bearer token.
        db:           Async DB session.
        portfolio_id: Optional portfolio UUID; defaults to the user's default.
        start_date:   Optional override for the backfill start date.

    Returns:
        ``{status, processed, skipped, errors, start_date, end_date}``

    Raises:
        400: ``start_date`` is not a valid ISO date (caught by FastAPI param parsing).
        403: Portfolio does not belong to the authenticated user.
        404: Portfolio not found or no default portfolio configured.
    """
    uid = uuid.UUID(user_id)
    resolved_portfolio_id = await _resolve_portfolio_id(db, uid, portfolio_id)

    _log.info(
        "daily_performance.backfill_requested",
        user_id=user_id,
        portfolio_id=str(resolved_portfolio_id),
        start_date=start_date.isoformat() if start_date else "auto",
    )

    try:
        summary = await run_historical_backfill(
            db,
            user_id=user_id,
            portfolio_id=str(resolved_portfolio_id),
            start_date=start_date,
        )
    except RuntimeError as exc:
        # Concurrency guard: another backfill is already in progress.
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        # Input validation: start_date exceeds the maximum lookback window.
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"status": "ok", **summary}


@router.post("/run")
async def trigger_snapshot(
    user_id: UserId,
    db: DB,
    portfolio_id: uuid.UUID | None = Query(
        None,
        description="Portfolio UUID. Defaults to user's default portfolio.",
    ),
    snapshot_date: date | None = Query(
        None,
        description=(
            "Snapshot date (YYYY-MM-DD). Defaults to today. "
            "Use this to regenerate a specific past day (e.g. after a per-row Refresh action)."
        ),
    ),
) -> dict[str, Any]:
    """Trigger an on-demand daily performance snapshot for the current user's portfolio.

    When ``snapshot_date`` is omitted the snapshot is computed for today.
    When ``snapshot_date`` is supplied the snapshot is computed for that specific
    date using historical prices — useful for refreshing a single past record
    without running a full backfill.  If a record already exists for the target
    date it will be overwritten (idempotent upsert).

    Args:
        user_id:       Injected from the JWT bearer token.
        db:            Async DB session.
        portfolio_id:  Optional portfolio UUID; defaults to the user's default portfolio.
        snapshot_date: Optional target date; defaults to today.

    Returns:
        A dict with ``status: "ok"`` merged with the serialised snapshot.
    """
    effective_date = snapshot_date or date.today()
    uid = uuid.UUID(user_id)
    resolved_portfolio_id = await _resolve_portfolio_id(db, uid, portfolio_id)

    _log.info(
        "daily_performance.manual_run",
        user_id=user_id,
        portfolio_id=str(resolved_portfolio_id),
        snapshot_date=effective_date.isoformat(),
        requested_date=snapshot_date.isoformat() if snapshot_date else "today",
    )

    row = await run_daily_snapshot(db, user_id, effective_date, portfolio_id=str(resolved_portfolio_id))
    return {"status": "ok", **_serialize(row)}


@router.put("/{date_str}")
async def update_daily_performance(
    date_str: str,
    body: DailyPerformanceUpdate,
    user_id: UserId,
    db: DB,
    portfolio_id: uuid.UUID | None = Query(None, description="Portfolio UUID. Defaults to user's default portfolio."),
) -> dict[str, Any]:
    """Manually patch a stored daily performance record.

    Useful for correcting snapshots that were computed with stale or missing
    price data.  Only fields present and non-None in the request body are
    applied.  Percentage columns (closed_pnl_pct, open_pnl_pct) are
    recomputed from the updated absolute values and the stored investment.

    Args:
        date_str:     Target date in ``YYYY-MM-DD`` format.
        body:         Partial update payload.
        user_id:      Injected from the JWT bearer token.
        db:           Async DB session.
        portfolio_id: Optional portfolio UUID; defaults to the user's default portfolio.

    Returns:
        Serialised updated record.

    Raises:
        400: date_str is not a valid ISO date.
        403: Portfolio does not belong to the authenticated user.
        404: No record exists for this portfolio and date.
    """
    try:
        target_date = date.fromisoformat(date_str)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid date format '{date_str}'. Use YYYY-MM-DD.",
        ) from exc

    uid_for_resolve = uuid.UUID(user_id)
    resolved_portfolio_id = await _resolve_portfolio_id(db, uid_for_resolve, portfolio_id)

    result = await db.execute(
        select(DailyPerformance).where(
            DailyPerformance.portfolio_id == resolved_portfolio_id,
            DailyPerformance.date == target_date,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status_code=404,
            detail=f"No daily performance record found for portfolio {resolved_portfolio_id} on date {date_str}.",
        )

    _log.info(
        "daily_performance.update",
        user_id=user_id,
        portfolio_id=str(resolved_portfolio_id),
        target_date=date_str,
        fields_provided={
            k for k, v in body.model_dump().items() if v is not None
        },
    )

    # Apply investment first so percentage recalculations below use the
    # updated denominator when both investment and a P&L figure are supplied
    # in the same request.
    if body.investment is not None:
        row.investment = body.investment

    current_investment = float(row.investment) if row.investment else 0.0

    if body.closed_pnl is not None:
        row.closed_pnl = body.closed_pnl
        row.closed_pnl_pct = (
            round((body.closed_pnl / current_investment) * 100, 4)
            if current_investment > 0
            else 0.0
        )

    if body.open_pnl is not None:
        row.open_pnl = body.open_pnl
        row.open_pnl_pct = (
            round((body.open_pnl / current_investment) * 100, 4)
            if current_investment > 0
            else 0.0
        )

    if body.open_positions is not None:
        # Convert Pydantic models to plain dicts for JSONB storage
        row.open_positions = [p.model_dump() for p in body.open_positions]

    await db.commit()
    await db.refresh(row)

    _log.info(
        "daily_performance.update_complete",
        user_id=user_id,
        portfolio_id=str(resolved_portfolio_id),
        target_date=date_str,
    )
    return _serialize(row)


@router.delete("/{date_str}", status_code=204, response_class=Response)
async def delete_daily_performance(
    date_str: str,
    user_id: UserId,
    db: DB,
    portfolio_id: uuid.UUID | None = Query(
        None,
        description="Portfolio UUID. Defaults to the user's default portfolio.",
    ),
) -> Response:
    """Delete a single daily performance record for the given portfolio and date.

    Useful for removing erroneous or stale snapshots.  The record can be
    regenerated by running a fresh snapshot or backfill.

    Args:
        date_str:     Target date in ``YYYY-MM-DD`` format.
        user_id:      Injected from the JWT bearer token.
        db:           Async DB session.
        portfolio_id: Optional portfolio UUID; defaults to the user's default portfolio.

    Raises:
        400: date_str is not a valid ISO date.
        403: Portfolio does not belong to the authenticated user.
        404: No record exists for this portfolio and date.
    """
    try:
        target_date = date.fromisoformat(date_str)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid date format '{date_str}'. Use YYYY-MM-DD.",
        ) from exc

    uid = uuid.UUID(user_id)
    resolved_portfolio_id = await _resolve_portfolio_id(db, uid, portfolio_id)

    result = await db.execute(
        select(DailyPerformance).where(
            DailyPerformance.portfolio_id == resolved_portfolio_id,
            DailyPerformance.date == target_date,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No daily performance record found for portfolio "
                f"{resolved_portfolio_id} on date {date_str}."
            ),
        )

    _log.info(
        "daily_performance.delete",
        user_id=user_id,
        portfolio_id=str(resolved_portfolio_id),
        target_date=date_str,
    )

    await db.delete(row)
    await db.commit()

    _log.info(
        "daily_performance.delete_complete",
        user_id=user_id,
        portfolio_id=str(resolved_portfolio_id),
        target_date=date_str,
    )
    return Response(status_code=204)
