"""Weekly Manual Scan SQLAlchemy models."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.session import Base


class UserScanConfig(Base):
    """Per-user symbol watchlist for weekly scans."""

    __tablename__ = "user_scan_configs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False, unique=True, index=True,
    )
    symbols: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class UserSymbolList(Base):
    """A named symbol list belonging to a user (supports multiple lists per user)."""

    __tablename__ = "user_symbol_lists"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    market: Mapped[str] = mapped_column(String(20), nullable=False, default='SET')
    is_dr: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    symbols: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class WeeklyScan(Base):
    """A dated weekly scan list."""

    __tablename__ = "weekly_scans"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    items: Mapped[list[WeeklyScanItem]] = relationship(
        "WeeklyScanItem",
        back_populates="scan",
        cascade="all, delete-orphan",
        order_by="WeeklyScanItem.sort_order",
    )

    def __repr__(self) -> str:
        return f"<WeeklyScan {self.name}>"


class WeeklyScanItem(Base):
    """One symbol inside a weekly scan, with its evaluation result."""

    __tablename__ = "weekly_scan_items"
    __table_args__ = (UniqueConstraint("scan_id", "symbol", name="uq_scan_item"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    scan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("weekly_scans.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    symbol: Mapped[str] = mapped_column(String(30), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    list_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    market: Mapped[str] = mapped_column(String(20), nullable=False, default='SET')

    # Evaluation fields — all nullable until the user evaluates
    color_mark: Mapped[str | None] = mapped_column(String(10), nullable=True)   # CYAN|GREEN|YELLOW|RED|PURPLE
    strategy: Mapped[str | None] = mapped_column(String(200), nullable=True)
    buy_price: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tp: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    sl: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    remark: Mapped[str | None] = mapped_column(Text, nullable=True)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    scan: Mapped[WeeklyScan] = relationship("WeeklyScan", back_populates="items")
