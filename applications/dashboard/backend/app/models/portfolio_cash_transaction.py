"""SQLAlchemy model for the portfolio_cash_transactions table.

Each row records a single cash movement into or out of a portfolio.
The running cumulative SUM of amount WHERE date <= snapshot_date is used
as the ``investment`` figure in daily_performance snapshots, replacing the
previous cost-basis computation.

Columns
-------
portfolio_id  FK → portfolios.id (CASCADE DELETE).  Ties the transaction to
              a specific portfolio owned by the user.
date          The calendar date on which the cash movement occurred.
amount        Positive values represent deposits (cash in), negative values
              represent withdrawals (cash out).  NUMERIC(16,2) for precision.
note          Optional free-text description (e.g. "Initial deposit", "Monthly DCA").
created_at    Server-side creation timestamp.  Immutable after insert.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database.session import Base


class PortfolioCashTransaction(Base):
    """A single cash deposit or withdrawal for a portfolio."""

    __tablename__ = "portfolio_cash_transactions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    portfolio_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("portfolios.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    date: Mapped[date] = mapped_column(Date, nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(16, 2), nullable=False)
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
