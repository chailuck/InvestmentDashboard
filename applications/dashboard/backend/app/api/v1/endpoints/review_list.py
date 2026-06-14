"""Weekly Review List endpoints.

Endpoints
---------
GET  /review-list/current-week                → get or auto-create this week's review
GET  /review-list                             → list all reviews (paginated by months)
POST /review-list                             → create review manually
GET  /review-list/{id}                        → full review detail (items + open positions)
PUT  /review-list/{id}                        → update review header (name / notes)
DELETE /review-list/{id}                      → delete review
POST /review-list/{id}/sync                   → auto-populate TRADE items from portfolio_positions_db
POST /review-list/{id}/refresh-prices         → fetch Mon open / Fri close prices via yfinance
PUT  /review-list/{id}/items                  → replace all items in bulk
PATCH /review-list/{id}/items/{item_id}       → update reason / feeling on one item
DELETE /review-list/{id}/items/{item_id}      → remove one item
POST /review-list/{id}/items                  → add one item
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import date, timedelta
from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.dependencies import get_current_user_id
from app.database.session import get_db
from app.models.portfolio_db import PortfolioDbPosition
from app.models.weekly_review import WeeklyReview, WeeklyReviewItem
from app.schemas.weekly_review import ReviewCreate, ReviewItemIn, ReviewItemPatch, ReviewUpdate

router = APIRouter(prefix="/review-list", tags=["Review List"])

UserId = Annotated[str, Depends(get_current_user_id)]
DB = Annotated[AsyncSession, Depends(get_db)]


# ── Helpers ────────────────────────────────────────────────────────────────────

def _monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _sunday(monday: date) -> date:
    return monday + timedelta(days=6)


def _week_name(monday: date) -> str:
    sunday = _sunday(monday)
    return f"Week {monday.isocalendar().week} ({monday.strftime('%d %b')}–{sunday.strftime('%d %b %Y')})"


def _f(v: Any) -> float | None:
    return float(v) if v is not None else None


def _item_dict(item: WeeklyReviewItem) -> dict[str, Any]:
    open_p = _f(item.week_open_price)
    close_p = _f(item.week_close_price)
    week_change_pct: float | None = None
    if open_p and close_p and open_p != 0:
        week_change_pct = round((close_p - open_p) / open_p * 100, 2)
    return {
        "id": str(item.id),
        "review_id": str(item.review_id),
        "symbol": item.symbol,
        "item_type": item.item_type,
        # Buy leg
        "buy_date": item.buy_date.isoformat() if item.buy_date else None,
        "buy_price": _f(item.buy_price),
        "buy_size": item.buy_size,
        # Sell leg
        "sell_date": item.sell_date.isoformat() if item.sell_date else None,
        "sell_price": _f(item.sell_price),
        "sell_size": item.sell_size,
        # Week price snapshot
        "week_open_price": open_p,
        "week_close_price": close_p,
        "week_change_pct": week_change_pct,
        # Annotations
        "buy_reason": item.buy_reason,
        "buy_feeling": item.buy_feeling,
        "sell_reason": item.sell_reason,
        "sell_feeling": item.sell_feeling,
        "source_position_id": str(item.source_position_id) if item.source_position_id else None,
        "sort_order": item.sort_order,
        "updated_at": item.updated_at.isoformat(),
    }


def _item_sort_key(item: WeeklyReviewItem, week_start: date, week_end: date) -> date:
    """Sort by the date that falls inside the review week.

    sell_date within the week takes priority; otherwise use buy_date if it's
    in-week; finally fall back to buy_date itself (for positions entered and
    still held, which will be sorted by their actual entry date).
    """
    in_week = lambda d: d is not None and week_start <= d <= week_end
    if in_week(item.sell_date):
        return item.sell_date  # type: ignore[return-value]
    if in_week(item.buy_date):
        return item.buy_date   # type: ignore[return-value]
    return item.buy_date or date(9999, 12, 31)


def _review_summary(review: WeeklyReview) -> dict[str, Any]:
    trade_count = sum(1 for i in review.items if i.item_type == "TRADE")
    hold_count = sum(1 for i in review.items if i.item_type == "HOLD")
    buy_count = sum(1 for i in review.items if i.buy_date is not None)
    sell_count = sum(1 for i in review.items if i.sell_date is not None)
    return {
        "id": str(review.id),
        "week_start": review.week_start.isoformat(),
        "week_end": review.week_end.isoformat(),
        "name": review.name,
        "trade_count": trade_count,
        "hold_count": hold_count,
        "buy_count": buy_count,
        "sell_count": sell_count,
        "created_at": review.created_at.isoformat(),
        "updated_at": review.updated_at.isoformat(),
    }


async def _get_or_404(review_id: uuid.UUID, user_id: str, db: AsyncSession) -> WeeklyReview:
    uid = uuid.UUID(user_id)
    result = await db.execute(
        select(WeeklyReview)
        .where(WeeklyReview.id == review_id, WeeklyReview.user_id == uid)
        .options(selectinload(WeeklyReview.items))
    )
    review = result.scalar_one_or_none()
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")
    return review


async def _create_review(user_id: str, monday: date, db: AsyncSession) -> WeeklyReview:
    uid = uuid.UUID(user_id)
    sunday = _sunday(monday)
    review = WeeklyReview(
        user_id=uid,
        week_start=monday,
        week_end=sunday,
        name=_week_name(monday),
    )
    db.add(review)
    await db.commit()
    await db.refresh(review)
    return review


# ── Get or create current week ─────────────────────────────────────────────────

@router.get("/current-week")
async def get_or_create_current_week(user_id: UserId, db: DB) -> dict[str, Any]:
    """Return this week's review, creating it if it doesn't exist yet."""
    uid = uuid.UUID(user_id)
    monday = _monday(date.today())

    result = await db.execute(
        select(WeeklyReview)
        .where(WeeklyReview.user_id == uid, WeeklyReview.week_start == monday)
        .options(selectinload(WeeklyReview.items))
    )
    review = result.scalar_one_or_none()

    if not review:
        review = await _create_review(user_id, monday, db)
        result = await db.execute(
            select(WeeklyReview)
            .where(WeeklyReview.id == review.id)
            .options(selectinload(WeeklyReview.items))
        )
        review = result.scalar_one()

    return _review_summary(review)


# ── List reviews ───────────────────────────────────────────────────────────────

@router.get("")
async def list_reviews(
    user_id: UserId,
    db: DB,
    months: Optional[int] = Query(None, description="3 | 6 | 12 | omit for all"),
) -> list[dict[str, Any]]:
    uid = uuid.UUID(user_id)
    conditions = [WeeklyReview.user_id == uid]
    if months:
        conditions.append(WeeklyReview.week_start >= text(f"CURRENT_DATE - INTERVAL '{months} months'"))

    result = await db.execute(
        select(WeeklyReview)
        .where(*conditions)
        .options(selectinload(WeeklyReview.items))
        .order_by(WeeklyReview.week_start.desc())
    )
    reviews = result.scalars().all()
    return [_review_summary(r) for r in reviews]


# ── Create review ──────────────────────────────────────────────────────────────

@router.post("", status_code=status.HTTP_201_CREATED)
async def create_review(body: ReviewCreate, user_id: UserId, db: DB) -> dict[str, Any]:
    monday = _monday(body.week_start)
    uid = uuid.UUID(user_id)

    existing = await db.execute(
        select(WeeklyReview.id)
        .where(WeeklyReview.user_id == uid, WeeklyReview.week_start == monday)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="A review already exists for this week")

    sunday = _sunday(monday)
    review = WeeklyReview(
        user_id=uid,
        week_start=monday,
        week_end=sunday,
        name=body.name or _week_name(monday),
    )
    db.add(review)
    await db.commit()
    await db.refresh(review)
    return {"id": str(review.id), "week_start": review.week_start.isoformat(), "name": review.name}


# ── Get review detail ──────────────────────────────────────────────────────────

@router.get("/{review_id}")
async def get_review(review_id: uuid.UUID, user_id: UserId, db: DB) -> dict[str, Any]:
    """Return full review. Items are sorted by earliest trade date (buy_date or sell_date)."""
    uid = uuid.UUID(user_id)
    review = await _get_or_404(review_id, user_id, db)

    # Symbols already in Part 1 (TRADE items)
    traded_symbols = {i.symbol for i in review.items if i.item_type == "TRADE"}

    # Part 2 suggestions: open DB positions not already in the review
    open_positions_result = await db.execute(
        select(PortfolioDbPosition)
        .where(
            PortfolioDbPosition.user_id == uid,
            PortfolioDbPosition.status == "active",
        )
        .order_by(PortfolioDbPosition.symbol)
    )
    open_positions = open_positions_result.scalars().all()
    open_suggestions = [
        {
            "id": str(p.id),
            "symbol": p.symbol,
            "entry_date": p.entry_date.isoformat() if p.entry_date else None,
            "entry_price": _f(p.entry_price),
            "position_size": p.position_size,
            "direction": p.direction,
        }
        for p in open_positions
        if p.symbol not in traded_symbols
    ]

    # Sort items: TRADE items by in-week activity date, HOLD items by symbol
    trade_items = sorted(
        [i for i in review.items if i.item_type == "TRADE"],
        key=lambda i: _item_sort_key(i, review.week_start, review.week_end),
    )
    hold_items = sorted(
        [i for i in review.items if i.item_type == "HOLD"],
        key=lambda i: i.symbol,
    )

    return {
        "id": str(review.id),
        "week_start": review.week_start.isoformat(),
        "week_end": review.week_end.isoformat(),
        "name": review.name,
        "notes": review.notes,
        "created_at": review.created_at.isoformat(),
        "updated_at": review.updated_at.isoformat(),
        "trade_items": [_item_dict(i) for i in trade_items],
        "hold_items": [_item_dict(i) for i in hold_items],
        "open_suggestions": open_suggestions,
    }


# ── Update review header ───────────────────────────────────────────────────────

@router.put("/{review_id}")
async def update_review(review_id: uuid.UUID, body: ReviewUpdate, user_id: UserId, db: DB) -> dict[str, str]:
    review = await _get_or_404(review_id, user_id, db)
    if body.name is not None:
        review.name = body.name
    if body.notes is not None:
        review.notes = body.notes or None
    await db.commit()
    return {"status": "ok"}


# ── Delete review ──────────────────────────────────────────────────────────────

@router.delete("/{review_id}")
async def delete_review(review_id: uuid.UUID, user_id: UserId, db: DB) -> Response:
    review = await _get_or_404(review_id, user_id, db)
    await db.delete(review)
    await db.commit()
    return Response(status_code=204)


# ── Sync TRADE items from portfolio_positions_db ───────────────────────────────

@router.post("/{review_id}/sync")
async def sync_from_portfolio(review_id: uuid.UUID, user_id: UserId, db: DB) -> dict[str, Any]:
    """Sync TRADE items from portfolio_positions_db.

    One record per position:
    - entry_date in week  → sets buy_date / buy_price / buy_size
    - exit_date in week   → sets sell_date / sell_price / sell_size
    - Both in same week   → single record with both legs populated
    Existing items are updated in-place (matched by source_position_id).
    """
    uid = uuid.UUID(user_id)
    review = await _get_or_404(review_id, user_id, db)

    week_start = review.week_start
    week_end = review.week_end

    result = await db.execute(
        select(PortfolioDbPosition).where(PortfolioDbPosition.user_id == uid)
    )
    positions = result.scalars().all()

    # Map existing items by source_position_id for upsert
    existing_by_pos: dict[str, WeeklyReviewItem] = {
        str(item.source_position_id): item
        for item in review.items
        if item.source_position_id and item.item_type == "TRADE"
    }

    max_order = max((i.sort_order for i in review.items), default=-1) + 1
    added = 0
    updated = 0

    for pos in positions:
        # A position is included when it has any activity (entry OR exit) during the week.
        in_week_buy  = bool(pos.entry_date and week_start <= pos.entry_date <= week_end)
        in_week_sell = bool(pos.exit_date  and week_start <= pos.exit_date  <= week_end)

        if not in_week_buy and not in_week_sell:
            continue

        pos_key = str(pos.id)
        if pos_key in existing_by_pos:
            # Update existing record — always sync buy leg from position entry, sell leg only if sold this week
            item = existing_by_pos[pos_key]
            changed = False
            if item.buy_date is None and pos.entry_date:
                item.buy_date  = pos.entry_date
                item.buy_price = pos.entry_price
                item.buy_size  = pos.position_size
                changed = True
            if in_week_sell and item.sell_date is None:
                item.sell_date  = pos.exit_date
                item.sell_price = pos.exit_price
                item.sell_size  = pos.position_size
                changed = True
            if changed:
                updated += 1
        else:
            # Always include the full buy leg (entry date/price) so sold positions
            # show entry info alongside the exit, mirroring the portfolio list view.
            item = WeeklyReviewItem(
                review_id=review_id,
                symbol=pos.symbol,
                item_type="TRADE",
                buy_date=pos.entry_date,
                buy_price=pos.entry_price,
                buy_size=pos.position_size,
                sell_date=pos.exit_date  if in_week_sell else None,
                sell_price=pos.exit_price if in_week_sell else None,
                sell_size=pos.position_size if in_week_sell else None,
                source_position_id=pos.id,
                sort_order=max_order + added,
            )
            db.add(item)
            added += 1

    await db.execute(
        text("UPDATE weekly_reviews SET updated_at = NOW() WHERE id = :id"),
        {"id": review_id},
    )
    await db.commit()
    return {"added": added, "updated": updated}


# ── Refresh Mon / Fri week prices from yfinance ───────────────────────────────

@router.post("/{review_id}/refresh-prices")
async def refresh_prices(review_id: uuid.UUID, user_id: UserId, db: DB) -> dict[str, Any]:
    """Fetch Monday-open and Friday-close prices from Yahoo Finance for every symbol in the review.

    All symbols are assumed to be Thai SET equities and appended with '.BK'.
    For the current (in-progress) week the Friday price falls back to the latest available close.
    """
    import yfinance as yf

    review = await _get_or_404(review_id, user_id, db)

    symbols = list({item.symbol for item in review.items})
    if not symbols:
        return {"updated": 0, "symbols": []}

    fetch_start = review.week_start.isoformat()
    # yfinance end is exclusive — go one day past Friday
    fetch_end = (review.week_end + timedelta(days=1)).isoformat()

    def _week_prices(symbol: str) -> tuple[float | None, float | None]:
        ticker = f"{symbol}.BK"
        try:
            df = yf.Ticker(ticker).history(
                start=fetch_start,
                end=fetch_end,
                interval="1d",
                auto_adjust=False,
                back_adjust=False,
            )
            if df.empty:
                return None, None
            opens = df["Open"].dropna()
            closes = df["Close"].dropna()
            open_p = float(opens.iloc[0]) if len(opens) >= 1 else None
            close_p = float(closes.iloc[-1]) if len(closes) >= 1 else None
            return open_p, close_p
        except Exception:
            return None, None

    prices: dict[str, tuple[float | None, float | None]] = {}
    for sym in symbols:
        prices[sym] = await asyncio.to_thread(_week_prices, sym)

    updated = 0
    for item in review.items:
        open_p, close_p = prices.get(item.symbol, (None, None))
        changed = False
        if open_p is not None:
            item.week_open_price = open_p
            changed = True
        if close_p is not None:
            item.week_close_price = close_p
            changed = True
        if changed:
            updated += 1

    await db.execute(
        text("UPDATE weekly_reviews SET updated_at = NOW() WHERE id = :id"),
        {"id": review_id},
    )
    await db.commit()

    return {
        "updated": updated,
        "symbols": [
            {"symbol": s, "week_open_price": prices[s][0], "week_close_price": prices[s][1]}
            for s in symbols
        ],
    }


# ── Bulk replace items ─────────────────────────────────────────────────────────

@router.put("/{review_id}/items")
async def replace_items(
    review_id: uuid.UUID,
    items: list[ReviewItemIn],
    user_id: UserId,
    db: DB,
) -> dict[str, str]:
    await _get_or_404(review_id, user_id, db)
    await db.execute(delete(WeeklyReviewItem).where(WeeklyReviewItem.review_id == review_id))
    await db.flush()

    for i, item in enumerate(items):
        db.add(WeeklyReviewItem(
            review_id=review_id,
            symbol=item.symbol,
            item_type=item.item_type,
            buy_date=item.buy_date,
            buy_price=item.buy_price,
            buy_size=item.buy_size,
            sell_date=item.sell_date,
            sell_price=item.sell_price,
            sell_size=item.sell_size,
            buy_reason=item.buy_reason,
            buy_feeling=item.buy_feeling,
            sell_reason=item.sell_reason,
            sell_feeling=item.sell_feeling,
            source_position_id=item.source_position_id,
            sort_order=i,
        ))

    await db.execute(
        text("UPDATE weekly_reviews SET updated_at = NOW() WHERE id = :id"),
        {"id": review_id},
    )
    await db.commit()
    return {"status": "ok"}


# ── Patch single item (reason / feeling) ──────────────────────────────────────

@router.patch("/{review_id}/items/{item_id}")
async def patch_item(
    review_id: uuid.UUID,
    item_id: uuid.UUID,
    body: ReviewItemPatch,
    user_id: UserId,
    db: DB,
) -> dict[str, Any]:
    uid = uuid.UUID(user_id)

    result = await db.execute(
        select(WeeklyReview.id).where(
            WeeklyReview.id == review_id, WeeklyReview.user_id == uid
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Review not found")

    result = await db.execute(
        select(WeeklyReviewItem).where(
            WeeklyReviewItem.id == item_id,
            WeeklyReviewItem.review_id == review_id,
        )
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    if body.buy_reason is not None:
        item.buy_reason = body.buy_reason or None
    if "buy_feeling" in body.model_fields_set:
        item.buy_feeling = body.buy_feeling
    if body.sell_reason is not None:
        item.sell_reason = body.sell_reason or None
    if "sell_feeling" in body.model_fields_set:
        item.sell_feeling = body.sell_feeling

    await db.execute(
        text("UPDATE weekly_reviews SET updated_at = NOW() WHERE id = :id"),
        {"id": review_id},
    )
    await db.commit()
    await db.refresh(item)
    return _item_dict(item)


# ── Delete single item ─────────────────────────────────────────────────────────

@router.delete("/{review_id}/items/{item_id}")
async def delete_item(
    review_id: uuid.UUID,
    item_id: uuid.UUID,
    user_id: UserId,
    db: DB,
) -> Response:
    uid = uuid.UUID(user_id)

    result = await db.execute(
        select(WeeklyReview.id).where(
            WeeklyReview.id == review_id, WeeklyReview.user_id == uid
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Review not found")

    result = await db.execute(
        select(WeeklyReviewItem).where(
            WeeklyReviewItem.id == item_id,
            WeeklyReviewItem.review_id == review_id,
        )
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    await db.delete(item)
    await db.execute(
        text("UPDATE weekly_reviews SET updated_at = NOW() WHERE id = :id"),
        {"id": review_id},
    )
    await db.commit()
    return Response(status_code=204)


# ── Add single item ────────────────────────────────────────────────────────────

@router.post("/{review_id}/items", status_code=status.HTTP_201_CREATED)
async def add_item(
    review_id: uuid.UUID,
    body: ReviewItemIn,
    user_id: UserId,
    db: DB,
) -> dict[str, Any]:
    review = await _get_or_404(review_id, user_id, db)

    max_order = max((i.sort_order for i in review.items), default=-1) + 1
    item = WeeklyReviewItem(
        review_id=review_id,
        symbol=body.symbol,
        item_type=body.item_type,
        buy_date=body.buy_date,
        buy_price=body.buy_price,
        buy_size=body.buy_size,
        sell_date=body.sell_date,
        sell_price=body.sell_price,
        sell_size=body.sell_size,
        buy_reason=body.buy_reason,
        buy_feeling=body.buy_feeling,
        sell_reason=body.sell_reason,
        sell_feeling=body.sell_feeling,
        source_position_id=body.source_position_id,
        sort_order=body.sort_order if body.sort_order else max_order,
    )
    db.add(item)
    await db.execute(
        text("UPDATE weekly_reviews SET updated_at = NOW() WHERE id = :id"),
        {"id": review_id},
    )
    await db.commit()
    await db.refresh(item)
    return _item_dict(item)
