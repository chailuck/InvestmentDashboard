"""Portfolio Cash Transactions endpoints.

Provides full CRUD for the portfolio_cash_transactions table.  Each transaction
records a single cash movement (deposit or withdrawal) for a portfolio.  The
cumulative SUM of amounts up to any given date is used as the ``investment``
figure in daily_performance snapshots.

Routes
------
  GET    /portfolio-cash-transactions?portfolio_id=<uuid>  — list, date asc
  POST   /portfolio-cash-transactions                       — create
  PUT    /portfolio-cash-transactions/{id}                  — update amount/note
  DELETE /portfolio-cash-transactions/{id}                  — delete
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user_id
from app.core.logging import get_logger
from app.database.session import get_db
from app.models.portfolio import Portfolio
from app.models.portfolio_cash_transaction import PortfolioCashTransaction

_log = get_logger("portfolio_cash_transactions.endpoint")

router = APIRouter(
    prefix="/portfolio-cash-transactions",
    tags=["portfolio-cash-transactions"],
)

UserId = Annotated[str, Depends(get_current_user_id)]
DB = Annotated[AsyncSession, Depends(get_db)]


# ── Schemas ───────────────────────────────────────────────────────────────────

class CashTransactionCreate(BaseModel):
    """Body for creating a new cash transaction."""

    portfolio_id: uuid.UUID
    date: date
    amount: float
    note: Optional[str] = None


class CashTransactionUpdate(BaseModel):
    """Partial body for updating an existing cash transaction.

    Only amount and note may be changed after creation.  The date is immutable
    so that the historical investment calculation remains stable.
    """

    amount: Optional[float] = None
    note: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _serialize_tx(tx: PortfolioCashTransaction) -> dict[str, Any]:
    """Convert an ORM row to a JSON-safe dict."""
    return {
        "id": str(tx.id),
        "portfolio_id": str(tx.portfolio_id),
        "date": tx.date.isoformat() if tx.date else None,
        "amount": float(tx.amount) if tx.amount is not None else 0.0,
        "note": tx.note,
        "created_at": tx.created_at.isoformat() if tx.created_at else None,
    }


async def _require_portfolio_ownership(
    db: AsyncSession,
    portfolio_id: uuid.UUID,
    user_id: str,
) -> Portfolio:
    """Load the portfolio and verify ownership.

    Raises:
        HTTPException 404: Portfolio not found.
        HTTPException 403: Portfolio belongs to a different user.
    """
    result = await db.execute(select(Portfolio).where(Portfolio.id == portfolio_id))
    portfolio = result.scalar_one_or_none()
    if portfolio is None:
        raise HTTPException(status_code=404, detail="Portfolio not found.")
    if str(portfolio.user_id) != user_id:
        raise HTTPException(
            status_code=403,
            detail="Portfolio does not belong to the authenticated user.",
        )
    return portfolio


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("", response_model=list[dict])
async def list_cash_transactions(
    user_id: UserId,
    db: DB,
    portfolio_id: uuid.UUID = Query(..., description="Portfolio UUID (required)."),
) -> list[dict[str, Any]]:
    """List all cash transactions for a portfolio, ordered by date ascending.

    Args:
        user_id:      Injected from the JWT bearer token.
        db:           Async DB session.
        portfolio_id: Required portfolio UUID.

    Returns:
        List of serialised PortfolioCashTransaction records.

    Raises:
        403: Portfolio does not belong to the authenticated user.
        404: Portfolio not found.
    """
    await _require_portfolio_ownership(db, portfolio_id, user_id)

    q = (
        select(PortfolioCashTransaction)
        .where(PortfolioCashTransaction.portfolio_id == portfolio_id)
        .order_by(PortfolioCashTransaction.date.asc())
    )
    result = await db.execute(q)
    rows = result.scalars().all()

    _log.info(
        "cash_transactions.list",
        user_id=user_id,
        portfolio_id=str(portfolio_id),
        count=len(rows),
    )
    return [_serialize_tx(r) for r in rows]


@router.post("", response_model=dict, status_code=201)
async def create_cash_transaction(
    body: CashTransactionCreate,
    user_id: UserId,
    db: DB,
) -> dict[str, Any]:
    """Create a new cash transaction for a portfolio.

    Args:
        body:    Transaction details: portfolio_id, date, amount, note.
        user_id: Injected from the JWT bearer token.
        db:      Async DB session.

    Returns:
        Serialised new PortfolioCashTransaction record.

    Raises:
        403: Portfolio does not belong to the authenticated user.
        404: Portfolio not found.
    """
    await _require_portfolio_ownership(db, body.portfolio_id, user_id)

    tx = PortfolioCashTransaction(
        id=uuid.uuid4(),
        portfolio_id=body.portfolio_id,
        date=body.date,
        amount=body.amount,
        note=body.note,
    )
    db.add(tx)
    await db.commit()
    await db.refresh(tx)

    _log.info(
        "cash_transactions.created",
        user_id=user_id,
        portfolio_id=str(body.portfolio_id),
        date=body.date.isoformat(),
        amount=body.amount,
    )
    return _serialize_tx(tx)


@router.put("/{tx_id}", response_model=dict)
async def update_cash_transaction(
    tx_id: uuid.UUID,
    body: CashTransactionUpdate,
    user_id: UserId,
    db: DB,
) -> dict[str, Any]:
    """Update the amount or note of an existing cash transaction.

    The date is immutable — create a new transaction if the date was wrong,
    then delete the incorrect one.

    Args:
        tx_id:   UUID of the transaction to update.
        body:    Partial update: amount and/or note.
        user_id: Injected from the JWT bearer token.
        db:      Async DB session.

    Returns:
        Serialised updated record.

    Raises:
        403: Portfolio does not belong to the authenticated user.
        404: Transaction not found.
    """
    result = await db.execute(
        select(PortfolioCashTransaction).where(PortfolioCashTransaction.id == tx_id)
    )
    tx = result.scalar_one_or_none()
    if tx is None:
        raise HTTPException(status_code=404, detail="Cash transaction not found.")

    await _require_portfolio_ownership(db, tx.portfolio_id, user_id)

    if body.amount is not None:
        tx.amount = body.amount  # type: ignore[assignment]
    if body.note is not None:
        tx.note = body.note

    await db.commit()
    await db.refresh(tx)

    _log.info(
        "cash_transactions.updated",
        user_id=user_id,
        tx_id=str(tx_id),
        fields={k for k, v in body.model_dump().items() if v is not None},
    )
    return _serialize_tx(tx)


@router.delete("/{tx_id}", status_code=204, response_class=Response)
async def delete_cash_transaction(
    tx_id: uuid.UUID,
    user_id: UserId,
    db: DB,
) -> Response:
    """Delete a cash transaction.

    Args:
        tx_id:   UUID of the transaction to delete.
        user_id: Injected from the JWT bearer token.
        db:      Async DB session.

    Raises:
        403: Portfolio does not belong to the authenticated user.
        404: Transaction not found.
    """
    result = await db.execute(
        select(PortfolioCashTransaction).where(PortfolioCashTransaction.id == tx_id)
    )
    tx = result.scalar_one_or_none()
    if tx is None:
        raise HTTPException(status_code=404, detail="Cash transaction not found.")

    await _require_portfolio_ownership(db, tx.portfolio_id, user_id)

    await db.delete(tx)
    await db.commit()

    _log.info("cash_transactions.deleted", user_id=user_id, tx_id=str(tx_id))
    return Response(status_code=204)
