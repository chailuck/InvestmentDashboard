from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Numeric, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database.session import Base


class UpdateTrackingListBalance(Base):
    """`ft_update_tracking_list_balance` — one balance line item for a
    TrackingItem within an UpdateTrackingList.

    `balance` is NULLABLE by design: a row only exists once a balance has
    actually been saved for that item+list pairing — rows are never
    pre-created for every item in the set when a list header is created.
    `app/services/update_tracking.py`'s delta computation relies on
    row-absence and `row.balance IS NULL` both collapsing to "no data" for
    the previous-list lookup (`has_previous_data=False` either way).

    UniqueConstraint enforces exactly one row per (list, item) pairing — the
    bulk-upsert endpoint (`PUT /update-lists/{list_id}/balances`) updates the
    existing row if one is present, else inserts a new one.
    """

    __tablename__ = "ft_update_tracking_list_balance"
    __table_args__ = (
        UniqueConstraint(
            "update_tracking_list_id",
            "tracking_item_id",
            name="uq_ft_update_tracking_list_balance_list_item",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("uuid_generate_v4()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    update_tracking_list_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("ft_update_tracking_list.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    tracking_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("ft_tracking_item.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    balance: Mapped[Decimal | None] = mapped_column(Numeric(19, 4), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
