"""Portfolio endpoints â€” mock data responses for initial scaffold."""


import random
from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth.dependencies import get_current_user_id
from app.schemas.portfolio import (
    AllocationItem,
    HoldingOut,
    PerformancePoint,
    PortfolioMetricsOut,
    PortfolioOut,
)

router = APIRouter(prefix="/portfolios", tags=["Portfolios"])

UserId = Annotated[str, Depends(get_current_user_id)]

# â”€â”€ Mock data helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

MOCK_HOLDINGS: list[HoldingOut] = [
    HoldingOut(id="h1", portfolioId="default", symbol="AAPL", name="Apple Inc.",
               quantity=150, avgCost=165.0, currentPrice=189.45, marketValue=28417.5,
               unrealizedPnl=3667.5, unrealizedPnlPct=14.8, weight=0.185,
               sector="Technology", assetClass="equity", dayChange=2.30, dayChangePct=1.23),
    HoldingOut(id="h2", portfolioId="default", symbol="MSFT", name="Microsoft Corp.",
               quantity=80, avgCost=310.0, currentPrice=428.65, marketValue=34292.0,
               unrealizedPnl=9492.0, unrealizedPnlPct=38.3, weight=0.223,
               sector="Technology", assetClass="equity", dayChange=4.15, dayChangePct=0.98),
    HoldingOut(id="h3", portfolioId="default", symbol="NVDA", name="NVIDIA Corp.",
               quantity=45, avgCost=420.0, currentPrice=875.30, marketValue=39388.5,
               unrealizedPnl=20488.5, unrealizedPnlPct=108.4, weight=0.256,
               sector="Technology", assetClass="equity", dayChange=18.5, dayChangePct=2.16),
    HoldingOut(id="h4", portfolioId="default", symbol="JPM", name="JPMorgan Chase",
               quantity=100, avgCost=145.0, currentPrice=198.25, marketValue=19825.0,
               unrealizedPnl=5325.0, unrealizedPnlPct=36.7, weight=0.129,
               sector="Financials", assetClass="equity", dayChange=-0.85, dayChangePct=-0.43),
    HoldingOut(id="h5", portfolioId="default", symbol="BRK.B", name="Berkshire Hathaway",
               quantity=60, avgCost=290.0, currentPrice=368.15, marketValue=22089.0,
               unrealizedPnl=4689.0, unrealizedPnlPct=26.9, weight=0.144,
               sector="Financials", assetClass="equity", dayChange=1.20, dayChangePct=0.33),
    HoldingOut(id="h6", portfolioId="default", symbol="TLT", name="iShares 20+ Year T-Bond",
               quantity=200, avgCost=95.0, currentPrice=88.40, marketValue=17680.0,
               unrealizedPnl=-1320.0, unrealizedPnlPct=-6.9, weight=0.115,
               sector="Fixed Income", assetClass="fixed_income", dayChange=0.30, dayChangePct=0.34),
]

def _mock_portfolio() -> PortfolioOut:
    total = sum(h.marketValue for h in MOCK_HOLDINGS) + 8_000
    return PortfolioOut(
        id="default",
        name="Primary Portfolio",
        totalValue=total,
        dailyPnl=1847.50,
        dailyPnlPct=1.21,
        totalReturn=42_352.0,
        totalReturnPct=38.2,
        cash=8_000,
        holdings=MOCK_HOLDINGS,
        lastUpdated=date.today().isoformat(),
    )


@router.get("", response_model=list[PortfolioOut])
async def list_portfolios(user_id: UserId) -> list[PortfolioOut]:
    return [_mock_portfolio()]


@router.get("/{portfolio_id}", response_model=PortfolioOut)
async def get_portfolio(portfolio_id: str, user_id: UserId) -> PortfolioOut:
    return _mock_portfolio()


@router.get("/{portfolio_id}/holdings", response_model=list[HoldingOut])
async def get_holdings(portfolio_id: str, user_id: UserId) -> list[HoldingOut]:
    return MOCK_HOLDINGS


@router.get("/{portfolio_id}/performance", response_model=list[PerformancePoint])
async def get_performance(
    portfolio_id: str,
    user_id: UserId,
    period: str = "3M",
) -> list[PerformancePoint]:
    days_map = {"1D": 1, "1W": 7, "1M": 30, "3M": 90, "6M": 180, "1Y": 365, "YTD": 200, "ALL": 730}
    days = days_map.get(period, 90)
    start_value = 110_000.0
    benchmark_value = 100_000.0
    points: list[PerformancePoint] = []
    today = date.today()

    for i in range(days, -1, -1):
        d = today - timedelta(days=i)
        daily_ret = random.gauss(0.0005, 0.012)
        bench_ret = random.gauss(0.0004, 0.010)
        start_value *= 1 + daily_ret
        benchmark_value *= 1 + bench_ret
        points.append(PerformancePoint(
            date=d.isoformat(),
            portfolioValue=round(start_value, 2),
            benchmarkValue=round(benchmark_value, 2),
            **{"return": round(daily_ret * 100, 4)},
            benchmarkReturn=round(bench_ret * 100, 4),
        ))

    return points


@router.get("/{portfolio_id}/metrics", response_model=PortfolioMetricsOut)
async def get_metrics(portfolio_id: str, user_id: UserId) -> PortfolioMetricsOut:
    return PortfolioMetricsOut(
        sharpeRatio=1.82,
        sortinoRatio=2.41,
        maxDrawdown=-0.187,
        volatility=0.142,
        beta=1.12,
        alpha=0.068,
        var95=-0.021,
        var99=-0.034,
        calmarRatio=3.15,
        informationRatio=0.94,
    )
