"""Price refresh service — bulk-updates current_price on purchase_plan_items
and fetches live prices for active portfolio positions via yfinance.

Designed to run immediately before sending the daily email digest so that
all widget data reflects the most recent market close.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Sequence

import yfinance as yf
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.action_plan import ActionPlan, PurchasePlanItem
from app.models.portfolio_db import PortfolioDbPosition

import uuid

_log = get_logger("price_refresh_service")

# ── Concurrency / timeout knobs ───────────────────────────────────────────────
_MAX_CONCURRENT = 5      # simultaneous yfinance fetches
_PER_SYMBOL_TIMEOUT = 10  # seconds per symbol before giving up
_TOTAL_TIMEOUT = 60       # overall ceiling for the whole refresh pass


# ── Result dataclass ──────────────────────────────────────────────────────────

@dataclass
class PriceRefreshResult:
    total_symbols: int
    refreshed: int
    failed: list[str] = field(default_factory=list)
    duration_seconds: float = 0.0


# ── yfinance helper (sync, runs in thread pool) ───────────────────────────────

def _fetch_yfinance(symbol: str) -> float | None:
    """Fetch the most-recent closing price for a Thai SET symbol.

    Returns ``None`` on any error rather than propagating — callers decide
    how to handle the gap.
    """
    try:
        hist = yf.Ticker(f"{symbol}.BK").history(period="2d")
        if hist.empty:
            return None
        return float(hist["Close"].iloc[-1])
    except Exception:
        return None


# ── Main service ──────────────────────────────────────────────────────────────

class PriceRefreshService:
    """Refresh live prices for all symbols that appear in the user's active
    purchase plan and active portfolio positions.

    Usage::

        svc = PriceRefreshService()
        result = await svc.refresh_all_prices(db, user_id)
    """

    async def refresh_all_prices(
        self,
        db: AsyncSession,
        user_id: str,
    ) -> PriceRefreshResult:
        """Refresh prices and bulk-update purchase_plan_items.current_price.

        Steps:
        1. Collect DISTINCT symbols from the latest purchase plan items.
        2. Collect DISTINCT symbols from active portfolio positions.
        3. Deduplicate the combined set.
        4. Fetch prices concurrently (semaphore-bounded, per-symbol timeout).
        5. Bulk UPDATE purchase_plan_items.current_price for succeeded symbols.
        6. Return a PriceRefreshResult summary.
        """
        start = time.monotonic()
        uid = uuid.UUID(user_id)

        # ── 1. Symbols from most-recent purchase plan ─────────────────────────
        # Find the most recently updated action_plan of type 'purchase'
        plan_q = (
            select(ActionPlan.id)
            .where(
                ActionPlan.created_by == uid,
                ActionPlan.plan_type == "purchase",
            )
            .order_by(ActionPlan.updated_at.desc())
            .limit(1)
        )
        plan_result = await db.execute(plan_q)
        latest_plan_id = plan_result.scalar_one_or_none()

        purchase_symbols: set[str] = set()
        if latest_plan_id:
            items_q = select(PurchasePlanItem.stock).where(
                PurchasePlanItem.plan_id == latest_plan_id
            )
            items_result = await db.execute(items_q)
            purchase_symbols = {
                row[0].strip().upper()
                for row in items_result.fetchall()
                if row[0]
            }

        # ── 2. Symbols from active portfolio positions ────────────────────────
        port_q = select(PortfolioDbPosition.symbol).where(
            PortfolioDbPosition.user_id == uid,
            PortfolioDbPosition.status == "active",
        ).distinct()
        port_result = await db.execute(port_q)
        portfolio_symbols: set[str] = {
            row[0].strip().upper()
            for row in port_result.fetchall()
            if row[0]
        }

        # ── 3. Deduplicate ────────────────────────────────────────────────────
        all_symbols: list[str] = sorted(purchase_symbols | portfolio_symbols)
        total = len(all_symbols)

        if total == 0:
            return PriceRefreshResult(
                total_symbols=0,
                refreshed=0,
                duration_seconds=round(time.monotonic() - start, 2),
            )

        _log.info(
            "price_refresh.start",
            user_id=user_id,
            total_symbols=total,
            symbols=all_symbols,
        )

        # ── 4. Concurrent fetch ───────────────────────────────────────────────
        semaphore = asyncio.Semaphore(_MAX_CONCURRENT)
        loop = asyncio.get_running_loop()

        async def _fetch_with_limit(symbol: str) -> tuple[str, float | None]:
            async with semaphore:
                try:
                    price = await asyncio.wait_for(
                        loop.run_in_executor(None, _fetch_yfinance, symbol),
                        timeout=_PER_SYMBOL_TIMEOUT,
                    )
                    return symbol, price
                except asyncio.TimeoutError:
                    _log.warning("price_refresh.timeout", symbol=symbol)
                    return symbol, None
                except Exception as exc:
                    _log.warning("price_refresh.error", symbol=symbol, error=str(exc))
                    return symbol, None

        try:
            fetch_tasks = [_fetch_with_limit(sym) for sym in all_symbols]
            raw_results: list[tuple[str, float | None]] = await asyncio.wait_for(
                asyncio.gather(*fetch_tasks),
                timeout=_TOTAL_TIMEOUT,
            )
        except asyncio.TimeoutError:
            _log.warning("price_refresh.total_timeout", total_symbols=total)
            raw_results = [(sym, None) for sym in all_symbols]

        prices: dict[str, float] = {}
        failed: list[str] = []
        for symbol, price in raw_results:
            if price is not None:
                prices[symbol] = price
            else:
                failed.append(symbol)

        # ── 5. Bulk UPDATE purchase_plan_items ────────────────────────────────
        if latest_plan_id and prices:
            for symbol, price in prices.items():
                if symbol in purchase_symbols:
                    await db.execute(
                        update(PurchasePlanItem)
                        .where(
                            PurchasePlanItem.plan_id == latest_plan_id,
                            PurchasePlanItem.stock == symbol,
                        )
                        .values(current_price=price)
                    )
            await db.commit()

        duration = round(time.monotonic() - start, 2)

        _log.info(
            "price_refresh.complete",
            user_id=user_id,
            total_symbols=total,
            refreshed=len(prices),
            failed=failed,
            duration_seconds=duration,
        )

        return PriceRefreshResult(
            total_symbols=total,
            refreshed=len(prices),
            failed=failed,
            duration_seconds=duration,
        )
