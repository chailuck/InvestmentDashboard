"""DR (Depository Receipt) to parent symbol mapping — global config."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database.session import Base


class DrMapping(Base):
    """Maps a Thai-listed DR symbol to its underlying parent asset.

    ratio  = number of DR units per 1 parent unit  (e.g., 1000 → 1 BTC-USD = 1000 BTCUSD-DR)
    DR estimated price (฿) = parent_price_USD / ratio × USDTHB
    """

    __tablename__ = "dr_mappings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    dr_symbol: Mapped[str] = mapped_column(String(30), nullable=False, unique=True)
    parent_symbol: Mapped[str] = mapped_column(String(30), nullable=False)
    parent_market: Mapped[str] = mapped_column(String(20), nullable=False, default="CRYPTO")
    ratio: Mapped[float] = mapped_column(Numeric(20, 10), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
