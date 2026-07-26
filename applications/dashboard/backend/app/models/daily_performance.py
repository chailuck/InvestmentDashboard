"""SQLAlchemy model for the daily_performance table.

Each row captures a point-in-time snapshot of a single portfolio for a
calendar day: capital deployed, realised P&L on closed positions, and
unrealised P&L on open positions at the time the snapshot was taken.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database.session import Base


class DailyPerformance(Base):
    """Daily performance snapshot for a single portfolio on a single calendar date.

    The (portfolio_id, date) pair is unique — upserting with ON CONFLICT DO
    UPDATE allows the scheduled job to run idempotently for the same trading
    day.  user_id is retained as a denormalised FK for audit and direct user
    queries without a join.

    Columns
    -------
    portfolio_id    FK → portfolios.id (CASCADE DELETE).  Scopes the snapshot
                    to a specific portfolio rather than the entire user account.
    investment      Total capital deployed across ALL positions (active + closed)
                    within the portfolio that had entry_date <= snapshot date.
    closed_pnl      Sum of net P&L for positions closed on or before the
                    snapshot date.
    closed_pnl_pct  closed_pnl expressed as a percentage of total investment.
    open_pnl        Unrealised P&L of active positions using live prices fetched
                    at snapshot time.
    open_pnl_pct    open_pnl expressed as a percentage of total investment.
    open_positions  JSONB list of {symbol, pnl, pnl_pct} for each active
                    position, enabling per-stock breakdown on the frontend.
    """

    __tablename__ = "daily_performance"
    __table_args__ = (
        UniqueConstraint("portfolio_id", "date", name="uq_daily_performance_portfolio_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    portfolio_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("portfolios.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    investment: Mapped[float] = mapped_column(
        Numeric(16, 2), nullable=False, default=0
    )
    closed_pnl: Mapped[float] = mapped_column(
        Numeric(16, 2), nullable=False, default=0
    )
    closed_pnl_pct: Mapped[float] = mapped_column(
        Numeric(8, 4), nullable=False, default=0
    )
    open_pnl: Mapped[float] = mapped_column(
        Numeric(16, 2), nullable=False, default=0
    )
    open_pnl_pct: Mapped[float] = mapped_column(
        Numeric(8, 4), nullable=False, default=0
    )
    # List of {symbol, buy_price, close_price, pnl, pnl_pct} — nullable when
    # no active positions exist for the portfolio on the snapshot date.
    # buy_price and close_price were added in migration c3d4e5f6a7b8; rows
    # created before that migration carry only {symbol, pnl, pnl_pct}.
    open_positions: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    # Positions opened on the snapshot date: entry_date == snapshot_date.
    # Schema: [{symbol, buy_price, close_price, pnl, pnl_pct}]
    purchased_positions: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    # Positions closed on the snapshot date: exit_date == snapshot_date.
    # Schema: [{symbol, buy_price, close_price, pnl, pnl_pct}]
    # close_price = exit_price (the price at which the position was sold).
    sold_positions: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    # Accumulated realised P&L: running sum of sold-position P&L from the
    # earliest backfill date through this snapshot date.  Null for rows created
    # before migration d4e5f6a7b8c9 was applied.
    acc_pnl: Mapped[float | None] = mapped_column(Numeric(18, 4), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
