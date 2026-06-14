"""Pydantic schemas for Weekly Review endpoints."""

from __future__ import annotations

import uuid
from datetime import date
from typing import Optional

from pydantic import BaseModel, field_validator


class ReviewItemIn(BaseModel):
    symbol: str
    item_type: str           # TRADE | HOLD
    # Buy leg
    buy_date: Optional[date] = None
    buy_price: Optional[float] = None
    buy_size: Optional[int] = None
    # Sell leg
    sell_date: Optional[date] = None
    sell_price: Optional[float] = None
    sell_size: Optional[int] = None
    # Annotations
    buy_reason: Optional[str] = None
    buy_feeling: Optional[int] = None
    sell_reason: Optional[str] = None
    sell_feeling: Optional[int] = None
    source_position_id: Optional[uuid.UUID] = None
    sort_order: int = 0

    @field_validator("item_type")
    @classmethod
    def validate_type(cls, v: str) -> str:
        if v not in ("TRADE", "HOLD"):
            raise ValueError("item_type must be TRADE or HOLD")
        return v

    @field_validator("buy_feeling", "sell_feeling")
    @classmethod
    def validate_feeling(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and v not in range(1, 6):
            raise ValueError("feeling must be 1–5")
        return v


class ReviewItemPatch(BaseModel):
    """Partial update for a single review item (reasons / feelings only)."""
    buy_reason: Optional[str] = None
    buy_feeling: Optional[int] = None
    sell_reason: Optional[str] = None
    sell_feeling: Optional[int] = None

    @field_validator("buy_feeling", "sell_feeling")
    @classmethod
    def validate_feeling(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and v not in range(1, 6):
            raise ValueError("feeling must be 1–5")
        return v


class ReviewCreate(BaseModel):
    week_start: date
    name: Optional[str] = None


class ReviewUpdate(BaseModel):
    name: Optional[str] = None
    notes: Optional[str] = None
