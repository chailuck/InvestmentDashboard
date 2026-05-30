"""Pydantic schemas for Action Plan endpoints."""

from __future__ import annotations

import uuid
from typing import Optional

from pydantic import BaseModel


# ── Item input schemas ──────────────────────────────────────────────────────

class PurchaseItemIn(BaseModel):
    sort_order: int = 0
    stock: str = ""
    current_price: Optional[float] = None
    size: Optional[int] = None
    buy_price: Optional[float] = None
    tp: Optional[float] = None
    sl: Optional[float] = None
    strategy: Optional[str] = None
    reason: Optional[str] = None
    triggered: bool = False


class PortfolioItemIn(BaseModel):
    sort_order: int = 0
    symbol: str = ""
    current_price: Optional[float] = None
    size: Optional[int] = None
    entry_price: Optional[float] = None
    tp: Optional[float] = None
    sl: Optional[float] = None
    order_size: Optional[int] = None


# ── Plan-level input schemas ────────────────────────────────────────────────

class ActionPlanCreate(BaseModel):
    name: str
    plan_type: str  # 'purchase' | 'portfolio'


class ActionPlanUpdate(BaseModel):
    name: Optional[str] = None
    purchase_items: Optional[list[PurchaseItemIn]] = None
    portfolio_items: Optional[list[PortfolioItemIn]] = None
