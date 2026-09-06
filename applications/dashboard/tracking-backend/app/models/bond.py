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


class Bond(Base):
    """`ft_bond` — a single bond holding registered against a TrackingItem of
    type ``BOND``.

    This is a standalone register: it has no rollup / balance-grid / export
    integration. Ownership is NOT stored here — it is resolved by joining to
    ``ft_tracking_item.user_id`` (mirrors the bounded-context isolation the
    rest of this service uses; the FK cascade guarantees a bond can never
    outlive its item).

    Style mirrors ``app/models/initial_investment_entry.py``: UUID pk with a
    DB-side ``uuid_generate_v4()`` default, ``Numeric(19, 4)`` money column,
    timezone-aware ``created_at`` / ``updated_at`` with ``func.now()``
    server defaults, and an explicit short index name on the FK column
    (``index=True`` is intentionally NOT used — it would produce the longer
    auto-generated ``ix_ft_bond_tracking_item_id`` name; here we want that
    exact name so we declare it explicitly).
    """

    __tablename__ = "ft_bond"
    __table_args__ = (
        CheckConstraint("amount >= 0", name="ck_ft_bond_amount_nonneg"),
        CheckConstraint(
            "interest_rate IS NULL OR (interest_rate >= 0 AND interest_rate <= 100)",
            name="ck_ft_bond_interest_rate_range",
        ),
        Index("ix_ft_bond_tracking_item_id", "tracking_item_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("uuid_generate_v4()")
    )
    tracking_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("ft_tracking_item.id", ondelete="CASCADE"),
        nullable=False,
    )
    code: Mapped[str] = mapped_column(String(100), nullable=False)
    issuer: Mapped[str | None] = mapped_column(String(200), nullable=True)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    expired_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(19, 4), nullable=False)
    interest_rate: Mapped[Decimal | None] = mapped_column(Numeric(19, 4), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
