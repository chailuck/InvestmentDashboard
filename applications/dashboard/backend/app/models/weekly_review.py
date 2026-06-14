"""Weekly Review SQLAlchemy models — one review per user per ISO week."""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, SmallInteger, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.session import Base


class WeeklyReview(Base):
    """One weekly review record per user per ISO week (Mon–Sun)."""

    __tablename__ = "weekly_reviews"
    __table_args__ = (UniqueConstraint("user_id", "week_start", name="uq_review_user_week"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    week_start: Mapped[date] = mapped_column(Date, nullable=False)
    week_end: Mapped[date] = mapped_column(Date, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    items: Mapped[list[WeeklyReviewItem]] = relationship(
        "WeeklyReviewItem",
        back_populates="review",
        cascade="all, delete-orphan",
        order_by="WeeklyReviewItem.sort_order",
    )

    def __repr__(self) -> str:
        return f"<WeeklyReview week={self.week_start} user={self.user_id}>"


class WeeklyReviewItem(Base):
    """One position entry inside a weekly review.

    item_type:
      'TRADE' → position had buy and/or sell activity during the week (Part 1)
      'HOLD'  → open position with no activity this week (Part 2)

    Buy leg  (buy_date / buy_price / buy_size) — set when the position was entered this week.
    Sell leg (sell_date / sell_price / sell_size) — set when the position was exited this week.
    Both legs may be set if the position was opened and closed in the same week.

    feeling: 1=Very Bad  2=Bad  3=Moderate  4=Good  5=Very Good  (null = not rated)
    """

    __tablename__ = "weekly_review_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    review_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("weekly_reviews.id", ondelete="CASCADE"), nullable=False, index=True
    )
    symbol: Mapped[str] = mapped_column(String(30), nullable=False)
    item_type: Mapped[str] = mapped_column(String(10), nullable=False)   # TRADE | HOLD

    # Buy leg
    buy_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    buy_price: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    buy_size: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Sell leg
    sell_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    sell_price: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    sell_size: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # User annotations
    buy_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    buy_feeling: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)  # 1–5
    sell_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    sell_feeling: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)  # 1–5

    # Week price snapshot (Monday open / Friday close for the review week)
    week_open_price: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    week_close_price: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)

    # Optional link back to the source DB position (null for excel-mode manual entries)
    source_position_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("portfolio_positions_db.id", ondelete="SET NULL"),
        nullable=True,
    )

    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    review: Mapped[WeeklyReview] = relationship("WeeklyReview", back_populates="items")

    def __repr__(self) -> str:
        return f"<WeeklyReviewItem {self.item_type} {self.symbol}>"
