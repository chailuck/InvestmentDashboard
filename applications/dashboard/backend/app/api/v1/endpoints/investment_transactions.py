"""Investment transaction endpoints — CASH_IN / CASH_OUT / ADJUST per portfolio."""

import uuid
from datetime import date as DateType
from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user_id
from app.database.session import get_db
from app.models.portfolio import InvestmentTransaction, Portfolio

router = APIRouter(prefix="/investment-transactions", tags=["Investment Transactions"])

UserId = Annotated[str, Depends(get_current_user_id)]
DB = Annotated[AsyncSession, Depends(get_db)]

VALID_ACTIONS = {"CASH_IN", "CASH_OUT", "ADJUST"}


# ── Schemas ──────────────────────────────────────────────────────────────────

class TransactionCreate(BaseModel):
    portfolio_id: str
    date: DateType
    action: str  # CASH_IN | CASH_OUT | ADJUST
    amount: float
    currency: str = "THB"
    note: Optional[str] = None


class TransactionUpdate(BaseModel):
    date: Optional[DateType] = None
    action: Optional[str] = None
    amount: Optional[float] = None
    currency: Optional[str] = None
    note: Optional[str] = None


def _serialize(t: InvestmentTransaction) -> dict[str, Any]:
    return {
        "id": str(t.id),
        "portfolio_id": str(t.portfolio_id),
        "user_id": str(t.user_id),
        "date": t.date.isoformat(),
        "action": t.action,
        "amount": float(t.amount),
        "currency": t.currency,
        "note": t.note,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
    }


async def _verify_portfolio(portfolio_id: str, user_id: str, db: AsyncSession) -> Portfolio:
    """Ensure the portfolio exists and belongs to this user."""
    pid = uuid.UUID(portfolio_id)
    uid = uuid.UUID(user_id)
    result = await db.execute(
        select(Portfolio).where(Portfolio.id == pid, Portfolio.user_id == uid)
    )
    p = result.scalar_one_or_none()
    if not p:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return p


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("")
async def list_transactions(
    user_id: UserId,
    db: DB,
    portfolio_id: Optional[str] = Query(None),
    from_date: Optional[DateType] = Query(None),
    to_date: Optional[DateType] = Query(None),
    action: Optional[str] = Query(None),
) -> dict[str, Any]:
    uid = uuid.UUID(user_id)
    q = select(InvestmentTransaction).where(InvestmentTransaction.user_id == uid)

    if portfolio_id:
        q = q.where(InvestmentTransaction.portfolio_id == uuid.UUID(portfolio_id))

    if from_date:
        q = q.where(InvestmentTransaction.date >= from_date)
    if to_date:
        q = q.where(InvestmentTransaction.date <= to_date)
    if action and action in VALID_ACTIONS:
        q = q.where(InvestmentTransaction.action == action)

    q = q.order_by(InvestmentTransaction.date.desc(), InvestmentTransaction.created_at.desc())
    result = await db.execute(q)
    transactions = result.scalars().all()

    total_cash_in = sum(float(t.amount) for t in transactions if t.action == "CASH_IN")
    total_cash_out = sum(float(t.amount) for t in transactions if t.action == "CASH_OUT")
    total_adjust = sum(float(t.amount) for t in transactions if t.action == "ADJUST")
    net_investment = total_cash_in - total_cash_out + total_adjust

    return {
        "transactions": [_serialize(t) for t in transactions],
        "total": len(transactions),
        "summary": {
            "total_cash_in": round(total_cash_in, 2),
            "total_cash_out": round(total_cash_out, 2),
            "total_adjust": round(total_adjust, 2),
            "net_investment": round(net_investment, 2),
        },
    }


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_transaction(body: TransactionCreate, user_id: UserId, db: DB) -> dict:
    if body.action not in VALID_ACTIONS:
        raise HTTPException(status_code=400, detail=f"Invalid action. Must be one of: {', '.join(sorted(VALID_ACTIONS))}")
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")

    await _verify_portfolio(body.portfolio_id, user_id, db)

    t = InvestmentTransaction(
        portfolio_id=uuid.UUID(body.portfolio_id),
        user_id=uuid.UUID(user_id),
        date=body.date,
        action=body.action,
        amount=body.amount,
        currency=body.currency,
        note=body.note,
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return _serialize(t)


@router.put("/{transaction_id}")
async def update_transaction(transaction_id: str, body: TransactionUpdate, user_id: UserId, db: DB) -> dict:
    uid = uuid.UUID(user_id)
    tid = uuid.UUID(transaction_id)
    result = await db.execute(
        select(InvestmentTransaction).where(
            InvestmentTransaction.id == tid,
            InvestmentTransaction.user_id == uid,
        )
    )
    t = result.scalar_one_or_none()
    if not t:
        raise HTTPException(status_code=404, detail="Transaction not found")

    fields_set = body.model_fields_set
    if "date" in fields_set and body.date is not None:
        t.date = body.date
    if "action" in fields_set and body.action is not None:
        if body.action not in VALID_ACTIONS:
            raise HTTPException(status_code=400, detail=f"Invalid action. Must be one of: {', '.join(sorted(VALID_ACTIONS))}")
        t.action = body.action
    if "amount" in fields_set and body.amount is not None:
        if body.amount <= 0:
            raise HTTPException(status_code=400, detail="Amount must be positive")
        t.amount = body.amount
    if "currency" in fields_set and body.currency is not None:
        t.currency = body.currency
    if "note" in fields_set:
        t.note = body.note  # allow explicit null to clear the note

    await db.commit()
    await db.refresh(t)
    return _serialize(t)


@router.delete("/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_transaction(transaction_id: str, user_id: UserId, db: DB) -> Response:
    uid = uuid.UUID(user_id)
    tid = uuid.UUID(transaction_id)
    result = await db.execute(
        select(InvestmentTransaction).where(
            InvestmentTransaction.id == tid,
            InvestmentTransaction.user_id == uid,
        )
    )
    t = result.scalar_one_or_none()
    if not t:
        raise HTTPException(status_code=404, detail="Transaction not found")
    await db.delete(t)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
