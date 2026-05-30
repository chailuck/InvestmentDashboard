"""Action Plan SQLAlchemy models.

Two plan types share the action_plans table via plan_type:
  - 'purchase'  → items in purchase_plan_items
  - 'portfolio' → items in portfolio_plan_items
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.session import Base


class ActionPlan(Base):
    __tablename__ = "action_plans"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    plan_type: Mapped[str] = mapped_column(String(20), nullable=False)  # 'purchase' | 'portfolio'
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    purchase_items: Mapped[list[PurchasePlanItem]] = relationship(
        "PurchasePlanItem",
        back_populates="plan",
        cascade="all, delete-orphan",
        order_by="PurchasePlanItem.sort_order",
    )
    portfolio_items: Mapped[list[PortfolioPlanItem]] = relationship(
        "PortfolioPlanItem",
        back_populates="plan",
        cascade="all, delete-orphan",
        order_by="PortfolioPlanItem.sort_order",
    )

    def __repr__(self) -> str:
        return f"<ActionPlan {self.plan_type}:{self.name}>"


class PurchasePlanItem(Base):
    """One stock row inside a Purchase Action Plan."""

    __tablename__ = "purchase_plan_items"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("action_plans.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    stock: Mapped[str] = mapped_column(String(20), nullable=False, default="")
    current_price: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    buy_price: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    tp: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    sl: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    strategy: Mapped[str | None] = mapped_column(String(200), nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    triggered: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    plan: Mapped[ActionPlan] = relationship("ActionPlan", back_populates="purchase_items")


class PortfolioPlanItem(Base):
    """One position row inside a Portfolio Action Plan."""

    __tablename__ = "portfolio_plan_items"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("action_plans.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    symbol: Mapped[str] = mapped_column(String(20), nullable=False, default="")
    current_price: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    entry_price: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    tp: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    sl: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    order_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    plan: Mapped[ActionPlan] = relationship("ActionPlan", back_populates="portfolio_items")
