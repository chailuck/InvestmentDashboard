"""Portfolio DB endpoints — CRUD for users who maintain positions in the database."""

from __future__ import annotations

import asyncio
import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Annotated, Any, Optional

import yfinance as yf
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user_id
from app.database.session import get_db
from app.models.portfolio_db import PortfolioDbPosition
from app.models.user import User

router = APIRouter(prefix="/portfolio-db", tags=["portfolio-db"])

UserId = Annotated[str, Depends(get_current_user_id)]
DB = Annotated[AsyncSession, Depends(get_db)]


# ── Schemas ───────────────────────────────────────────────────────────────────

class PositionIn(BaseModel):
    symbol: str
    direction: str = "LONG"
    entry_date: Optional[date] = None
    entry_price: Optional[float] = None
    position_size: Optional[int] = None
    sl: Optional[float] = None
    tp: Optional[float] = None
    status: str = "active"
    exit_date: Optional[date] = None
    exit_price: Optional[float] = None
    remarks: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _f(v) -> float | None:
    return float(v) if v is not None else None


def _fetch_price(symbol: str) -> float | None:
    # Only try .BK — bare symbol would match US-listed tickers with same name
    for t in [f"{symbol}.BK"]:
        try:
            hist = yf.Ticker(t).history(period="2d")
            if not hist.empty:
                return float(hist["Close"].iloc[-1])
        except Exception:
            continue
    return None


def _serialize(
    pos: PortfolioDbPosition,
    current_price: float | None = None,
    has_children: bool = False,
) -> dict[str, Any]:
    entry = _f(pos.entry_price)
    size = pos.position_size or 0
    cp = current_price if pos.status == "active" else _f(pos.exit_price)
    is_short = pos.direction.upper() == "SHORT"

    net_pnl: float | None = None
    pnl_pct: float | None = None
    if entry and cp and size:
        diff = (cp - entry) if not is_short else (entry - cp)
        net_pnl = round(diff * size, 2)
        pnl_pct = round((diff / entry) * 100, 2) if entry else None

    return {
        "id": str(pos.id),
        "symbol": pos.symbol,
        "direction": pos.direction,
        "entryDate": pos.entry_date.isoformat() if pos.entry_date else None,
        "exitDate": pos.exit_date.isoformat() if pos.exit_date else None,
        "entryPrice": entry or 0.0,          # non-null: Position.entryPrice is number
        "exitPrice": _f(pos.exit_price),
        "currentPrice": cp or 0.0,           # non-null: Position.currentPrice is number
        "positionSize": pos.position_size or 0,  # non-null: Position.positionSize is number
        "netPnl": net_pnl or 0.0,
        "pnlPct": pnl_pct or 0.0,
        "sl": _f(pos.sl),
        "tp": _f(pos.tp),
        "status": pos.status,
        "remarks": pos.remarks,
        "parentId": str(pos.parent_id) if pos.parent_id else None,
        "hasChildren": has_children,
        "createdAt": pos.created_at.isoformat() if pos.created_at else None,
        "updatedAt": pos.updated_at.isoformat() if pos.updated_at else None,
    }


async def _get_or_404(pos_id: uuid.UUID, user_id: str, db: AsyncSession) -> PortfolioDbPosition:
    uid = uuid.UUID(user_id)
    row = await db.execute(
        select(PortfolioDbPosition).where(
            PortfolioDbPosition.id == pos_id,
            PortfolioDbPosition.user_id == uid,
        )
    )
    pos = row.scalar_one_or_none()
    if pos is None:
        raise HTTPException(404, "Position not found")
    return pos


# ── Portfolio mode helpers ────────────────────────────────────────────────────

async def get_user_portfolio_mode(user_id: str, db: AsyncSession) -> str:
    uid = uuid.UUID(user_id)
    row = await db.execute(select(User.portfolio_mode).where(User.id == uid))
    mode = row.scalar_one_or_none()
    return mode or "excel"


# ── List positions (used by portfolio tracker in DB mode) ────────────────────

async def list_positions_db(
    user_id: str,
    db: AsyncSession,
    from_date: date | None = None,
    to_date: date | None = None,
    status_filter: str = "active",
) -> dict[str, Any]:
    uid = uuid.UUID(user_id)
    q = select(PortfolioDbPosition).where(PortfolioDbPosition.user_id == uid)

    if status_filter != "all":
        q = q.where(PortfolioDbPosition.status == status_filter)
    if from_date:
        q = q.where(PortfolioDbPosition.entry_date >= from_date)
    if to_date:
        q = q.where(PortfolioDbPosition.entry_date <= to_date)

    q = q.order_by(PortfolioDbPosition.entry_date.desc().nullsfirst(), PortfolioDbPosition.created_at.desc())
    result = await db.execute(q)
    rows = result.scalars().all()

    # Fetch live prices for active positions in parallel
    active_symbols = list({r.symbol for r in rows if r.status == "active"})
    prices: dict[str, float | None] = {}
    if active_symbols:
        price_results = await asyncio.gather(
            *[asyncio.get_event_loop().run_in_executor(None, _fetch_price, s) for s in active_symbols],
            return_exceptions=True,
        )
        for sym, pr in zip(active_symbols, price_results):
            prices[sym] = pr if not isinstance(pr, Exception) else None

    # Find which positions have children (partial sells)
    parent_ids_result = await db.execute(
        select(PortfolioDbPosition.parent_id).where(
            PortfolioDbPosition.user_id == uid,
            PortfolioDbPosition.parent_id.isnot(None),
        ).distinct()
    )
    parents_with_children = {str(r[0]) for r in parent_ids_result.fetchall()}

    serialized = [_serialize(r, prices.get(r.symbol), str(r.id) in parents_with_children) for r in rows]
    total_pnl = sum(p["netPnl"] for p in serialized)
    return {"positions": serialized, "total": len(serialized), "totalNetPnl": round(total_pnl, 0)}


# ── Performance helpers (DB mode) ────────────────────────────────────────────

def _period_key(d: date, period: str) -> str:
    if period == "weekly":
        iso = d.isocalendar()
        return f"{iso[0]}-W{iso[1]:02d}"
    if period == "monthly":
        return f"{d.year}-{d.month:02d}"
    return d.isoformat()


def _period_label(key: str, period: str) -> str:
    if period == "weekly":
        return key
    if period == "monthly":
        parts = key.split("-")
        months = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
                  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        return f"{months[int(parts[1])]} {parts[0]}"
    try:
        d = date.fromisoformat(key)
        return d.strftime("%d %b %y")
    except Exception:
        return key


async def _get_closed_positions(user_id: str, db: AsyncSession,
                                from_date: date | None, to_date: date | None):
    uid = uuid.UUID(user_id)
    q = select(PortfolioDbPosition).where(
        PortfolioDbPosition.user_id == uid,
        PortfolioDbPosition.status == "closed",
    )
    if from_date:
        q = q.where(PortfolioDbPosition.exit_date >= from_date)
    if to_date:
        q = q.where(PortfolioDbPosition.exit_date <= to_date)
    result = await db.execute(q)
    return result.scalars().all()


def _pos_net_pnl(pos: PortfolioDbPosition) -> float:
    if pos.exit_price is None or pos.entry_price is None or pos.position_size is None:
        return 0.0
    ep = float(pos.entry_price)
    xp = float(pos.exit_price)
    sz = pos.position_size
    diff = (xp - ep) if pos.direction.upper() != "SHORT" else (ep - xp)
    return round(diff * sz, 2)


async def get_performance_db(user_id: str, db: AsyncSession,
                             from_date: date | None, to_date: date | None,
                             period: str) -> list[dict]:
    """Returns DailyPerformance shape: {date, label, dailyPnl, cumulativePnl}."""
    rows = await _get_closed_positions(user_id, db, from_date, to_date)
    buckets: dict[str, float] = defaultdict(float)
    for r in rows:
        if r.exit_date is None:
            continue
        key = _period_key(r.exit_date, period)
        buckets[key] += _pos_net_pnl(r)

    sorted_keys = sorted(buckets)
    cumulative = 0.0
    result = []
    for key in sorted_keys:
        cumulative += buckets[key]
        result.append({
            "date": key,                                    # matches DailyPerformance.date
            "label": _period_label(key, period),
            "dailyPnl": round(buckets[key], 0),            # matches DailyPerformance.dailyPnl
            "cumulativePnl": round(cumulative, 0),          # matches DailyPerformance.cumulativePnl
        })
    return result


async def get_performance_by_date_db(user_id: str, db: AsyncSession,
                                     from_date: date | None, to_date: date | None,
                                     period: str) -> list[dict]:
    """Returns PerformanceByDate shape: {period, label, net, wins, losses, total, winRate}."""
    rows = await _get_closed_positions(user_id, db, from_date, to_date)
    buckets: dict[str, list] = defaultdict(list)
    for r in rows:
        if r.exit_date is None:
            continue
        key = _period_key(r.exit_date, period)
        buckets[key].append(r)

    result = []
    for key in sorted(buckets):
        positions = buckets[key]
        net = sum(_pos_net_pnl(p) for p in positions)
        wins = sum(1 for p in positions if _pos_net_pnl(p) > 0)
        losses = sum(1 for p in positions if _pos_net_pnl(p) <= 0)
        total = len(positions)
        result.append({
            "period": key,
            "label": _period_label(key, period),
            "net": round(net, 0),
            "wins": wins,
            "losses": losses,
            "total": total,                                # matches PerformanceByDate.total
            "winRate": round(wins / total * 100, 1) if total else 0.0,  # matches PerformanceByDate.winRate
        })
    return result


async def get_period_transactions_db(user_id: str, db: AsyncSession,
                                     period_key_val: str, period: str,
                                     from_date: date | None, to_date: date | None) -> list[dict]:
    """Returns PeriodTransaction shape: {symbol, direction, entryDate, exitDate,
       entryPrice, exitPrice, positionSize, netPnl, pnlPct, sl, tp, remarks}."""
    rows = await _get_closed_positions(user_id, db, from_date, to_date)
    matched = [r for r in rows if r.exit_date and _period_key(r.exit_date, period) == period_key_val]
    result = []
    for r in matched:
        net = _pos_net_pnl(r)
        ep = float(r.entry_price) if r.entry_price else 0.0
        xp = float(r.exit_price) if r.exit_price else 0.0
        pnl_pct = round((xp - ep) / ep * 100, 2) if ep else 0.0
        result.append({
            "symbol": r.symbol,
            "direction": r.direction,
            "entryDate": r.entry_date.isoformat() if r.entry_date else None,
            "exitDate": r.exit_date.isoformat() if r.exit_date else "",
            "entryPrice": ep,
            "exitPrice": xp,
            "positionSize": r.position_size or 0,          # non-null
            "netPnl": net,
            "pnlPct": pnl_pct,
            "sl": float(r.sl) if r.sl else None,
            "tp": float(r.tp) if r.tp else None,
            "remarks": r.remarks,
        })
    return result


async def get_performance_by_stock_db(user_id: str, db: AsyncSession,
                                      from_date: date | None, to_date: date | None) -> list[dict]:
    """Returns PerformanceByStock shape: {symbol, net, investment, currentValue,
       pnlPct, wins, losses, total, winRate}."""
    rows = await _get_closed_positions(user_id, db, from_date, to_date)
    by_stock: dict[str, list] = defaultdict(list)
    for r in rows:
        by_stock[r.symbol].append(r)

    result = []
    for sym, positions in sorted(by_stock.items()):
        net = sum(_pos_net_pnl(p) for p in positions)
        wins = sum(1 for p in positions if _pos_net_pnl(p) > 0)
        losses = sum(1 for p in positions if _pos_net_pnl(p) <= 0)
        total = len(positions)

        # Compute investment & current value from entry/exit prices
        investment = sum(
            float(p.entry_price or 0) * (p.position_size or 0) for p in positions
        )
        current_value = sum(
            float(p.exit_price or p.entry_price or 0) * (p.position_size or 0) for p in positions
        )
        pnl_pct = round((current_value - investment) / investment * 100, 2) if investment else 0.0

        result.append({
            "symbol": sym,
            "net": round(net, 0),
            "investment": round(investment, 0),            # matches PerformanceByStock.investment
            "currentValue": round(current_value, 0),       # matches PerformanceByStock.currentValue
            "pnlPct": pnl_pct,                             # matches PerformanceByStock.pnlPct
            "wins": wins,
            "losses": losses,
            "total": total,                                # matches PerformanceByStock.total
            "winRate": round(wins / total * 100, 1) if total else 0.0,
        })
    return sorted(result, key=lambda x: x["net"], reverse=True)


# ── CRUD endpoints ────────────────────────────────────────────────────────────

@router.get("/positions")
async def get_positions(
    user_id: UserId,
    db: DB,
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
    status: str = Query("active"),
) -> dict[str, Any]:
    return await list_positions_db(user_id, db, from_date, to_date, status)


@router.post("/positions", status_code=201)
async def create_position(body: PositionIn, user_id: UserId, db: DB) -> dict[str, Any]:
    uid = uuid.UUID(user_id)
    pos = PortfolioDbPosition(
        user_id=uid,
        symbol=body.symbol.strip().upper(),
        direction=body.direction.upper(),
        entry_date=body.entry_date,
        entry_price=body.entry_price,
        position_size=body.position_size,
        sl=body.sl,
        tp=body.tp,
        status=body.status,
        exit_date=body.exit_date,
        exit_price=body.exit_price,
        remarks=body.remarks,
    )
    db.add(pos)
    await db.commit()
    await db.refresh(pos)
    return _serialize(pos)


@router.put("/positions/{pos_id}")
async def update_position(pos_id: uuid.UUID, body: PositionIn, user_id: UserId, db: DB) -> dict[str, Any]:
    pos = await _get_or_404(pos_id, user_id, db)
    pos.symbol = body.symbol.strip().upper()
    pos.direction = body.direction.upper()
    pos.entry_date = body.entry_date
    pos.entry_price = body.entry_price
    pos.position_size = body.position_size
    pos.sl = body.sl
    pos.tp = body.tp
    pos.status = body.status
    pos.exit_date = body.exit_date
    pos.exit_price = body.exit_price
    pos.remarks = body.remarks
    await db.commit()
    await db.refresh(pos)
    return _serialize(pos)


@router.delete("/positions/{pos_id}", status_code=204)
async def delete_position(pos_id: uuid.UUID, user_id: UserId, db: DB):
    from fastapi.responses import Response
    pos = await _get_or_404(pos_id, user_id, db)
    await db.delete(pos)
    await db.commit()
    return Response(status_code=204)


# ── Sell (partial or full) ────────────────────────────────────────────────────

class SellIn(BaseModel):
    quantity: int
    exit_price: float
    exit_date: date
    remarks: Optional[str] = None


@router.post("/positions/{pos_id}/sell", status_code=201)
async def sell_position(pos_id: uuid.UUID, body: SellIn, user_id: UserId, db: DB) -> dict[str, Any]:
    pos = await _get_or_404(pos_id, user_id, db)
    if pos.status != "active":
        raise HTTPException(400, "Position is not active")
    if body.quantity <= 0:
        raise HTTPException(400, "Sell quantity must be positive")
    if pos.position_size and body.quantity > pos.position_size:
        raise HTTPException(400, f"Cannot sell more than {pos.position_size} shares")

    uid = uuid.UUID(user_id)

    if body.quantity == pos.position_size:
        # Full sell — close in place
        pos.status = "closed"
        pos.exit_date = body.exit_date
        pos.exit_price = body.exit_price
        if body.remarks:
            pos.remarks = body.remarks
        await db.commit()
        await db.refresh(pos)
        return {"type": "full", "position": _serialize(pos)}

    # Partial sell — create closed child, shrink parent
    remaining = pos.position_size - body.quantity
    child = PortfolioDbPosition(
        user_id=uid,
        symbol=pos.symbol,
        direction=pos.direction,
        entry_date=pos.entry_date,
        entry_price=pos.entry_price,
        position_size=body.quantity,
        sl=pos.sl,
        tp=pos.tp,
        status="closed",
        exit_date=body.exit_date,
        exit_price=body.exit_price,
        remarks=body.remarks or f"Partial sell ({body.quantity} shares)",
        parent_id=pos.id,
    )
    pos.position_size = remaining
    db.add(child)
    await db.commit()
    await db.refresh(pos)
    await db.refresh(child)
    return {
        "type": "partial",
        "remaining": _serialize(pos),
        "sold": _serialize(child),
    }


@router.post("/positions/{pos_id}/undo-sell")
async def undo_sell(pos_id: uuid.UUID, user_id: UserId, db: DB) -> dict[str, Any]:
    """Undo the most recent partial sell linked to this position."""
    uid = uuid.UUID(user_id)

    # Find most recently created child
    result = await db.execute(
        select(PortfolioDbPosition)
        .where(
            PortfolioDbPosition.parent_id == pos_id,
            PortfolioDbPosition.user_id == uid,
        )
        .order_by(PortfolioDbPosition.created_at.desc())
        .limit(1)
    )
    child = result.scalar_one_or_none()
    if child is None:
        raise HTTPException(404, "No sell record found to undo")

    parent = await _get_or_404(pos_id, user_id, db)
    restored_qty = child.position_size or 0
    parent.position_size = (parent.position_size or 0) + restored_qty

    await db.delete(child)
    await db.commit()
    await db.refresh(parent)
    return {"status": "ok", "restored_quantity": restored_qty, "position": _serialize(parent)}


# ── Portfolio mode ─────────────────────────────────────────────────────────────

@router.get("/mode")
async def get_mode(user_id: UserId, db: DB) -> dict[str, str]:
    mode = await get_user_portfolio_mode(user_id, db)
    return {"mode": mode}


@router.put("/mode")
async def set_mode(user_id: UserId, db: DB, mode: str = Query(..., description="excel | db")) -> dict[str, str]:
    if mode not in ("excel", "db"):
        raise HTTPException(400, "mode must be 'excel' or 'db'")
    uid = uuid.UUID(user_id)
    row = await db.execute(select(User).where(User.id == uid))
    user = row.scalar_one_or_none()
    if not user:
        raise HTTPException(404)
    user.portfolio_mode = mode
    await db.commit()
    return {"mode": mode}
