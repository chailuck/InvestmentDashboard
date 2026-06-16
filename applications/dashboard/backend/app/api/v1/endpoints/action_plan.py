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


import uuid
from datetime import date, datetime, timezone
from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.dependencies import get_current_user_id
from app.database.session import get_db
from app.models.action_plan import ActionPlan, PortfolioPlanItem, PurchasePlanItem
from app.schemas.action_plan import ActionPlanCreate, ActionPlanUpdate

router = APIRouter(prefix="/action-plans", tags=["Action Plans"])

UserId = Annotated[str, Depends(get_current_user_id)]
DB = Annotated[AsyncSession, Depends(get_db)]


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


# â”€â”€ Get plan â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
