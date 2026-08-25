from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
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
from sqlalchemy.orm import Mapped, mapped_column

from app.database.session import Base

# FINAL, verbatim — do not alter. Enforced both at the DB (CHECK constraint)
# and application (Pydantic) layers so an invalid type is rejected consistently
# with a 400 regardless of which layer catches it first.
TRACKING_ITEM_TYPES = (
    "Bank account",
    "Property",
    "Investment Account",
    "TaxSaving",
    "Materials",
    "Insurance",
)


class TrackingItem(Base):
    """`ft_tracking_item` — belongs to a SubCategory."""

    __tablename__ = "ft_tracking_item"
    __table_args__ = (
        CheckConstraint(
            "type IN ('Bank account','Property','Investment Account','TaxSaving','Materials','Insurance')",
            name="ck_ft_tracking_item_type",
        ),
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
    type: Mapped[str] = mapped_column(String(30), nullable=False)
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
