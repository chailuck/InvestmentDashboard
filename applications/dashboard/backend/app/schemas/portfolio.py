"""Portfolio and holding schemas."""

from __future__ import annotations

from pydantic import BaseModel, Field


class HoldingOut(BaseModel):
    id: str
    portfolioId: str
    symbol: str
    name: str
    quantity: float
    avgCost: float
    currentPrice: float
    marketValue: float
    unrealizedPnl: float
    unrealizedPnlPct: float
    weight: float
    sector: str
    assetClass: str
    dayChange: float
    dayChangePct: float


class PortfolioOut(BaseModel):
    id: str
    name: str
    totalValue: float
    dailyPnl: float
    dailyPnlPct: float
    totalReturn: float
    totalReturnPct: float
    cash: float
    holdings: list[HoldingOut] = []
    lastUpdated: str


class PerformancePoint(BaseModel):
    date: str
    portfolioValue: float
    benchmarkValue: float
    return_: float = Field(alias="return")
    benchmarkReturn: float

    class Config:
        populate_by_name = True


class PortfolioMetricsOut(BaseModel):
    sharpeRatio: float
    sortinoRatio: float
    maxDrawdown: float
    volatility: float
    beta: float
    alpha: float
    var95: float
    var99: float
    calmarRatio: float
    informationRatio: float


class AllocationItem(BaseModel):
    name: str
    value: float
    pct: float
