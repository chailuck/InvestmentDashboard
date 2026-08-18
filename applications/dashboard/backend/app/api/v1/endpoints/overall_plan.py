"""Overall Plan report generator.

Endpoints
---------
POST /overall-plan/generate → aggregate 5 existing data domains (purchase
action plan, active portfolio-DB positions, a referenced weekly scan, the
last-2-weeks Objective/Portfolio Action Review, and the last 10 daily
performance snapshots) into a single markdown report and write it to a file
inside the container.

The portfolio used for sections 2 and 4 is always the caller's default
portfolio (resolved server-side) — there is no portfolio_id in the request.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints.daily_performance import list_daily_performance
from app.api.v1.endpoints.objective import list_objective_positions
from app.api.v1.endpoints.portfolio_db import list_positions_db
from app.api.v1.endpoints.portfolios import get_default_portfolio
from app.auth.dependencies import get_current_user_id
from app.core.logging import get_logger
from app.database.session import get_db
from app.models.action_plan import ActionPlan
from app.models.weekly_scan import WeeklyScan
from app.services.overall_plan_markdown import build_overall_plan_markdown
from app.services.week_dates import BANGKOK, display_week_range

router = APIRouter(prefix="/overall-plan", tags=["Overall Plan"])

UserId = Annotated[str, Depends(get_current_user_id)]
DB = Annotated[AsyncSession, Depends(get_db)]

_log = get_logger("overall_plan")

# Mirrors backup.py's BACKUP_DIR convention: a module-level Path constant,
# eagerly created so the directory is guaranteed to exist before the first
# request. This module is the only writer of files under this directory.
VAULT_WEEKLYPLAN_DIR = Path("/app/vault_investment_raw/Weeklyplan")
VAULT_WEEKLYPLAN_DIR.mkdir(parents=True, exist_ok=True)


# ── Schemas ──────────────────────────────────────────────────────────────────

class OverallPlanRequest(BaseModel):
    action_plan_id: uuid.UUID
    weekly_scan_id: uuid.UUID


# ── Helpers ──────────────────────────────────────────────────────────────────

def _f(v: Decimal | float | None) -> float | None:
    """Decimal / None → float / None (safe for JSON and markdown formatting)."""
    return float(v) if v is not None else None


async def _get_purchase_plan_or_404(plan_id: uuid.UUID, user_id: str, db: AsyncSession) -> ActionPlan:
    """Fetch + ownership-check an ActionPlan, requiring plan_type == 'purchase'.

    Mirrors the ownership-check pattern in action_plan.py's _get_or_404 (~line
    66), but adds the purchase-type constraint and this feature's own 404
    message per the approved contract.
    """
    uid = uuid.UUID(user_id)
    result = await db.execute(
        select(ActionPlan)
        .where(ActionPlan.id == plan_id, ActionPlan.created_by == uid)
        .options(selectinload(ActionPlan.purchase_items))
    )
    plan = result.scalar_one_or_none()
    if not plan or plan.plan_type != "purchase":
        raise HTTPException(status_code=404, detail="Purchase plan not found")
    return plan


async def _get_weekly_scan_or_404(scan_id: uuid.UUID, user_id: str, db: AsyncSession) -> WeeklyScan:
    """Fetch + ownership-check a WeeklyScan.

    Mirrors the ownership-check pattern used throughout weekly_scan.py
    (~line 475 onward), e.g. get_scan / delete_scan / week-prices.
    """
    uid = uuid.UUID(user_id)
    scan = await db.scalar(
        select(WeeklyScan)
        .where(WeeklyScan.id == scan_id, WeeklyScan.user_id == uid)
        .options(selectinload(WeeklyScan.items))
    )
    if scan is None:
        raise HTTPException(status_code=404, detail="Weekly scan not found")
    return scan


def _plan_to_dict(plan: ActionPlan) -> dict[str, Any]:
    """Project an ActionPlan (+ purchase_items) into the plain dict shape
    expected by overall_plan_markdown.build_overall_plan_markdown()."""
    return {
        "name": plan.name,
        "notes": plan.notes,
        "set_analysis": plan.set_analysis,
        "ai_recommend": plan.ai_recommend,
        "items": [
            {
                "sort_order": item.sort_order,
                "stock": item.stock,
                "strategy": item.strategy,
                "buy_price": _f(item.buy_price),
                "tp": _f(item.tp),
                "sl": _f(item.sl),
                "size": item.size,
                "current_price": _f(item.current_price),
                "triggered": item.triggered,
                "reason": item.reason,
            }
            for item in plan.purchase_items
        ],
    }


def _scan_to_dict(scan: WeeklyScan) -> dict[str, Any]:
    """Project a WeeklyScan (+ items) into the plain dict shape expected by
    overall_plan_markdown.build_overall_plan_markdown().

    Uses the NEW display_week_range(scan.created_at) helper for the header
    date range — NOT weekly_scan.py's _parse_week_dates(), which answers a
    different question (Monday/Friday of the scan's own name) for the
    existing week-prices consumer and must not be touched.
    """
    monday, sunday, week_no = display_week_range(scan.created_at)
    return {
        "name": scan.name,
        "monday": monday,
        "sunday": sunday,
        "week_number": week_no,
        "items": [
            {
                "symbol": item.symbol,
                "list_name": item.list_name,
                "strategy": item.strategy,
                "buy_price": _f(item.buy_price),
                "tp": _f(item.tp),
                "sl": _f(item.sl),
                "size": item.size,
                "remark": item.remark,
                "color_mark": item.color_mark,
            }
            for item in scan.items
        ],
    }


# ── Endpoint ─────────────────────────────────────────────────────────────────

@router.post("/generate")
async def generate_overall_plan(
    body: OverallPlanRequest,
    user_id: UserId,
    db: DB,
) -> dict[str, Any]:
    """Aggregate the purchase action plan, active portfolio-DB positions, the
    referenced weekly scan, and the last-2-weeks Objective review into a
    single markdown report and persist it to disk.

    The filename and generation timestamp are always server-derived from the
    current Bangkok date/time — never taken from the request body.
    """
    now_bkk = datetime.now(BANGKOK)

    plan = await _get_purchase_plan_or_404(body.action_plan_id, user_id, db)
    scan = await _get_weekly_scan_or_404(body.weekly_scan_id, user_id, db)

    portfolio = await get_default_portfolio(user_id, db)
    if portfolio is None:
        raise HTTPException(
            status_code=422,
            detail="No default portfolio configured. Create a portfolio before generating an overall plan.",
        )

    positions_result = await list_positions_db(
        user_id, db, status_filter="active", portfolio_id=str(portfolio.id)
    )
    objective_result = await list_objective_positions(
        user_id=user_id, db=db, portfolio_id=str(portfolio.id), week2=True
    )
    daily_performance_records = await list_daily_performance(
        user_id, db, date_from=now_bkk.date() - timedelta(days=60), date_to=now_bkk.date(),
        portfolio_id=portfolio.id,
    )
    daily_performance_last10 = daily_performance_records[-10:]

    date_str = now_bkk.strftime("%Y%m%d")

    md = build_overall_plan_markdown(
        date_str=date_str,
        generated_at=now_bkk,
        plan=_plan_to_dict(plan),
        positions=positions_result["positions"],
        scan=_scan_to_dict(scan),
        review_items=[item.model_dump() for item in objective_result.items],
        daily_performance=daily_performance_last10,
    )

    filename = f"OVERALL PLAN {date_str}.md"
    target_path = VAULT_WEEKLYPLAN_DIR / filename
    resolved_target = target_path.resolve()

    # Defense-in-depth: filename is 100% server-derived (never from the
    # request body) so this should be unreachable, but Gate 4's security
    # design requires the check regardless.
    if resolved_target.parent != VAULT_WEEKLYPLAN_DIR.resolve():
        _log.error(
            "overall_plan.path_escape_blocked",
            resolved_target=str(resolved_target),
            expected_parent=str(VAULT_WEEKLYPLAN_DIR.resolve()),
        )
        raise HTTPException(status_code=500, detail="Failed to write overall plan file")

    tmp_path = resolved_target.with_name(f"{resolved_target.name}.tmp-{uuid.uuid4().hex}")
    try:
        tmp_path.write_text(md, encoding="utf-8")
        os.replace(tmp_path, resolved_target)
    except OSError:
        _log.error(
            "overall_plan.write_failed",
            path=str(resolved_target),
            exc_info=True,
        )
        tmp_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail="Failed to write overall plan file")

    _log.info(
        "overall_plan.generated",
        user_id=user_id,
        action_plan_id=str(plan.id),
        weekly_scan_id=str(scan.id),
        portfolio_id=str(portfolio.id),
        filename=filename,
    )

    return {
        "filename": filename,
        "path": str(resolved_target),
        "written_at": now_bkk.isoformat(),
        "action_plan_id": str(plan.id),
        "action_plan_name": plan.name,
        "weekly_scan_id": str(scan.id),
        "weekly_scan_name": scan.name,
        "portfolio_id": str(portfolio.id),
        "portfolio_name": portfolio.name,
    }
