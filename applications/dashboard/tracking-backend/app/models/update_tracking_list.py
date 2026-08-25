from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Index, String, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database.session import Base


class UpdateTrackingList(Base):
    """`ft_update_tracking_list` — a dated balance-snapshot header ("update")
    against a TrackingSet (Phase 2 of the Financial Tracker). The individual
    per-item balances captured against this header live in
    `UpdateTrackingListBalance`; this table only holds the header metadata.

    No uniqueness constraint on (tracking_set_id, transaction_date) —
    duplicate dates are allowed by design (e.g. re-recording a snapshot for
    the same date rather than editing history). Ordering among same-date
    (or same-date-and-created_at) rows is resolved deterministically in
    `app/services/update_tracking.py`'s previous-list lookup.
    """

    __tablename__ = "ft_update_tracking_list"
    __table_args__ = (
        Index(
            "ix_ft_update_tracking_list_set_date",
            "tracking_set_id",
            "transaction_date",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("uuid_generate_v4()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    tracking_set_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("ft_tracking_set.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    transaction_date: Mapped[date] = mapped_column(Date, nullable=False)
    quarter_year_label: Mapped[str | None] = mapped_column(String(50), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
