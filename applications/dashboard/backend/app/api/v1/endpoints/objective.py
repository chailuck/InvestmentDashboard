"""Objective tab endpoints — read/annotate portfolio positions for decision journaling."""

from __future__ import annotations

import uuid
from datetime import date as date_type
from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import and_, case, desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user_id
from app.database.session import get_db
from app.models.portfolio_db import PortfolioDbPosition

router = APIRouter(prefix="/objective", tags=["Objective"])

UserId = Annotated[str, Depends(get_current_user_id)]
DB = Annotated[AsyncSession, Depends(get_db)]


# ── Schemas ────────────────────────────────────────────────────────────────────

class ObjectivePositionResponse(BaseModel):
    id: str
    symbol: str
    direction: str
    entry_date: Optional[date_type]
    entry_price: Optional[float]
    position_size: Optional[int]
    sl: Optional[float]
    tp: Optional[float]
    status: str
    exit_date: Optional[date_type]
    exit_price: Optional[float]
    remarks: Optional[str]
    reason: Optional[str]
    feel: Optional[int]
    sell_reason: Optional[str]
    sell_feel: Optional[int]
    portfolio_id: Optional[str]

    model_config = {"from_attributes": True}


class ObjectiveListResponse(BaseModel):
    items: List[ObjectivePositionResponse]
    total: int


class ObjectivePositionPatch(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=5000)
    feel: Optional[int] = Field(default=None)

    @field_validator("feel", mode="before")
    @classmethod
    def validate_feel(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and v not in (1, 2, 4, 5):
            raise ValueError("feel must be 1, 2, 4, or 5")
        return v

    sell_reason: Optional[str] = Field(default=None, max_length=5000)
    sell_feel: Optional[int] = Field(default=None)

    @field_validator("sell_feel", mode="before")
    @classmethod
    def validate_sell_feel(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and v not in (1, 2, 4, 5):
            raise ValueError("sell_feel must be 1, 2, 4, or 5")
        return v


# ── Helpers ───────────────────────────────────────────────────────────────────

def _to_response(r: PortfolioDbPosition) -> ObjectivePositionResponse:
    return ObjectivePositionResponse(
        id=str(r.id),
        symbol=r.symbol,
        direction=r.direction,
        entry_date=r.entry_date,
        entry_price=float(r.entry_price) if r.entry_price is not None else None,
        position_size=r.position_size,
        sl=float(r.sl) if r.sl is not None else None,
        tp=float(r.tp) if r.tp is not None else None,
        status=r.status,
        exit_date=r.exit_date,
        exit_price=float(r.exit_price) if r.exit_price is not None else None,
        remarks=r.remarks,
        reason=r.reason,
        feel=r.feel,
        sell_reason=r.sell_reason,
        sell_feel=r.sell_feel,
        portfolio_id=str(r.portfolio_id) if r.portfolio_id else None,
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("", response_model=ObjectiveListResponse)
async def list_objective_positions(
    user_id: UserId,
    db: DB,
    portfolio_id: Optional[str] = Query(None),
    months: Optional[int] = Query(None, ge=1, le=24),
    no_reason_only: bool = Query(False),
    week: bool = Query(False),
    week2: bool = Query(False),
) -> ObjectiveListResponse:
    """
    List portfolio positions for the Objective tab.

    Sorting: open positions (exit_date IS NULL) always appear first, then by
    entry_date DESC (nulls last) within each group.

    Filtering:
    - week=true       → entry_date in current Mon–today, OR position still open
    - week2=true      → entry_date in past-two-weeks window, OR position still open
    - months=1|3|6    → entry_date >= today - N months, OR position still open
    - months omitted  → ALL
    - no_reason_only=true → reason IS NULL OR reason = '' (ignores date filters)
    """
    from dateutil.relativedelta import relativedelta

    uid = uuid.UUID(user_id)
    conditions: list = [PortfolioDbPosition.user_id == uid]

    if portfolio_id:
        conditions.append(
            or_(
                PortfolioDbPosition.portfolio_id == uuid.UUID(portfolio_id),
                PortfolioDbPosition.portfolio_id.is_(None),
            )
        )

    if no_reason_only:
        conditions.append(
            or_(
                PortfolioDbPosition.reason.is_(None),
                PortfolioDbPosition.reason == "",
            )
        )
    elif week:
        from datetime import timedelta
        today = date_type.today()
        monday = today - timedelta(days=today.weekday())
        conditions.append(
            or_(
                PortfolioDbPosition.exit_date.is_(None),
                and_(
                    PortfolioDbPosition.entry_date >= monday,
                    PortfolioDbPosition.entry_date <= today,
                ),
            )
        )
    elif week2:
        from datetime import timedelta
        today = date_type.today()
        monday = today - timedelta(days=today.weekday())
        from_date = monday - timedelta(days=14)
        conditions.append(
            or_(
                PortfolioDbPosition.exit_date.is_(None),
                and_(
                    PortfolioDbPosition.entry_date >= from_date,
                    PortfolioDbPosition.entry_date <= today,
                ),
            )
        )
    elif months is not None:
        cutoff = date_type.today() - relativedelta(months=months)
        conditions.append(
            or_(
                PortfolioDbPosition.exit_date.is_(None),
                PortfolioDbPosition.entry_date >= cutoff,
            )
        )

    stmt = (
        select(PortfolioDbPosition)
        .where(and_(*conditions))
        .order_by(
            case((PortfolioDbPosition.exit_date.is_(None), 0), else_=1).asc(),
            desc(PortfolioDbPosition.entry_date).nullslast(),
        )
    )

    result = await db.execute(stmt)
    rows = result.scalars().all()
    items = [_to_response(r) for r in rows]

    return ObjectiveListResponse(items=items, total=len(items))


@router.patch("/{position_id}", response_model=ObjectivePositionResponse)
async def patch_objective_position(
    position_id: str,
    payload: ObjectivePositionPatch,
    user_id: UserId,
    db: DB,
) -> ObjectivePositionResponse:
    """
    Partial update of reason, feel, sell_reason, and/or sell_feel on a single position.
    Called by the auto-save on-blur handler in the frontend.
    Sending null explicitly clears the field.
    """
    uid = uuid.UUID(user_id)
    pid = uuid.UUID(position_id)

    result = await db.execute(
        select(PortfolioDbPosition).where(
            and_(
                PortfolioDbPosition.id == pid,
                PortfolioDbPosition.user_id == uid,
            )
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Position {position_id} not found or does not belong to this user.",
        )

    # Apply fields from payload — use model_fields_set to detect explicit nulls
    if "reason" in payload.model_fields_set:
        row.reason = payload.reason
    if "feel" in payload.model_fields_set:
        row.feel = payload.feel
    if "sell_reason" in payload.model_fields_set:
        row.sell_reason = payload.sell_reason
    if "sell_feel" in payload.model_fields_set:
        row.sell_feel = payload.sell_feel

    await db.commit()
    await db.refresh(row)
    return _to_response(row)
