from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database.session import Base


class TrackingSet(Base):
    """Top-level grouping for a user's financial tracker (`ft_tracking_set`).

    No FK to the main app's `users` table by design — this service is a
    bounded context and enforces ownership purely via the bare `user_id`
    column at the application layer (see `_get_or_404` in each endpoint).
    """

    __tablename__ = "ft_tracking_set"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_ft_tracking_set_user_id_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("uuid_generate_v4()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
