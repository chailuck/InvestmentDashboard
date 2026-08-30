from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database.session import Base


class InitialInvestmentEntry(Base):
    """`ft_initial_investment_entry` — a signed ledger entry against a
    TrackingItem. Positive amount = increase, negative = decrease. Zero is
    rejected (a no-op entry has no meaning in a ledger).

    NOTE: index names below are explicit (`ix_ft_entry_*`) rather than the
    SQLAlchemy auto-generated `ix_ft_initial_investment_entry_*` — the
    approved design specifies the shorter `ft_entry` prefix for this table's
    indexes specifically, so `index=True` is intentionally NOT used on the
    FK column here (it would produce the wrong, longer auto-generated name).
    """

    __tablename__ = "ft_initial_investment_entry"
    __table_args__ = (
        CheckConstraint("amount <> 0", name="ck_ft_entry_amount_nonzero"),
        Index("ix_ft_entry_tracking_item_id", "tracking_item_id"),
        Index("ix_ft_entry_item_date", "tracking_item_id", "entry_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("uuid_generate_v4()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    tracking_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("ft_tracking_item.id", ondelete="CASCADE"),
        nullable=False,
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(19, 4), nullable=False)
    entry_date: Mapped[date] = mapped_column(Date, nullable=False)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
