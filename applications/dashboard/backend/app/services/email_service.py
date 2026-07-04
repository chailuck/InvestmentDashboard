"""Email service — orchestrates price refresh, data fetch, template render, and SMTP send.

Responsibilities:
1. fetch_widget_data  — pulls weekly scan, purchase plan, and portfolio data
2. send_daily_digest  — end-to-end pipeline: refresh → fetch → render → send
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any

import re

import aiosmtplib
import docker as docker_sdk
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.core.logging import get_logger
from app.models.action_plan import ActionPlan, PurchasePlanItem
from app.models.portfolio_db import PortfolioDbPosition
from app.models.weekly_scan import WeeklyScan, WeeklyScanItem
from app.services.email_template import render_daily_digest
from app.services.price_refresh_service import PriceRefreshResult, PriceRefreshService

_log = get_logger("email_service")

_CF_URL_RE = re.compile(r'https://[a-z0-9-]+\.trycloudflare\.com')


def _get_cloudflare_url(container_name: str = "cloudflared") -> str:
    """Read the current trycloudflare URL from the running cloudflared container logs.

    Returns an empty string if the container is not found or the URL cannot be parsed.
    Fails silently — a missing URL should never block the email send.
    """
    try:
        client = docker_sdk.from_env()
        container = client.containers.get(container_name)
        logs = container.logs(tail=200).decode("utf-8", errors="ignore")
        matches = _CF_URL_RE.findall(logs)
        if matches:
            return matches[-1]   # last match = most recent tunnel URL
    except Exception as exc:
        _log.warning("email.cloudflare_url.failed", error=str(exc))
    return ""


# ── Result dataclass ──────────────────────────────────────────────────────────

@dataclass
class SendResult:
    success: bool
    recipient: str
    sent_at: str | None = None
    price_refresh: PriceRefreshResult | None = None
    error: str | None = None


# ── Bangkok time formatting ────────────────────────────────────────────────────

_BANGKOK_OFFSET = timedelta(hours=7)


def _bangkok_now() -> datetime:
    return datetime.now(tz=timezone.utc) + _BANGKOK_OFFSET


def _bangkok_now_str() -> tuple[str, str]:
    """Return (formatted_timestamp, date_str) in Bangkok time (UTC+7)."""
    now_bkk = _bangkok_now()
    formatted = now_bkk.strftime("%-d %b %Y, %H:%M ICT")
    date_str = now_bkk.strftime("%a %-d %b %Y")
    return formatted, date_str


def _get_current_week_days() -> tuple[str, str, list[dict]]:
    """Return (date_from, date_to, week_days) for the current Bangkok week.

    week_days is a list of 5 dicts (Mon–Fri), each with:
        iso       — "YYYY-MM-DD"
        label     — "Mon"
        date_label— "30 Jun"
        is_today  — bool
    """
    now_bkk = _bangkok_now()
    today = now_bkk.date()
    monday = today - timedelta(days=today.weekday())  # weekday(): 0=Mon
    week_days = []
    for i in range(5):
        d = monday + timedelta(days=i)
        week_days.append({
            "iso": d.isoformat(),
            "label": d.strftime("%a"),
            "date_label": d.strftime("%-d %b"),
            "is_today": d == today,
        })
    return monday.isoformat(), (monday + timedelta(days=4)).isoformat(), week_days


async def _fetch_weekly_price_history(
    symbols: list[str],
    date_from: str,
    date_to: str,
) -> dict[str, dict[str, float]]:
    """Fetch Mon–Fri closing prices for each symbol via yfinance.

    Returns: {symbol: {iso_date: close_price}}
    """
    if not symbols:
        return {}

    import yfinance as yf

    # yfinance end date is exclusive — add 1 day
    end_dt = (datetime.strptime(date_to, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")
    loop = asyncio.get_running_loop()

    async def _one(symbol: str) -> tuple[str, dict[str, float]]:
        try:
            def _sync() -> dict[str, float]:
                hist = yf.Ticker(f"{symbol}.BK").history(start=date_from, end=end_dt)
                if hist.empty:
                    return {}
                return {
                    idx.strftime("%Y-%m-%d"): float(row["Close"])
                    for idx, row in hist.iterrows()
                }
            prices = await asyncio.wait_for(
                loop.run_in_executor(None, _sync), timeout=15.0
            )
            return symbol, prices
        except Exception:
            return symbol, {}

    results = await asyncio.gather(*[_one(s) for s in symbols], return_exceptions=True)
    out: dict[str, dict[str, float]] = {}
    for r in results:
        if isinstance(r, Exception):
            continue
        sym, prices = r
        out[sym] = prices
    return out


# ── Widget data fetchers ──────────────────────────────────────────────────────

async def _fetch_weekly_scan(db: AsyncSession, user_id: str) -> dict | None:
    """Fetch the most-recent WeeklyScan (with items) for the user."""
    uid = uuid.UUID(user_id)
    result = await db.execute(
        select(WeeklyScan)
        .where(WeeklyScan.user_id == uid)
        .options(selectinload(WeeklyScan.items))
        .order_by(WeeklyScan.created_at.desc())
        .limit(1)
    )
    scan = result.scalar_one_or_none()
    if scan is None:
        return None

    return {
        "id": str(scan.id),
        "name": scan.name,
        "created_at": scan.created_at.isoformat() if scan.created_at else None,
        "items": [
            {
                "id": str(item.id),
                "symbol": item.symbol,
                "color_mark": item.color_mark,
                "strategy": item.strategy,
                "buy_price": float(item.buy_price) if item.buy_price is not None else None,
                "sl": float(item.sl) if item.sl is not None else None,
                "tp": float(item.tp) if item.tp is not None else None,
                "remark": item.remark,
                "list_name": item.list_name,
            }
            for item in scan.items
        ],
    }


async def _fetch_purchase_plan(db: AsyncSession, user_id: str) -> dict | None:
    """Fetch the most-recent purchase ActionPlan (with PurchasePlanItems)."""
    uid = uuid.UUID(user_id)
    result = await db.execute(
        select(ActionPlan)
        .where(
            ActionPlan.created_by == uid,
            ActionPlan.plan_type == "purchase",
        )
        .options(selectinload(ActionPlan.purchase_items))
        .order_by(ActionPlan.updated_at.desc())
        .limit(1)
    )
    plan = result.scalar_one_or_none()
    if plan is None:
        return None

    return {
        "id": str(plan.id),
        "name": plan.name,
        "plan_type": plan.plan_type,
        "notes": plan.notes,
        "created_at": plan.created_at.isoformat() if plan.created_at else None,
        "updated_at": plan.updated_at.isoformat() if plan.updated_at else None,
        "purchase_items": [
            {
                "id": str(item.id),
                "sort_order": item.sort_order,
                "stock": item.stock,
                "current_price": float(item.current_price) if item.current_price is not None else None,
                "size": item.size,
                "buy_price": float(item.buy_price) if item.buy_price is not None else None,
                "tp": float(item.tp) if item.tp is not None else None,
                "sl": float(item.sl) if item.sl is not None else None,
                "strategy": item.strategy,
                "reason": item.reason,
                "triggered": item.triggered,
            }
            for item in plan.purchase_items
        ],
    }


def _fetch_yfinance_sync(symbol: str) -> float | None:
    """Synchronous yfinance fetch — intended for run_in_executor."""
    try:
        import yfinance as yf
        hist = yf.Ticker(f"{symbol}.BK").history(period="2d")
        if hist.empty:
            return None
        return float(hist["Close"].iloc[-1])
    except Exception:
        return None


async def _fetch_portfolio(db: AsyncSession, user_id: str) -> dict | None:
    """Fetch all PortfolioDbPosition rows (active + recently closed) with live prices."""
    from datetime import date, timedelta
    uid = uuid.UUID(user_id)
    cutoff = date.today() - timedelta(weeks=2)
    result = await db.execute(
        select(PortfolioDbPosition)
        .where(
            PortfolioDbPosition.user_id == uid,
            (
                (PortfolioDbPosition.status == "active") |
                (
                    (PortfolioDbPosition.status != "active") &
                    (PortfolioDbPosition.exit_date >= cutoff)
                )
            ),
        )
        .order_by(PortfolioDbPosition.entry_date.desc().nullsfirst())
    )
    rows = result.scalars().all()
    if not rows:
        return {"positions": [], "total": 0, "totalNetPnl": 0.0}

    # Fetch live prices for active positions only
    active_symbols = list({r.symbol for r in rows if r.status == "active"})
    prices: dict[str, float | None] = {}
    if active_symbols:
        loop = asyncio.get_running_loop()
        price_results = await asyncio.gather(
            *[
                loop.run_in_executor(None, _fetch_yfinance_sync, sym)
                for sym in active_symbols
            ],
            return_exceptions=True,
        )
        for sym, pr in zip(active_symbols, price_results):
            prices[sym] = pr if not isinstance(pr, Exception) else None

    def _f(v: Any) -> float | None:
        return float(v) if v is not None else None

    def _serialize_pos(pos: PortfolioDbPosition) -> dict:
        entry    = _f(pos.entry_price)
        exit_p   = _f(pos.exit_price)
        size     = pos.position_size or 0
        cp       = prices.get(pos.symbol)
        is_short = pos.direction.upper() == "SHORT"
        is_closed = pos.status != "active" and exit_p is not None

        price_for_pnl = exit_p if is_closed else cp
        net_pnl: float | None = None
        pnl_pct: float | None = None
        if entry and price_for_pnl and size:
            diff    = (price_for_pnl - entry) if not is_short else (entry - price_for_pnl)
            net_pnl = round(diff * size, 2)
            pnl_pct = round((diff / entry) * 100, 2) if entry else None

        return {
            "id": str(pos.id),
            "symbol": pos.symbol,
            "direction": pos.direction,
            "entryDate": pos.entry_date.isoformat() if pos.entry_date else None,
            "exitDate": pos.exit_date.isoformat() if pos.exit_date else None,
            "entryPrice": entry or 0.0,
            "exitPrice": exit_p,
            "currentPrice": cp or 0.0,
            "positionSize": size,
            "netPnl": net_pnl or 0.0,
            "pnlPct": pnl_pct or 0.0,
            "sl": _f(pos.sl),
            "tp": _f(pos.tp),
            "status": pos.status,
            "remarks": pos.remarks,
        }

    serialized = [_serialize_pos(r) for r in rows]
    total_pnl = sum(p["netPnl"] for p in serialized)
    return {
        "positions": serialized,
        "total": len(serialized),
        "totalNetPnl": round(total_pnl, 0),
    }


# ── Main service class ────────────────────────────────────────────────────────

class EmailService:
    """Orchestrates the full daily digest pipeline."""

    async def fetch_widget_data(
        self,
        db: AsyncSession,
        user_id: str,
    ) -> tuple[dict | None, dict | None, dict | None]:
        """Fetch all three widget datasets independently.

        Each section is wrapped in its own try/except so a single failure
        does not suppress the other sections.

        Returns:
            (weekly_scan_data, purchase_plan_data, portfolio_data)
            Each element is ``None`` when its fetch failed.
        """
        weekly_scan: dict | None = None
        purchase_plan: dict | None = None
        portfolio: dict | None = None

        try:
            weekly_scan = await _fetch_weekly_scan(db, user_id)
        except Exception as exc:
            _log.warning(
                "email.fetch_widget.weekly_scan_failed",
                user_id=user_id,
                error=str(exc),
            )

        try:
            purchase_plan = await _fetch_purchase_plan(db, user_id)
        except Exception as exc:
            _log.warning(
                "email.fetch_widget.purchase_plan_failed",
                user_id=user_id,
                error=str(exc),
            )

        try:
            portfolio = await _fetch_portfolio(db, user_id)
        except Exception as exc:
            _log.warning(
                "email.fetch_widget.portfolio_failed",
                user_id=user_id,
                error=str(exc),
            )

        return weekly_scan, purchase_plan, portfolio

    async def send_daily_digest(
        self,
        db: AsyncSession,
        user_id: str,
        recipient_email: str,
    ) -> SendResult:
        """Full pipeline: refresh prices → fetch data → render → send.

        Args:
            db: Active AsyncSession (will be committed inside price refresh).
            user_id: UUID string of the user whose data to fetch.
            recipient_email: Destination email address.

        Returns:
            SendResult describing success or failure.
        """
        settings = get_settings()
        generated_at, date_str = _bangkok_now_str()

        _log.info(
            "email.daily_digest.start",
            user_id=user_id,
            recipient=recipient_email,
            generated_at=generated_at,
        )

        # ── Step 1: Refresh prices ────────────────────────────────────────────
        refresh_result: PriceRefreshResult | None = None
        try:
            refresh_svc = PriceRefreshService()
            refresh_result = await refresh_svc.refresh_all_prices(db, user_id)
            _log.info(
                "email.daily_digest.price_refresh_done",
                refreshed=refresh_result.refreshed,
                failed=refresh_result.failed,
                duration_seconds=refresh_result.duration_seconds,
            )
        except Exception as exc:
            _log.warning(
                "email.daily_digest.price_refresh_failed",
                error=str(exc),
            )

        # ── Step 2: Fetch widget data ─────────────────────────────────────────
        weekly_scan, purchase_plan, portfolio = await self.fetch_widget_data(
            db, user_id
        )

        # ── Step 2b: Fetch weekly price history (Mon–Fri prices) ─────────────
        date_from, date_to, week_days = _get_current_week_days()
        price_history: dict[str, dict[str, float]] = {}
        try:
            purchase_syms = [
                i.get("stock") for i in (purchase_plan or {}).get("purchase_items", [])
                if i.get("stock")
            ]
            portfolio_syms = [
                p.get("symbol") for p in (portfolio or {}).get("positions", [])
                if p.get("symbol")
            ]
            all_syms = list(dict.fromkeys(purchase_syms + portfolio_syms))
            if all_syms:
                price_history = await _fetch_weekly_price_history(all_syms, date_from, date_to)
                _log.info(
                    "email.daily_digest.price_history_done",
                    symbols=len(all_syms),
                    date_from=date_from,
                    date_to=date_to,
                )
        except Exception as exc:
            _log.warning("email.daily_digest.price_history_failed", error=str(exc))

        # ── Step 3: Render HTML ───────────────────────────────────────────────
        try:
            dashboard_url = _get_cloudflare_url()
            html_body = render_daily_digest(
                weekly_scan=weekly_scan,
                purchase_plan=purchase_plan,
                portfolio=portfolio,
                generated_at=generated_at,
                price_history=price_history,
                week_days=week_days,
                dashboard_url=dashboard_url,
            )
        except Exception as exc:
            _log.error("email.daily_digest.render_failed", error=str(exc))
            return SendResult(
                success=False,
                recipient=recipient_email,
                price_refresh=refresh_result,
                error=f"Template render failed: {exc}",
            )

        # ── Step 4: Send via aiosmtplib ───────────────────────────────────────
        subject = f"POP Investment Digest — {date_str}, 17:30 ICT"

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = settings.gmail_user
        msg["To"] = recipient_email
        msg.attach(MIMEText(html_body, "html", "utf-8"))

        try:
            await aiosmtplib.send(
                msg,
                hostname="smtp.gmail.com",
                port=587,
                start_tls=True,
                username=settings.gmail_user,
                password=settings.gmail_app_password.get_secret_value(),
            )
        except Exception as exc:
            _log.error(
                "email.daily_digest.smtp_failed",
                recipient=recipient_email,
                error=str(exc),
            )
            return SendResult(
                success=False,
                recipient=recipient_email,
                price_refresh=refresh_result,
                error=f"SMTP send failed: {exc}",
            )

        sent_at = datetime.now(tz=timezone.utc).isoformat()
        _log.info(
            "email.daily_digest.sent",
            recipient=recipient_email,
            sent_at=sent_at,
        )

        return SendResult(
            success=True,
            recipient=recipient_email,
            sent_at=sent_at,
            price_refresh=refresh_result,
        )
