from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.session import Base


class TrackingItem(Base):
    """`ft_tracking_item` — belongs to a SubCategory.

    Type source of truth is the FK `type_id` -> `ft_item_type.id` (ADR-027).
    The old validated `type` VARCHAR is kept as a denormalised, DB-trigger-
    synced read-through for one transition release (design §C.6); a follow-up
    migration drops it. Nothing in code should branch on the `type` string
    any more — capability checks go through `ItemTypeRegistry`.
    """

    __tablename__ = "ft_tracking_item"
    __table_args__ = (
        Index("ix_ft_tracking_item_subcat_order", "sub_category_id", "order_index"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("uuid_generate_v4()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    sub_category_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("ft_sub_category.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # Denormalised label, transition-only (see class docstring). Populated by
    # the application on create/update AND by the `ft_tracking_item_sync_type`
    # DB trigger; dropped by a later migration. Widened 30 -> 100 by the
    # `c2d3e4f5a6b7` migration so it can hold any `ft_item_type.label`
    # (VARCHAR(100)) — see that migration's deviation note.
    type: Mapped[str] = mapped_column(String(100), nullable=False)
    type_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("ft_item_type.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    initial_investment_tracking: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    exclusive: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    order_index: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    account_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    remark: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    # Plain lazy: capability logic goes through `ItemTypeRegistry` (one query
    # pair per request, never per-item). Only the item CRUD/list endpoints
    # need the embedded `itemType` in their response and they load it
    # explicitly via `selectinload(TrackingItem.item_type)`.
    item_type: Mapped["ItemType"] = relationship("ItemType", lazy="select", viewonly=True)  # noqa: F821
