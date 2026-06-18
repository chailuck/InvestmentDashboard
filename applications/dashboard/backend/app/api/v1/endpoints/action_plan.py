"""Action Plan CRUD endpoints.

Endpoints
---------
GET  /action-plans/suggest-name          â†’ unique plan name for today (YYYY-MM-DD[-NN])
GET  /action-plans/stock-price           â†’ latest price from yfinance (.BK first)
GET  /action-plans                       â†’ list plans (type + optional month filter)
POST /action-plans                       â†’ create empty plan
GET  /action-plans/{id}                  â†’ fetch plan + items
PUT  /action-plans/{id}                  â†’ replace name and/or items
DEL  /action-plans/{id}                  â†’ hard delete
POST /action-plans/{id}/duplicate        â†’ copy plan with new name
"""


import asyncio
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints.analytics import _ticker_sym
from app.auth.dependencies import get_current_user_id
from app.core.logging import get_logger
from app.database.session import get_db
from app.models.action_plan import ActionPlan, PortfolioPlanItem, PurchasePlanItem
from app.schemas.action_plan import ActionPlanCreate, ActionPlanUpdate

router = APIRouter(prefix="/action-plans", tags=["Action Plans"])

UserId = Annotated[str, Depends(get_current_user_id)]
DB = Annotated[AsyncSession, Depends(get_db)]

_log = get_logger("action_plan")

_SYMBOL_RE = re.compile(r"^[A-Z0-9.\-]{1,20}$")
_MAX_SYMBOLS = 20


# â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def _f(v: Any) -> float | None:
    """Decimal / None â†’ float / None (safe for JSON)."""
    return float(v) if v is not None else None


def _i(v: Any) -> int | None:
    return int(v) if v is not None else None


def _symbols(plan: ActionPlan) -> str:
    if plan.plan_type == "purchase":
        syms = [i.stock for i in plan.purchase_items if i.stock]
    else:
        syms = [i.symbol for i in plan.portfolio_items if i.symbol]
    return ", ".join(syms)


async def _get_or_404(plan_id: uuid.UUID, user_id: str, db: AsyncSession) -> ActionPlan:
    uid = uuid.UUID(user_id)
    result = await db.execute(
        select(ActionPlan)
        .where(ActionPlan.id == plan_id, ActionPlan.created_by == uid)
        .options(
            selectinload(ActionPlan.purchase_items),
            selectinload(ActionPlan.portfolio_items),
        )
    )
    plan = result.scalar_one_or_none()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    return plan


def _purchase_item_dict(item: PurchasePlanItem) -> dict[str, Any]:
    return {
        "id": str(item.id),
        "sort_order": item.sort_order,
        "stock": item.stock,
        "current_price": _f(item.current_price),
        "size": _i(item.size),
        "buy_price": _f(item.buy_price),
        "tp": _f(item.tp),
        "sl": _f(item.sl),
        "strategy": item.strategy,
        "reason": item.reason,
        "triggered": item.triggered,
    }


def _portfolio_item_dict(item: PortfolioPlanItem) -> dict[str, Any]:
    return {
        "id": str(item.id),
        "sort_order": item.sort_order,
        "symbol": item.symbol,
        "current_price": _f(item.current_price),
        "size": _i(item.size),
        "entry_price": _f(item.entry_price),
        "tp": _f(item.tp),
        "sl": _f(item.sl),
        "order_size": _i(item.order_size),
    }


def _plan_detail(plan: ActionPlan) -> dict[str, Any]:
    return {
        "id": str(plan.id),
        "name": plan.name,
        "plan_type": plan.plan_type,
        "notes": plan.notes,
        "set_analysis": plan.set_analysis,
        "ai_recommend": plan.ai_recommend,
        "created_at": plan.created_at.isoformat(),
        "updated_at": plan.updated_at.isoformat(),
        "purchase_items": [_purchase_item_dict(i) for i in plan.purchase_items],
        "portfolio_items": [_portfolio_item_dict(i) for i in plan.portfolio_items],
    }


# â”€â”€ Suggest unique plan name â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.get("/suggest-name")
async def suggest_name(
    user_id: UserId,
    db: DB,
    plan_type: str = Query(..., description="purchase | portfolio"),
) -> dict[str, str]:
    """
    Return a name guaranteed not to exist for this user+type.
    Pattern: YYYY-MM-DD, then YYYY-MM-DD-01, YYYY-MM-DD-02, â€¦
    """
    uid = uuid.UUID(user_id)
    today = date.today().strftime("%Y-%m-%d")

    async def _exists(name: str) -> bool:
        r = await db.execute(
            select(ActionPlan.id).where(
                ActionPlan.name == name,
                ActionPlan.plan_type == plan_type,
                ActionPlan.created_by == uid,
            )
        )
        return r.scalar_one_or_none() is not None

    candidate = today
    if not await _exists(candidate):
        return {"name": candidate}

    for n in range(1, 100):
        candidate = f"{today}-{n:02d}"
        if not await _exists(candidate):
            return {"name": candidate}

    return {"name": candidate}  # fallback (shouldn't happen)


# â”€â”€ Live stock price â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.get("/stock-price")
async def get_stock_price(
    _: UserId,
    symbol: str = Query(..., description="Thai SET stock symbol, e.g. BH"),
) -> dict[str, Any]:
    """
    Fetch the latest closing price from Yahoo Finance.
    Tries <SYMBOL>.BK (Thai SET) then bare <SYMBOL>.
    """
    import yfinance as yf

    sym = symbol.strip().upper()
    # Only try .BK â€” bare symbol would match a US-listed ticker with the same name
    for ticker_sym in [f"{sym}.BK"]:
        try:
            hist = yf.Ticker(ticker_sym).history(period="5d")
            if not hist.empty:
                price = float(hist["Close"].iloc[-1])
                change_pct: float | None = None
                if len(hist) >= 2:
                    prev_close = float(hist["Close"].iloc[-2])
                    if prev_close != 0:
                        change_pct = round((price - prev_close) / prev_close * 100, 2)
                return {
                    "symbol": sym,
                    "ticker": ticker_sym,
                    "price": round(price, 2),
                    "change_pct": change_pct,
                }
        except Exception:
            continue

    raise HTTPException(status_code=404, detail=f"Price not found for {symbol}")


# â”€â”€ List plans â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.get("")
async def list_plans(
    user_id: UserId,
    db: DB,
    plan_type: str = Query(..., description="purchase | portfolio"),
    months: Optional[int] = Query(None, description="3 | 6 | 12 | omit for all"),
) -> list[dict[str, Any]]:
    uid = uuid.UUID(user_id)
    conditions = [ActionPlan.created_by == uid, ActionPlan.plan_type == plan_type]
    if months:
        conditions.append(ActionPlan.created_at >= text(f"NOW() - INTERVAL '{months} months'"))
    q = (
        select(ActionPlan)
        .where(*conditions)
        .options(
            selectinload(ActionPlan.purchase_items),
            selectinload(ActionPlan.portfolio_items),
        )
        .order_by(ActionPlan.created_at.desc())
    )

    result = await db.execute(q)
    plans = result.scalars().all()

    return [
        {
            "id": str(p.id),
            "name": p.name,
            "plan_type": p.plan_type,
            "created_at": p.created_at.isoformat(),
            "updated_at": p.updated_at.isoformat(),
            "symbols": _symbols(p),
        }
        for p in plans
    ]


# â”€â”€ Create plan â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.post("", status_code=status.HTTP_201_CREATED)
async def create_plan(body: ActionPlanCreate, user_id: UserId, db: DB) -> dict[str, Any]:
    if body.plan_type not in ("purchase", "portfolio"):
        raise HTTPException(status_code=400, detail="plan_type must be 'purchase' or 'portfolio'")

    plan = ActionPlan(
        name=body.name,
        plan_type=body.plan_type,
        created_by=uuid.UUID(user_id),
    )
    db.add(plan)
    await db.commit()
    await db.refresh(plan)
    return {"id": str(plan.id), "name": plan.name, "plan_type": plan.plan_type}


# ── Price history ─────────────────────────────────────────────────────────────


def _fetch_week_closes(symbol: str, date_from: date, date_to: date) -> dict[str, float]:
    """Fetch daily closing prices for *symbol* over the [date_from, date_to] range.

    Uses yfinance with auto_adjust=False, back_adjust=False to return raw
    unadjusted closes.  The end date passed to yfinance is date_to + 1 day
    because yfinance treats the end parameter as exclusive.

    Returns a mapping of ISO-date string → rounded close price.
    Returns an empty dict when no data is available (holiday, delisted, etc.).
    """
    import pandas as pd
    import yfinance as yf

    end = date_to + timedelta(days=1)
    start_str = date_from.strftime("%Y-%m-%d")
    end_str = end.strftime("%Y-%m-%d")

    for ticker_sym in _ticker_sym(symbol, "SET"):
        try:
            hist = yf.Ticker(ticker_sym).history(
                start=start_str,
                end=end_str,
                interval="1d",
                auto_adjust=False,
                back_adjust=False,
            )
            if hist.empty:
                continue
            result: dict[str, float] = {}
            for dt in hist.index:
                # strftime on a tz-aware Timestamp formats in its own timezone (Bangkok),
                # producing the correct trading date regardless of UTC offset.
                date_key = pd.Timestamp(dt).strftime("%Y-%m-%d")
                result[date_key] = round(float(hist.loc[dt, "Close"]), 2)
            if result:
                return result
        except Exception:
            continue
    return {}


@router.get("/price-history")
async def get_price_history(
    _: UserId,
    symbols: str = Query(..., description="Comma-separated SET stock symbols, max 20"),
    date_from: str = Query(..., description="Week start date YYYY-MM-DD (Monday)"),
    date_to: str = Query(..., description="Week end date YYYY-MM-DD (Friday), must be exactly 4 days after date_from"),
) -> dict[str, Any]:
    """Return daily closing prices for a set of symbols over a trading week.

    Every requested symbol always appears in the ``prices`` map even when no
    data is available for that symbol (returned as an empty dict).  HTTP errors
    are only raised for validation failures (400) or authentication issues (401).
    Partial symbol failures yield an empty map for that symbol and are logged as
    warnings rather than errors.
    """
    # ── Validate symbols ──────────────────────────────────────────────────────
    raw_parts = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not raw_parts:
        raise HTTPException(status_code=400, detail="symbols must not be empty")
    if len(raw_parts) > _MAX_SYMBOLS:
        raise HTTPException(
            status_code=400,
            detail=f"symbols must not exceed {_MAX_SYMBOLS}; received {len(raw_parts)}",
        )
    for sym in raw_parts:
        if not _SYMBOL_RE.match(sym):
            raise HTTPException(
                status_code=400,
                detail=f"Invalid symbol '{sym}': must be 1-20 alphanumeric characters, dots, or hyphens",
            )
    # Deduplicate while preserving order
    seen: set[str] = set()
    raw_symbols: list[str] = []
    for sym in raw_parts:
        if sym not in seen:
            seen.add(sym)
            raw_symbols.append(sym)

    # ── Validate dates ────────────────────────────────────────────────────────
    try:
        d_from = date.fromisoformat(date_from)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"date_from '{date_from}' is not a valid YYYY-MM-DD date")
    try:
        d_to = date.fromisoformat(date_to)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"date_to '{date_to}' is not a valid YYYY-MM-DD date")
    if (d_to - d_from).days != 4:
        raise HTTPException(
            status_code=400,
            detail=f"date_to must be exactly 4 days after date_from; got {(d_to - d_from).days} day(s)",
        )

    # ── Fetch prices concurrently ─────────────────────────────────────────────
    loop = asyncio.get_running_loop()
    results = await asyncio.gather(
        *[loop.run_in_executor(None, _fetch_week_closes, sym, d_from, d_to) for sym in raw_symbols],
        return_exceptions=True,
    )

    prices: dict[str, dict[str, float]] = {}
    for sym, result in zip(raw_symbols, results):
        if isinstance(result, Exception):
            _log.warning("Failed to fetch price history for symbol", symbol=sym, error=str(result))
            prices[sym] = {}
        else:
            prices[sym] = result  # type: ignore[assignment]

    return {
        "date_from": date_from,
        "date_to": date_to,
        "prices": prices,
    }


@router.get("/{plan_id}")
async def get_plan(plan_id: uuid.UUID, user_id: UserId, db: DB) -> dict[str, Any]:
    plan = await _get_or_404(plan_id, user_id, db)
    return _plan_detail(plan)


# â”€â”€ Update plan â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.put("/{plan_id}")
async def update_plan(
    plan_id: uuid.UUID, body: ActionPlanUpdate, user_id: UserId, db: DB
) -> dict[str, str]:
    plan = await _get_or_404(plan_id, user_id, db)

    if body.name is not None:
        plan.name = body.name
    if body.notes is not None:
        plan.notes = body.notes or None
    if body.set_analysis is not None:
        plan.set_analysis = body.set_analysis or None
    if body.ai_recommend is not None:
        plan.ai_recommend = body.ai_recommend or None

    if body.purchase_items is not None:
        await db.execute(
            delete(PurchasePlanItem).where(PurchasePlanItem.plan_id == plan_id)
        )
        await db.flush()
        for i, item in enumerate(body.purchase_items):
            db.add(PurchasePlanItem(
                plan_id=plan_id,
                sort_order=i,
                stock=item.stock,
                current_price=item.current_price,
                size=item.size,
                buy_price=item.buy_price,
                tp=item.tp,
                sl=item.sl,
                strategy=item.strategy,
                reason=item.reason,
                triggered=item.triggered,
            ))

    if body.portfolio_items is not None:
        await db.execute(
            delete(PortfolioPlanItem).where(PortfolioPlanItem.plan_id == plan_id)
        )
        await db.flush()
        for i, item in enumerate(body.portfolio_items):
            db.add(PortfolioPlanItem(
                plan_id=plan_id,
                sort_order=i,
                symbol=item.symbol,
                current_price=item.current_price,
                size=item.size,
                entry_price=item.entry_price,
                tp=item.tp,
                sl=item.sl,
                order_size=item.order_size,
            ))

    # Explicitly stamp updated_at so the value is fresh even when only items changed
    await db.execute(
        text("UPDATE action_plans SET updated_at = NOW() WHERE id = :id"),
        {"id": plan_id},
    )
    await db.commit()
    return {"status": "ok"}


# â”€â”€ Delete plan â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.delete("/{plan_id}")
async def delete_plan(plan_id: uuid.UUID, user_id: UserId, db: DB) -> Response:
    plan = await _get_or_404(plan_id, user_id, db)
    await db.delete(plan)
    await db.commit()
    return Response(status_code=204)


# â”€â”€ Duplicate plan â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.post("/{plan_id}/duplicate", status_code=status.HTTP_201_CREATED)
async def duplicate_plan(
    plan_id: uuid.UUID,
    user_id: UserId,
    db: DB,
    new_name: str = Query(..., description="Name for the new plan"),
) -> dict[str, Any]:
    src = await _get_or_404(plan_id, user_id, db)
    uid = uuid.UUID(user_id)

    new_plan = ActionPlan(
        name=new_name,
        plan_type=src.plan_type,
        created_by=uid,
        notes=src.notes,
        set_analysis=src.set_analysis,
        ai_recommend=src.ai_recommend,
    )
    db.add(new_plan)
    await db.flush()  # populate new_plan.id before adding children

    for item in src.purchase_items:
        db.add(PurchasePlanItem(
            plan_id=new_plan.id,
            sort_order=item.sort_order,
            stock=item.stock,
            current_price=item.current_price,
            size=item.size,
            buy_price=item.buy_price,
            tp=item.tp,
            sl=item.sl,
            strategy=item.strategy,
            reason=item.reason,
            triggered=item.triggered,
        ))

    for item in src.portfolio_items:
        db.add(PortfolioPlanItem(
            plan_id=new_plan.id,
            sort_order=item.sort_order,
            symbol=item.symbol,
            current_price=item.current_price,
            size=item.size,
            entry_price=item.entry_price,
            tp=item.tp,
            sl=item.sl,
            order_size=item.order_size,
        ))

    await db.commit()
    return {"id": str(new_plan.id), "name": new_plan.name, "plan_type": new_plan.plan_type}
