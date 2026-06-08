"""Portfolio management endpoints — CRUD for user portfolios."""

from __future__ import annotations

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user_id
from app.database.session import get_db
from app.models.portfolio import Portfolio

router = APIRouter(prefix="/portfolios", tags=["Portfolios"])

UserId = Annotated[str, Depends(get_current_user_id)]
DB = Annotated[AsyncSession, Depends(get_db)]


# ── Schemas ──────────────────────────────────────────────────────────────────

class PortfolioCreate(BaseModel):
    name: str
    portfolio_mode: str = "excel"
    excel_source_path: str | None = None
    excel_working_path: str | None = None
    description: str | None = None


class PortfolioUpdate(BaseModel):
    name: str | None = None
    portfolio_mode: str | None = None
    excel_source_path: str | None = None
    excel_working_path: str | None = None
    description: str | None = None
    sort_order: int | None = None


def _serialize(p: Portfolio) -> dict[str, Any]:
    return {
        "id": str(p.id),
        "name": p.name,
        "description": p.description,
        "is_default": p.is_default,
        "portfolio_mode": p.portfolio_mode,
        "excel_source_path": p.excel_source_path,
        "excel_working_path": p.excel_working_path,
        "sort_order": p.sort_order,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


async def _get_or_404(portfolio_id: str, user_id: str, db: AsyncSession) -> Portfolio:
    pid = uuid.UUID(portfolio_id)
    uid = uuid.UUID(user_id)
    result = await db.execute(
        select(Portfolio).where(Portfolio.id == pid, Portfolio.user_id == uid)
    )
    p = result.scalar_one_or_none()
    if not p:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Portfolio not found")
    return p


async def get_default_portfolio(user_id: str, db: AsyncSession) -> Portfolio | None:
    """Return the user's default portfolio, or None if user has no portfolios."""
    uid = uuid.UUID(user_id)
    result = await db.execute(
        select(Portfolio).where(Portfolio.user_id == uid, Portfolio.is_default == True)  # noqa: E712
    )
    p = result.scalar_one_or_none()
    if p:
        return p
    # Fallback: any portfolio
    result = await db.execute(
        select(Portfolio).where(Portfolio.user_id == uid).order_by(Portfolio.sort_order, Portfolio.created_at)
    )
    return result.scalar_one_or_none()


async def get_portfolio_by_id_or_default(portfolio_id: str | None, user_id: str, db: AsyncSession) -> Portfolio | None:
    """Resolve portfolio_id to a Portfolio row; fall back to user's default."""
    if portfolio_id:
        try:
            return await _get_or_404(portfolio_id, user_id, db)
        except HTTPException:
            pass
    return await get_default_portfolio(user_id, db)


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("")
async def list_portfolios(user_id: UserId, db: DB) -> list[dict]:
    uid = uuid.UUID(user_id)
    result = await db.execute(
        select(Portfolio)
        .where(Portfolio.user_id == uid)
        .order_by(Portfolio.sort_order, Portfolio.created_at)
    )
    portfolios = result.scalars().all()
    return [_serialize(p) for p in portfolios]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_portfolio(body: PortfolioCreate, user_id: UserId, db: DB) -> dict:
    uid = uuid.UUID(user_id)

    # Check name uniqueness
    existing = await db.execute(
        select(Portfolio).where(Portfolio.user_id == uid, Portfolio.name == body.name.strip())
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail=f"Portfolio '{body.name}' already exists")

    # First portfolio for this user is always default
    count_result = await db.execute(select(Portfolio).where(Portfolio.user_id == uid))
    is_first = count_result.scalar_one_or_none() is None

    p = Portfolio(
        user_id=uid,
        name=body.name.strip(),
        is_default=is_first,
        portfolio_mode=body.portfolio_mode,
        excel_source_path=body.excel_source_path,
        excel_working_path=body.excel_working_path,
        description=body.description,
        sort_order=0,
    )
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return _serialize(p)


@router.put("/{portfolio_id}")
async def update_portfolio(portfolio_id: str, body: PortfolioUpdate, user_id: UserId, db: DB) -> dict:
    p = await _get_or_404(portfolio_id, user_id, db)
    if body.name is not None:
        # Check uniqueness
        uid = uuid.UUID(user_id)
        dup = await db.execute(
            select(Portfolio).where(
                Portfolio.user_id == uid,
                Portfolio.name == body.name.strip(),
                Portfolio.id != p.id,
            )
        )
        if dup.scalar_one_or_none():
            raise HTTPException(status_code=400, detail=f"Portfolio '{body.name}' already exists")
        p.name = body.name.strip()
    if body.portfolio_mode is not None:
        p.portfolio_mode = body.portfolio_mode
    if body.excel_source_path is not None:
        p.excel_source_path = body.excel_source_path
    if body.excel_working_path is not None:
        p.excel_working_path = body.excel_working_path
    if body.description is not None:
        p.description = body.description
    if body.sort_order is not None:
        p.sort_order = body.sort_order
    await db.commit()
    await db.refresh(p)
    return _serialize(p)


@router.delete("/{portfolio_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_portfolio(portfolio_id: str, user_id: UserId, db: DB) -> Response:
    p = await _get_or_404(portfolio_id, user_id, db)
    uid = uuid.UUID(user_id)

    # Count remaining portfolios
    count_result = await db.execute(select(Portfolio).where(Portfolio.user_id == uid))
    all_portfolios = count_result.scalars().all()
    if len(all_portfolios) <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete the only portfolio")
    if p.is_default:
        raise HTTPException(status_code=400, detail="Cannot delete the default portfolio. Set another as default first.")

    await db.delete(p)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/{portfolio_id}/set-default")
async def set_default_portfolio(portfolio_id: str, user_id: UserId, db: DB) -> dict:
    uid = uuid.UUID(user_id)
    p = await _get_or_404(portfolio_id, user_id, db)

    # Clear existing default
    existing_default = await db.execute(
        select(Portfolio).where(Portfolio.user_id == uid, Portfolio.is_default == True)  # noqa: E712
    )
    for old in existing_default.scalars().all():
        old.is_default = False

    p.is_default = True
    await db.commit()
    await db.refresh(p)
    return _serialize(p)
