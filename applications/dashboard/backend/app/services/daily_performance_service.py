"""Daily performance snapshot service.

Responsible for computing and persisting a point-in-time portfolio snapshot
for one portfolio or all portfolios.  Called from:

  * The APScheduler job (nightly, Mon–Fri at 23:30 Bangkok time).
  * The POST /api/v1/daily-performance/run endpoint (on-demand, single portfolio).
  * The POST /api/v1/daily-performance/backfill endpoint (one-time historical fill).

Public surface
--------------
  run_daily_snapshot(db, user_id, snapshot_date, portfolio_id)     →  DailyPerformance
  run_historical_backfill(db, user_id, portfolio_id, start_date)   →  dict
  run_snapshot_for_all_portfolios(db, snapshot_date)               →  dict

Investment calculation (as of migration c3d4e5f6a7b8)
------------------------------------------------------
  ``investment`` is now the cumulative SUM of portfolio_cash_transactions.amount
  WHERE portfolio_id = ? AND date <= snapshot_date, rather than the cost-basis of
  open positions.  Callers query this sum before calling ``_compute_snapshot_values``
  and pass it as ``cash_investment``.  If no cash transactions have been recorded,
  cash_investment = 0.0 and investment shows as zero until the user seeds data.

Backfill semantics (as of migration c3d4e5f6a7b8)
--------------------------------------------------
  ``run_historical_backfill`` performs a DELETE-then-INSERT rather than idempotent
  upserts.  All existing daily_performance rows for the portfolio are deleted before
  the iteration loop begins, so the resulting history is guaranteed to be fresh.
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Callable
from datetime import date, timedelta

from sqlalchemy import delete as sa_delete
from sqlalchemy import func as sa_func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.daily_performance import DailyPerformance
from app.models.portfolio import InvestmentTransaction
from app.models.portfolio_db import PortfolioDbPosition

_log = get_logger("daily_performance_service")

# Module-level set tracking portfolio IDs that currently have a backfill in
# progress.  Python's GIL makes basic set operations thread-safe in a
# single-process deployment (the normal FastAPI/uvicorn configuration).
# Returns HTTP 409 when a second request arrives for the same portfolio.
# NOTE: uvicorn must run with --workers=1 for this guard to be effective.
_active_backfills: set[str] = set()


# ── Price helpers ─────────────────────────────────────────────────────────────

def _fetch_price(symbol: str) -> float | None:
    """Fetch the most-recent closing price for a SET-listed symbol via yfinance.

    Appends ``.BK`` suffix so that bare ticker symbols (e.g. ``PTT``) are
    resolved to their Bangkok Exchange identifiers (``PTT.BK``).

    Returns ``None`` on any network or parsing error so callers can treat a
    missing price as zero P&L rather than crashing the snapshot.
    """
    import yfinance as yf  # deferred — only needed at runtime

    try:
        hist = yf.Ticker(f"{symbol}.BK").history(period="2d")
        if not hist.empty:
            return float(hist["Close"].iloc[-1])
    except Exception as exc:  # noqa: BLE001
        _log.warning(
            "daily_performance.price_fetch_failed",
            symbol=symbol,
            error=str(exc),
        )
    return None


def _fetch_price_history(
    symbol: str,
    start_date: date,
    end_date: date,
) -> dict[date, float]:
    """Fetch the full closing-price history for a SET-listed symbol via yfinance.

    Issues a single ``Ticker.history()`` call covering the entire date range so
    callers can pre-load all prices before iterating over individual days —
    avoiding one yfinance call per day during a backfill.

    Only actual trading days appear as keys in the returned dict.  Weekday
    market holidays (Thai public holidays) are absent; callers should use
    ``_get_historical_price`` which does a backwards carry-forward search.

    Args:
        symbol:     Bare ticker (e.g. ``"PTT"`` — ``".BK"`` suffix added here).
        start_date: First date of the range (inclusive).
        end_date:   Last date of the range (inclusive).

    Returns:
        ``{date: closing_price}`` for each trading day in the range.
        Returns an empty dict on any fetch failure so callers degrade
        gracefully rather than raising.
    """
    import yfinance as yf  # deferred — only needed at runtime

    try:
        ticker = yf.Ticker(f"{symbol}.BK")
        hist = ticker.history(
            start=start_date.isoformat(),
            # yfinance end parameter is exclusive — add one day to include end_date
            end=(end_date + timedelta(days=1)).isoformat(),
        )
        if hist.empty:
            _log.warning(
                "daily_performance.price_history_empty",
                symbol=symbol,
                start_date=start_date.isoformat(),
                end_date=end_date.isoformat(),
            )
            return {}

        result: dict[date, float] = {}
        for ts, price in hist["Close"].items():
            # Timestamps from yfinance may be timezone-aware; .date() normalises
            d = ts.date() if hasattr(ts, "date") else ts
            result[d] = float(price)
        return result

    except Exception as exc:  # noqa: BLE001
        _log.warning(
            "daily_performance.price_history_fetch_failed",
            symbol=symbol,
            error=str(exc),
        )
        return {}


def _get_historical_price(
    price_history: dict[str, dict[date, float]],
    symbol: str,
    d: date,
) -> float | None:
    """Return the closing price for ``symbol`` on date ``d``.

    yfinance omits rows for market holidays (Thai public holidays that fall on
    weekdays).  When the requested date is absent from the dict this helper
    searches backwards up to five calendar days to carry the most-recent
    available close forward — covering single-day holidays and long weekends.

    Returns ``None`` only when no price at all is available for the symbol
    (e.g. newly listed, fetch failed, or date precedes the listing).
    """
    sym_hist = price_history.get(symbol, {})
    if not sym_hist:
        return None
    if d in sym_hist:
        return sym_hist[d]
    for i in range(1, 6):
        prev = d - timedelta(days=i)
        if prev in sym_hist:
            return sym_hist[prev]
    return None


# ── P&L helper ────────────────────────────────────────────────────────────────

def _pos_net_pnl(pos: PortfolioDbPosition) -> float:
    """Return the realised net P&L for a closed position.

    Returns 0.0 when any of entry_price, exit_price, or position_size is None
    so callers never receive NaN or TypeError from arithmetic on nulls.
    """
    if pos.exit_price is None or pos.entry_price is None or pos.position_size is None:
        return 0.0
    ep = float(pos.entry_price)
    xp = float(pos.exit_price)
    sz = pos.position_size
    diff = (xp - ep) if (pos.direction or "LONG").upper() != "SHORT" else (ep - xp)
    return round(diff * sz, 2)


def _merge_same_symbol_positions(positions: list[dict]) -> list[dict]:
    """Collapse same-symbol/same-entry rows produced by partial sells.

    A partial sell splits one DB row into two: a shrunk "active" parent
    (remaining size) and a "closed" child (sold size) — both sharing the same
    symbol, entry_price, and entry_date.  Left unmerged, the same position
    appears twice in a single day's display list, which is mathematically
    correct (sizes sum) but confusing to render as two separate chips.

    Grouping key: ``(symbol, buy_price, entry_date)`` — plus ``close_price``
    for ``sold_positions_list`` (equal to ``exit_price`` in that list), since
    two sales of the same symbol/entry at different exit prices must stay
    distinct. Equality is exact (no float tolerance) — ``buy_price`` is
    already a clean float derived from ``entry_price``, and any two rows
    genuinely produced by the same partial-sell split will match exactly.

    ``entry_date`` is nullable (``portfolio_db.py`` allows a blank "Entry
    Date" on Excel import) so an entry with ``entry_date is None`` is never
    merged with anything — not even another entry that also has
    ``entry_date=None`` and the same symbol/buy_price — because a missing
    entry_date means the "same partial-sell split" invariant that justifies
    merging cannot be verified. Such entries always form their own singleton
    group.

    For each group of 2+ entries: ``size`` and ``pnl`` are summed; all other
    fields (``buy_price``, ``close_price``, ``entry_date``, and for sold
    positions ``exit_date``/``exit_price``) are copied from any one member,
    since they are identical by construction of the key. ``pnl_pct`` is
    identical across the group by construction (same price on both sides) —
    that invariant is checked defensively (raises ``ValueError``, not
    ``assert``, so it can never be stripped under ``-O``); a violation would
    mean the grouping key missed a differing field and must be fixed at the
    source, not papered over.

    Groups of exactly 1 entry pass through unchanged (same dict, not copied).
    An empty input list returns an empty list (never ``None``) — the
    caller's existing ``if list else None`` conversion happens afterwards.
    """
    groups: dict[tuple, list[dict]] = {}
    order: list[tuple] = []
    for entry in positions:
        if entry["entry_date"] is None:
            # entry_date is nullable (blank "Entry Date" on Excel import in
            # portfolio_db.py) — without a real entry_date we cannot verify the
            # "same partial-sell split" invariant, so key on id(entry) to force
            # a unique, unmergeable singleton group for every such row.
            key = (id(entry),)
        else:
            key = (entry["symbol"], entry["buy_price"], entry["entry_date"])
            if "exit_price" in entry:
                key = key + (entry["close_price"],)
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(entry)

    merged: list[dict] = []
    for key in order:
        group = groups[key]
        if len(group) == 1:
            merged.append(group[0])
            continue

        first = group[0]
        pnl_pct = first["pnl_pct"]
        if not all(e["pnl_pct"] == pnl_pct for e in group):
            # Not an assert: asserts can be stripped under -O, and letting this
            # invariant violation through would silently misreport financial
            # P&L to the end user instead of failing loudly.
            raise ValueError(
                "Same-symbol/entry/exit merge group has divergent pnl_pct — "
                "grouping key is missing a differentiating field: "
                f"symbol={first['symbol']!r} key={key!r}"
            )

        merged_entry = dict(first)
        merged_entry["size"] = sum(e["size"] for e in group)
        merged_entry["pnl"] = round(sum(e["pnl"] for e in group), 2)
        merged.append(merged_entry)

    return merged


# ── Shared snapshot computation ────────────────────────────────────────────────

def _compute_snapshot_values(
    positions: list[PortfolioDbPosition],
    snapshot_date: date,
    price_lookup: Callable[[str], float | None],
    cash_investment: float = 0.0,
) -> dict:
    """Compute all P&L figures for a portfolio snapshot at ``snapshot_date``.

    This is the single source of truth for portfolio P&L business logic.
    Accepts a ``price_lookup`` callable so the same computation serves both
    the live snapshot path (prices fetched in real time) and the historical
    backfill path (prices pre-fetched into an in-memory dict).

    Investment semantics
    --------------------
    ``investment`` is taken directly from ``cash_investment`` (the cumulative
    sum of portfolio_cash_transactions.amount WHERE date <= snapshot_date).
    It no longer reflects the cost-basis of open positions.  Percentage fields
    (closed_pnl_pct, open_pnl_pct) use cash_investment as their denominator.
    When cash_investment = 0 the percentage fields are 0.0.

    Position classification on ``snapshot_date``
    --------------------------------------------
    - **Open on date**: ``status='active'`` OR (``status='closed'`` AND
      ``exit_date > snapshot_date``).  These need live/historical prices.
    - **Closed by date**: ``status='closed'`` AND ``exit_date <= snapshot_date``.
      Contribute to closed_pnl.
    - **Purchased today**: ``entry_date == snapshot_date``.  Subset of all
      positions; their open P&L since entry uses the snapshot-date price.
    - **Sold today**: ``status='closed'`` AND ``exit_date == snapshot_date``.
      close_price = exit_price; pnl = realised net P&L.

    Args:
        positions:        All portfolio positions with entry_date <= snapshot_date.
        snapshot_date:    The calendar date for which the snapshot is computed.
        price_lookup:     Callable(symbol) → closing price (or None if unavailable).
        cash_investment:  Cumulative cash deposited up to and including
                          snapshot_date (from portfolio_cash_transactions).
                          Defaults to 0.0 when no transactions exist.

    Returns:
        Dict with keys: investment, closed_pnl, closed_pnl_pct, open_pnl,
        open_pnl_pct, open_positions, purchased_positions, sold_positions
        — matching the DailyPerformance columns.
    """
    # ── Classify positions by state on snapshot_date ─────────────────────────
    open_on_date = [
        pos
        for pos in positions
        if pos.status == "active"
        or (
            pos.status == "closed"
            and pos.exit_date is not None
            and pos.exit_date > snapshot_date
        )
    ]
    closed_positions = [
        pos
        for pos in positions
        if pos.status == "closed"
        and pos.exit_date is not None
        and pos.exit_date <= snapshot_date
    ]

    # ── Investment: cumulative cash deposited (not cost-basis) ───────────────
    investment = cash_investment

    # ── Closed P&L: net realised gain/loss from positions exited by snapshot_date
    closed_pnl = sum(_pos_net_pnl(pos) for pos in closed_positions)
    closed_pnl_pct = (
        round((closed_pnl / investment) * 100, 4) if investment > 0 else 0.0
    )

    # ── Open P&L + enriched open_positions list (with buy_price, close_price) ─
    open_pnl = 0.0
    open_positions_list: list[dict] = []

    for pos in open_on_date:
        ep = float(pos.entry_price or 0)
        cp = price_lookup(pos.symbol)
        sz = pos.position_size or 0
        pos_pnl = 0.0
        pos_pnl_pct = 0.0

        if ep and cp and sz:
            is_short = (pos.direction or "LONG").upper() == "SHORT"
            diff = (cp - ep) if not is_short else (ep - cp)
            pos_pnl = round(diff * sz, 2)
            pos_pnl_pct = round((diff / ep) * 100, 4) if ep else 0.0

        open_pnl += pos_pnl
        open_positions_list.append(
            {
                "symbol": pos.symbol,
                "size": pos.position_size or 0,
                "buy_price": ep,
                "close_price": cp,
                "pnl": pos_pnl,
                "pnl_pct": pos_pnl_pct,
                "entry_date": pos.entry_date.isoformat() if pos.entry_date else None,
            }
        )

    open_pnl = round(open_pnl, 2)
    open_pnl_pct = (
        round((open_pnl / investment) * 100, 4) if investment > 0 else 0.0
    )

    # ── Purchased positions: opened on snapshot_date ──────────────────────────
    # P&L = open P&L since entry at today's close price.
    purchased_positions_list: list[dict] = []
    for pos in positions:
        if pos.entry_date != snapshot_date:
            continue
        ep = float(pos.entry_price or 0)
        cp = price_lookup(pos.symbol)
        sz = pos.position_size or 0
        pos_pnl = 0.0
        pos_pnl_pct = 0.0
        if ep and cp and sz:
            is_short = (pos.direction or "LONG").upper() == "SHORT"
            diff = (cp - ep) if not is_short else (ep - cp)
            pos_pnl = round(diff * sz, 2)
            pos_pnl_pct = round((diff / ep) * 100, 4) if ep else 0.0
        purchased_positions_list.append(
            {
                "symbol": pos.symbol,
                "size": pos.position_size or 0,
                "buy_price": ep,
                "close_price": cp,
                "pnl": pos_pnl,
                "pnl_pct": pos_pnl_pct,
                "entry_date": pos.entry_date.isoformat() if pos.entry_date else None,
            }
        )

    # ── Sold positions: closed on snapshot_date ───────────────────────────────
    # close_price = exit_price; pnl = realised net P&L.
    sold_positions_list: list[dict] = []
    for pos in positions:
        if not (pos.status == "closed" and pos.exit_date == snapshot_date):
            continue
        ep = float(pos.entry_price or 0)
        xp = float(pos.exit_price or 0)
        sz = pos.position_size or 0
        pos_pnl = _pos_net_pnl(pos)
        # pnl_pct: (exit - entry) / entry × 100 for LONG; simplified per-share basis
        pos_pnl_pct = round((xp - ep) / ep * 100, 4) if ep > 0 else 0.0
        sold_positions_list.append(
            {
                "symbol": pos.symbol,
                "size": pos.position_size or 0,
                "buy_price": ep,
                "close_price": xp,
                "pnl": pos_pnl,
                "pnl_pct": pos_pnl_pct,
                "entry_date": pos.entry_date.isoformat() if pos.entry_date else None,
                "exit_date": pos.exit_date.isoformat() if pos.exit_date else None,
                "exit_price": xp,
            }
        )

    open_positions_list = _merge_same_symbol_positions(open_positions_list)
    purchased_positions_list = _merge_same_symbol_positions(purchased_positions_list)
    sold_positions_list = _merge_same_symbol_positions(sold_positions_list)

    return {
        "investment": investment,
        "closed_pnl": closed_pnl,
        "closed_pnl_pct": closed_pnl_pct,
        "open_pnl": open_pnl,
        "open_pnl_pct": open_pnl_pct,
        "open_positions": open_positions_list if open_positions_list else None,
        "purchased_positions": purchased_positions_list if purchased_positions_list else None,
        "sold_positions": sold_positions_list if sold_positions_list else None,
    }


# ── Core snapshot logic ───────────────────────────────────────────────────────

async def run_daily_snapshot(
    db: AsyncSession,
    user_id: str,
    snapshot_date: date,
    portfolio_id: str,
) -> DailyPerformance:
    """Compute and upsert the daily performance snapshot for a single portfolio.

    Steps
    -----
    1. Load all positions for the portfolio with entry_date <= snapshot_date.
    2. Determine which positions were open on snapshot_date (need live prices).
    3. Fetch live prices for those symbols in parallel via yfinance.
    4. Query cumulative cash investment from portfolio_cash_transactions.
    5. Delegate all P&L computation to ``_compute_snapshot_values``.
    6. Upsert into daily_performance via PostgreSQL ON CONFLICT DO UPDATE so
       the operation is idempotent — re-running for the same day refreshes the
       numbers rather than creating a duplicate row.
    7. Return the upserted row (re-queried from the DB).

    Args:
        db:             Async SQLAlchemy session.
        user_id:        String UUID of the user.
        snapshot_date:  Calendar date for the snapshot.
        portfolio_id:   String UUID of the target portfolio.

    Returns:
        The freshly upserted DailyPerformance ORM row.
    """
    from sqlalchemy.dialects.postgresql import insert as pg_insert  # deferred

    user_uuid = uuid.UUID(user_id)
    portfolio_uuid = uuid.UUID(portfolio_id)

    _log.info(
        "daily_performance.snapshot_start",
        user_id=user_id,
        portfolio_id=portfolio_id,
        snapshot_date=snapshot_date.isoformat(),
    )

    # ── 1. Fetch positions ────────────────────────────────────────────────────
    q = select(PortfolioDbPosition).where(
        PortfolioDbPosition.user_id == user_uuid,
        PortfolioDbPosition.portfolio_id == portfolio_uuid,
        PortfolioDbPosition.entry_date <= snapshot_date,
    )
    result = await db.execute(q)
    positions = result.scalars().all()

    # ── 2. Determine positions open on snapshot_date (need live prices) ───────
    open_on_date = [
        pos
        for pos in positions
        if pos.status == "active"
        or (
            pos.status == "closed"
            and pos.exit_date is not None
            and pos.exit_date > snapshot_date
        )
    ]
    open_symbols = list({pos.symbol for pos in open_on_date})

    # ── 3. Fetch live prices in parallel ──────────────────────────────────────
    prices: dict[str, float | None] = {}
    if open_symbols:
        loop = asyncio.get_running_loop()
        price_results = await asyncio.gather(
            *[
                loop.run_in_executor(None, _fetch_price, sym)
                for sym in open_symbols
            ],
            return_exceptions=True,
        )
        for sym, pr in zip(open_symbols, price_results):
            prices[sym] = pr if not isinstance(pr, Exception) else None

    # ── 4. Query cumulative cash investment ───────────────────────────────────
    from sqlalchemy import case as sa_case  # deferred
    cash_sum_result = await db.execute(
        select(
            sa_func.coalesce(
                sa_func.sum(
                    sa_case(
                        (InvestmentTransaction.action == "CASH_OUT", -InvestmentTransaction.amount),
                        else_=InvestmentTransaction.amount,
                    )
                ),
                0,
            )
        ).where(
            InvestmentTransaction.portfolio_id == portfolio_uuid,
            InvestmentTransaction.date <= snapshot_date,
        )
    )
    cash_investment = float(cash_sum_result.scalar_one())

    # ── 5. Compute P&L values via shared helper ───────────────────────────────
    def price_lookup(symbol: str) -> float | None:
        return prices.get(symbol)

    upsert_values = _compute_snapshot_values(
        list(positions),
        snapshot_date,
        price_lookup,
        cash_investment=cash_investment,
    )

    # ── 5b. Compute acc_pnl: prior day's value + today's realized P&L ─────────
    prior_row_result = await db.execute(
        select(DailyPerformance.acc_pnl)
        .where(
            DailyPerformance.portfolio_id == portfolio_uuid,
            DailyPerformance.date < snapshot_date,
        )
        .order_by(DailyPerformance.date.desc())
        .limit(1)
    )
    prior_acc_pnl_raw = prior_row_result.scalar_one_or_none()
    if prior_acc_pnl_raw is None:
        # No prior row exists — normal for a portfolio's first ever snapshot.
        # acc_pnl starts at zero; re-running a full backfill will populate the
        # accumulated history correctly.
        prior_acc_pnl = 0.0
        _log.info(
            "daily_performance.snapshot_acc_pnl_no_prior_record",
            portfolio_id=portfolio_id,
            snapshot_date=snapshot_date.isoformat(),
        )
    else:
        prior_acc_pnl = float(prior_acc_pnl_raw)

    daily_pnl = sum(
        float(pos.get("pnl", 0) or 0)
        for pos in (upsert_values.get("sold_positions") or [])
    )
    upsert_values["acc_pnl"] = round(prior_acc_pnl + daily_pnl, 4)

    # ── 6. Upsert ─────────────────────────────────────────────────────────────
    stmt = (
        pg_insert(DailyPerformance)
        .values(
            id=uuid.uuid4(),
            user_id=user_uuid,
            portfolio_id=portfolio_uuid,
            date=snapshot_date,
            **upsert_values,
        )
        .on_conflict_do_update(
            constraint="uq_daily_performance_portfolio_date",
            set_={
                **upsert_values,
                "updated_at": sa_func.now(),
            },
        )
    )
    await db.execute(stmt)
    await db.commit()

    # ── 7. Re-fetch the upserted row ──────────────────────────────────────────
    fetch_result = await db.execute(
        select(DailyPerformance).where(
            DailyPerformance.portfolio_id == portfolio_uuid,
            DailyPerformance.date == snapshot_date,
        )
    )
    row = fetch_result.scalar_one()

    _log.info(
        "daily_performance.snapshot_complete",
        user_id=user_id,
        portfolio_id=portfolio_id,
        snapshot_date=snapshot_date.isoformat(),
        investment=upsert_values["investment"],
        cash_investment=cash_investment,
        closed_pnl=upsert_values["closed_pnl"],
        open_pnl=upsert_values["open_pnl"],
        open_positions=len(open_on_date),
    )
    return row


async def run_historical_backfill(
    db: AsyncSession,
    user_id: str,
    portfolio_id: str,
    start_date: date | None = None,
) -> dict:
    """Delete all existing records and re-populate daily_performance from scratch.

    Steps
    -----
    1. Acquire the per-portfolio concurrency lock; raise RuntimeError if another
       backfill is already running for this portfolio.
    2. Fetch all positions for the portfolio (no date filter — the full history
       is needed to correctly classify positions as open/closed on each past day).
    3. Determine the date range.
    4. DELETE all existing daily_performance rows for this portfolio.
    5. Pre-fetch cash transactions for investment computation.
    6. Collect all unique symbols and fetch price history in parallel.
    7. Iterate over every weekday (Mon–Fri) in the range; compute cash_investment
       as SUM(amount WHERE tx.date <= snapshot_date); insert each day.
    8. Release the concurrency lock (always, via finally).
    9. Return a summary dict.

    Destructive behaviour
    ---------------------
    All existing daily_performance rows for the portfolio are deleted before
    iteration begins.  A mid-run failure leaves a partial history.  Re-running
    the backfill will delete the partial history and start fresh.

    Args:
        db:           Async SQLAlchemy session.
        user_id:      String UUID of the authenticated user.
        portfolio_id: String UUID of the target portfolio.
        start_date:   Override the auto-detected start date.

    Returns:
        Dict: ``{processed, skipped, errors, start_date, end_date}``.

    Raises:
        RuntimeError: A backfill is already running for this portfolio.
        ValueError:   Explicit ``start_date`` exceeds the maximum lookback window.
    """
    from sqlalchemy.dialects.postgresql import insert as pg_insert  # deferred

    user_uuid = uuid.UUID(user_id)
    portfolio_uuid = uuid.UUID(portfolio_id)
    today = date.today()

    # ── 0. Concurrency guard ──────────────────────────────────────────────────
    if portfolio_id in _active_backfills:
        raise RuntimeError(
            f"A backfill is already in progress for portfolio {portfolio_id}. "
            "Please wait for it to complete before starting another."
        )
    _active_backfills.add(portfolio_id)

    try:
        _log.info(
            "daily_performance.backfill_start",
            user_id=user_id,
            portfolio_id=portfolio_id,
            override_start_date=start_date.isoformat() if start_date else "auto",
        )

        # ── 1. Fetch ALL positions (unfiltered by date) ───────────────────────
        q = select(PortfolioDbPosition).where(
            PortfolioDbPosition.user_id == user_uuid,
            PortfolioDbPosition.portfolio_id == portfolio_uuid,
        )
        result = await db.execute(q)

        all_positions: list[PortfolioDbPosition] = [
            p for p in result.scalars().all() if p.entry_date is not None
        ]

        if not all_positions:
            _log.warning(
                "daily_performance.backfill_no_positions",
                user_id=user_id,
                portfolio_id=portfolio_id,
            )
            return {
                "processed": 0,
                "skipped": 0,
                "errors": 0,
                "start_date": None,
                "end_date": None,
                "message": "No positions found for this portfolio.",
            }

        # ── 2. Determine date range ────────────────────────────────────────────
        detected_start = min(pos.entry_date for pos in all_positions)
        effective_start = start_date if start_date is not None else detected_start
        end_date = today

        if start_date is not None:
            _MAX_BACKFILL_DAYS = 3650  # 10 years
            if (end_date - effective_start).days > _MAX_BACKFILL_DAYS:
                earliest_allowed = end_date - timedelta(days=_MAX_BACKFILL_DAYS)
                raise ValueError(
                    f"start_date {effective_start.isoformat()} exceeds the maximum "
                    f"backfill window of {_MAX_BACKFILL_DAYS} days. "
                    f"Earliest allowed: {earliest_allowed.isoformat()}."
                )

        _log.info(
            "daily_performance.backfill_range",
            portfolio_id=portfolio_id,
            effective_start=effective_start.isoformat(),
            end_date=end_date.isoformat(),
            total_positions=len(all_positions),
        )

        # ── 3. Delete all existing daily_performance rows for this portfolio ──
        _log.info(
            "daily_performance.backfill_delete_existing",
            portfolio_id=portfolio_id,
        )
        await db.execute(
            sa_delete(DailyPerformance).where(
                DailyPerformance.portfolio_id == portfolio_uuid
            )
        )
        await db.commit()
        _log.info(
            "daily_performance.backfill_delete_complete",
            portfolio_id=portfolio_id,
        )

        # Re-fetch positions and cash transactions after the delete commit.
        # The commit expires ALL objects loaded in this session via SQLAlchemy's
        # expire_on_commit=True default.  Accessing expired attributes in an async
        # session triggers a synchronous lazy-load which raises MissingGreenlet.
        # We immediately expunge every object from the session so that future
        # per-day commits cannot expire them again — detached objects retain their
        # already-loaded column values without any DB round-trip.
        result2 = await db.execute(
            select(PortfolioDbPosition).where(
                PortfolioDbPosition.user_id == user_uuid,
                PortfolioDbPosition.portfolio_id == portfolio_uuid,
            )
        )
        all_positions_raw = [p for p in result2.scalars().all() if p.entry_date is not None]
        for pos in all_positions_raw:
            db.expunge(pos)
        all_positions = all_positions_raw

        # ── 4. Pre-fetch cash transactions for investment computation ──────────
        cash_q = (
            select(InvestmentTransaction)
            .where(InvestmentTransaction.portfolio_id == portfolio_uuid)
            .order_by(InvestmentTransaction.date.asc())
        )
        cash_result = await db.execute(cash_q)
        cash_txns_raw = cash_result.scalars().all()
        # Expunge cash transactions too — same reason as positions above.
        cash_pairs: list[tuple[date, float]] = []
        for tx in cash_txns_raw:
            cash_pairs.append((
                tx.date,
                -float(tx.amount) if tx.action == "CASH_OUT" else float(tx.amount),
            ))
            db.expunge(tx)
        _log.info(
            "daily_performance.backfill_cash_transactions_loaded",
            portfolio_id=portfolio_id,
            count=len(cash_pairs),
        )

        # ── 5. Collect all unique symbols ──────────────────────────────────────
        all_symbols = list({pos.symbol for pos in all_positions})

        # ── 6. Fetch price history for all symbols in parallel ─────────────────
        loop = asyncio.get_running_loop()
        history_results = await asyncio.gather(
            *[
                loop.run_in_executor(
                    None, _fetch_price_history, sym, effective_start, end_date
                )
                for sym in all_symbols
            ],
            return_exceptions=True,
        )

        price_history: dict[str, dict[date, float]] = {}
        for sym, hist in zip(all_symbols, history_results):
            if isinstance(hist, Exception):
                _log.warning(
                    "daily_performance.backfill_symbol_history_failed",
                    symbol=sym,
                    error=str(hist),
                )
                price_history[sym] = {}
            else:
                price_history[sym] = hist  # type: ignore[assignment]

        # ── 7. Iterate over date range and insert ─────────────────────────────

        def _make_price_lookup(snap_date: date) -> Callable[[str], float | None]:
            def _lookup(symbol: str) -> float | None:
                return _get_historical_price(price_history, symbol, snap_date)
            return _lookup

        processed = 0
        skipped = 0
        errors = 0
        current = effective_start
        acc_pnl_running: float = 0.0

        while current <= end_date:
            # Skip weekends — SET market is closed Saturday (5) and Sunday (6)
            if current.weekday() >= 5:
                current += timedelta(days=1)
                continue

            snapshot_date = current

            positions_on_date = [
                pos for pos in all_positions
                if pos.entry_date <= snapshot_date
            ]

            if not positions_on_date:
                skipped += 1
                current += timedelta(days=1)
                continue

            # Snapshot the accumulator so it can be restored if the DB write fails.
            # Without this guard a failed commit leaves acc_pnl_running incremented,
            # causing every subsequent successfully-persisted row to carry a wrong value.
            acc_pnl_before = acc_pnl_running

            try:
                # Cumulative cash investment up to snapshot_date
                cash_investment = sum(
                    amt for d, amt in cash_pairs if d <= snapshot_date
                )

                upsert_values = _compute_snapshot_values(
                    positions_on_date,
                    snapshot_date,
                    _make_price_lookup(snapshot_date),
                    cash_investment=cash_investment,
                )

                # Accumulate daily realized P&L into acc_pnl_running
                daily_pnl = sum(
                    float(pos.get("pnl", 0) or 0)
                    for pos in (upsert_values.get("sold_positions") or [])
                )
                acc_pnl_running += daily_pnl
                upsert_values["acc_pnl"] = round(acc_pnl_running, 4)

                stmt = (
                    pg_insert(DailyPerformance)
                    .values(
                        id=uuid.uuid4(),
                        user_id=user_uuid,
                        portfolio_id=portfolio_uuid,
                        date=snapshot_date,
                        **upsert_values,
                    )
                    .on_conflict_do_update(
                        constraint="uq_daily_performance_portfolio_date",
                        set_={
                            **upsert_values,
                            "updated_at": sa_func.now(),
                        },
                    )
                )
                await db.execute(stmt)
                await db.commit()
                processed += 1

                if processed % 50 == 0:
                    _log.info(
                        "daily_performance.backfill_progress",
                        portfolio_id=portfolio_id,
                        processed=processed,
                        current_date=snapshot_date.isoformat(),
                    )

            except Exception as exc:  # noqa: BLE001
                # Restore accumulator so subsequent days are not skewed by the failed day.
                acc_pnl_running = acc_pnl_before
                errors += 1
                try:
                    await db.rollback()
                except Exception:  # noqa: BLE001
                    pass
                _log.error(
                    "daily_performance.backfill_day_failed",
                    portfolio_id=portfolio_id,
                    snapshot_date=snapshot_date.isoformat(),
                    error=str(exc),
                )

            current += timedelta(days=1)

        summary: dict = {
            "processed": processed,
            "skipped": skipped,
            "errors": errors,
            "start_date": effective_start.isoformat(),
            "end_date": end_date.isoformat(),
        }
        _log.info(
            "daily_performance.backfill_complete",
            portfolio_id=portfolio_id,
            **summary,
        )
        return summary

    finally:
        _active_backfills.discard(portfolio_id)


async def run_snapshot_for_all_portfolios(
    db: AsyncSession,
    snapshot_date: date,
) -> dict:
    """Compute and upsert daily performance snapshots for every portfolio.

    Called by the APScheduler nightly job.  Iterates all portfolios across all
    users.  A snapshot is written per portfolio, not per user.  Failures for
    individual portfolios are logged and counted rather than propagated so a
    single bad portfolio cannot abort the entire batch.

    Args:
        db:             Async DB session shared across the batch.
        snapshot_date:  Calendar date for the snapshots (typically today).

    Returns:
        Dict with ``succeeded``, ``failed``, and ``total`` counts.
    """
    from app.models.portfolio import Portfolio  # deferred to avoid circular import

    _log.info(
        "daily_performance.batch_start",
        snapshot_date=snapshot_date.isoformat(),
    )

    result = await db.execute(select(Portfolio.id, Portfolio.user_id))
    portfolios = result.fetchall()  # list of (id, user_id) tuples

    succeeded = 0
    failed = 0

    for portfolio_id, user_id_val in portfolios:
        try:
            await run_daily_snapshot(
                db,
                user_id=str(user_id_val),
                snapshot_date=snapshot_date,
                portfolio_id=str(portfolio_id),
            )
            succeeded += 1
        except Exception as exc:  # noqa: BLE001
            failed += 1
            try:
                await db.rollback()
            except Exception:  # noqa: BLE001
                pass
            _log.error(
                "daily_performance.portfolio_snapshot_failed",
                portfolio_id=str(portfolio_id),
                user_id=str(user_id_val),
                snapshot_date=snapshot_date.isoformat(),
                error=str(exc),
            )

    summary = {"succeeded": succeeded, "failed": failed, "total": len(portfolios)}
    _log.info("daily_performance.batch_complete", **summary)
    return summary
