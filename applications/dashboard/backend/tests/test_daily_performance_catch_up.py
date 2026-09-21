"""Unit tests for the daily_performance catch-up feature.

Covers ``run_catch_up_snapshot`` in
``app.services.daily_performance_service`` and the
``POST /daily-performance/catch-up`` endpoint wiring in
``app.api.v1.endpoints.daily_performance``.

Test categories (per Gate 2 acceptance criteria):
  1. Missing-weekday computation           -> TestMissingWeekdayComputation
  2. Historical (not live) pricing proof   -> TestHistoricalPricingProof
  3. Existing rows are never touched       -> TestExistingRowsUntouched
  4. Concurrency guard (both directions)   -> TestConcurrencyGuard
  5. acc_pnl chaining across new days      -> TestAccPnlChaining
  6. Partial failure + idempotent retry    -> TestPartialFailureAndRetry
  Endpoint wiring (status mapping, no envelope wrapping) -> TestCatchUpEndpoint

Run with:
    pytest tests/test_daily_performance_catch_up.py -v

All tests use unittest.mock — no real DB or yfinance connection required.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

import app.services.daily_performance_service as svc
from app.services.daily_performance_service import (
    run_catch_up_snapshot,
    run_historical_backfill,
)

PORTFOLIO_ID = "11111111-1111-1111-1111-111111111111"
USER_ID = "22222222-2222-2222-2222-222222222222"


# ── Test helpers ──────────────────────────────────────────────────────────────

def _pos(
    symbol: str = "PTT",
    entry_date: date | None = date(2024, 1, 2),
    exit_date: date | None = None,
    status: str = "active",
    entry_price: float = 100.0,
    exit_price: float | None = None,
    size: int = 10,
    direction: str = "LONG",
) -> MagicMock:
    """Build a minimal PortfolioDbPosition mock."""
    p = MagicMock()
    p.symbol = symbol
    p.entry_date = entry_date
    p.exit_date = exit_date
    p.status = status
    p.entry_price = entry_price
    p.exit_price = exit_price
    p.position_size = size
    p.direction = direction
    return p


def _tx(tx_date: date, amount: float, action: str = "CASH_IN") -> MagicMock:
    """Build a minimal InvestmentTransaction mock."""
    t = MagicMock()
    t.date = tx_date
    t.amount = amount
    t.action = action
    return t


def _make_db(
    latest_max_date: date | None,
    positions: list | None = None,
    cash_txns: list | None = None,
    prior_acc_pnl=None,
    extra_execute_count: int = 20,
) -> AsyncMock:
    """Build an AsyncSession mock whose execute() returns results in the exact
    sequential order run_catch_up_snapshot issues them:

      1. select(max(date))               -> scalar_one_or_none()
      2. select(PortfolioDbPosition)      -> scalars().all()
      3. select(InvestmentTransaction)    -> scalars().all()
      4. select(DailyPerformance.acc_pnl) -> scalar_one_or_none()
      5..N. per successfully-attempted date: pg_insert(...) upsert execute()
            (return value unused by the caller — generic MagicMocks suffice)

    Early-return paths (no_history / up_to_date) only ever consume call #1;
    the remaining canned results are simply never touched.
    """
    max_date_result = MagicMock()
    max_date_result.scalar_one_or_none.return_value = latest_max_date

    pos_scalars = MagicMock()
    pos_scalars.all.return_value = list(positions or [])
    pos_result = MagicMock()
    pos_result.scalars.return_value = pos_scalars

    cash_scalars = MagicMock()
    cash_scalars.all.return_value = list(cash_txns or [])
    cash_result = MagicMock()
    cash_result.scalars.return_value = cash_scalars

    acc_result = MagicMock()
    acc_result.scalar_one_or_none.return_value = prior_acc_pnl

    db = AsyncMock()
    fixed = [max_date_result, pos_result, cash_result, acc_result]
    db.execute.side_effect = fixed + [MagicMock() for _ in range(extra_execute_count)]
    return db


def _make_capturing_insert():
    """Fake pg_insert(...).values(...).on_conflict_do_update(...) chain that
    records every values(**kwargs) call so tests can inspect exactly what
    would have been written per date, in call order."""
    captured: list[dict] = []

    class _FakeValuesClause:
        def on_conflict_do_update(self, **kwargs):
            return MagicMock()

    class _FakeInsertStmt:
        def values(self, **kwargs):
            captured.append(kwargs)
            return _FakeValuesClause()

    def fake_pg_insert(table):
        return _FakeInsertStmt()

    return captured, fake_pg_insert


def _patch_today(target_date: date):
    """Return a patch context for app.services.daily_performance_service.date
    that fixes date.today() while leaving date(...) construction intact —
    mirrors the pattern already used by test_daily_performance_backfill.py."""
    p = patch("app.services.daily_performance_service.date")

    def _configure(mock_date_cls):
        mock_date_cls.today.return_value = target_date
        mock_date_cls.side_effect = lambda *a, **kw: date(*a, **kw)

    return p, _configure


@pytest.fixture(autouse=True)
def _reset_active_backfills():
    """Clear the shared concurrency set before and after every test."""
    svc._active_backfills.clear()
    yield
    svc._active_backfills.clear()


# ── 1. Missing-weekday computation ─────────────────────────────────────────────

class TestMissingWeekdayComputation:
    """Verifies the exact algorithm: iterate (latest_existing_date + 1 day)
    through date.today() inclusive, keeping only weekday() < 5 (Mon-Fri).

    Note on scenario wording vs. implementation: a strictly literal reading of
    "latest=yesterday, today is next business day -> nothing missing" would
    contradict the Gate 2 algorithm itself (latest+1day == today, a weekday,
    IS one missing day) — the case that yields truly zero missing dates is
    "latest == today already" (test_no_op_when_latest_is_today below), which
    is covered explicitly. TC_single_day_gap below covers the realistic
    "one business day behind" case at count == 1. This is called out as a
    deliberate, documented interpretation, not a silent deviation.
    """

    @pytest.mark.asyncio
    async def test_no_op_when_latest_is_today(self):
        """Latest existing row IS today -> nothing missing, status up_to_date,
        and zero further DB work is performed (only the MAX(date) query)."""
        today = date(2024, 6, 5)  # Wednesday
        db = _make_db(latest_max_date=today)
        p, configure = _patch_today(today)
        with p as mock_date_cls:
            configure(mock_date_cls)
            r = await run_catch_up_snapshot(db, USER_ID, PORTFOLIO_ID)

        assert r["status"] == "up_to_date"
        assert r["missing_dates_found"] == 0
        assert r["processed"] == 0
        assert r["latest_existing_date"] == today.isoformat()
        assert db.execute.call_count == 1

    @pytest.mark.asyncio
    async def test_single_day_gap_next_business_day(self):
        """Latest = Thursday, today = Friday (the very next business day)
        -> exactly one missing date: Friday itself."""
        latest = date(2024, 6, 6)  # Thursday
        today = date(2024, 6, 7)   # Friday
        db = _make_db(latest_max_date=latest, positions=[], cash_txns=[])
        p, configure = _patch_today(today)
        with p as mock_date_cls, patch(
            "app.services.daily_performance_service._fetch_price_history",
            return_value={},
        ):
            configure(mock_date_cls)
            r = await run_catch_up_snapshot(db, USER_ID, PORTFOLIO_ID)

        assert r["status"] == "completed"
        assert r["missing_dates_found"] == 1
        assert r["start_date"] == today.isoformat()
        assert r["end_date"] == today.isoformat()

    @pytest.mark.asyncio
    async def test_weekend_gap_only_following_monday_counts(self):
        """Latest = last Friday, today = the following Monday -> the
        intervening Saturday/Sunday are excluded; only Monday is missing
        (count == 1, not 3) — proves weekend days are skipped, not weekdays."""
        friday = date(2024, 6, 7)
        monday = date(2024, 6, 10)
        db = _make_db(latest_max_date=friday, positions=[], cash_txns=[])
        p, configure = _patch_today(monday)
        with p as mock_date_cls, patch(
            "app.services.daily_performance_service._fetch_price_history",
            return_value={},
        ):
            configure(mock_date_cls)
            r = await run_catch_up_snapshot(db, USER_ID, PORTFOLIO_ID)

        assert r["missing_dates_found"] == 1
        assert r["start_date"] == monday.isoformat()
        assert r["end_date"] == monday.isoformat()

    @pytest.mark.asyncio
    async def test_multi_day_gap_all_three_weekdays_found(self):
        """Latest = Monday, today = Thursday (same week) -> Tue/Wed/Thu are
        all missing; count == 3, computed correctly."""
        monday = date(2024, 6, 3)
        thursday = date(2024, 6, 6)
        db = _make_db(latest_max_date=monday, positions=[], cash_txns=[])
        p, configure = _patch_today(thursday)
        with p as mock_date_cls, patch(
            "app.services.daily_performance_service._fetch_price_history",
            return_value={},
        ):
            configure(mock_date_cls)
            r = await run_catch_up_snapshot(db, USER_ID, PORTFOLIO_ID)

        assert r["missing_dates_found"] == 3
        assert r["start_date"] == date(2024, 6, 4).isoformat()
        assert r["end_date"] == date(2024, 6, 6).isoformat()

    @pytest.mark.asyncio
    async def test_no_rows_exist_returns_no_history_and_does_no_work(self):
        """No daily_performance rows exist at all -> status no_history, and
        only the single MAX(date) query is ever executed (no positions/cash
        loads, no price fetches, no upserts)."""
        db = _make_db(latest_max_date=None)
        r = await run_catch_up_snapshot(db, USER_ID, PORTFOLIO_ID)

        assert r["status"] == "no_history"
        assert r["missing_dates_found"] == 0
        assert r["processed"] == 0
        assert r["latest_existing_date"] is None
        assert db.execute.call_count == 1


# ── 2. Historical (not live) pricing proof ─────────────────────────────────────

class TestHistoricalPricingProof:
    """The single most important test in this delivery: proves catch-up uses
    ONLY the historical price-history path (_fetch_price_history +
    _get_historical_price), scoped to the gap window — never the live
    _fetch_price path — and that inserted values reflect the date-specific
    historical fixture, not a live/"today" sentinel."""

    @pytest.mark.asyncio
    async def test_historical_prices_used_not_live_and_scoped_to_gap(self):
        latest = date(2024, 6, 3)   # Monday
        today = date(2024, 6, 5)    # Wednesday
        tuesday = date(2024, 6, 4)
        wednesday = today

        pos = _pos(
            symbol="PTT",
            status="active",
            entry_date=date(2024, 5, 1),  # opened well before the gap
            entry_price=100.0,
            size=10,
        )

        LIVE_SENTINEL = 999.0  # would leak in if run_daily_snapshot's live
        # path (_fetch_price) were ever mistakenly wired into catch-up.
        historical_prices = {tuesday: 111.0, wednesday: 222.0}

        def fake_fetch_price_history(symbol, start_date, end_date):
            # Record the exact scope requested so we can assert it below.
            fake_fetch_price_history.calls.append((symbol, start_date, end_date))
            return dict(historical_prices)

        fake_fetch_price_history.calls = []

        captured, fake_pg_insert = _make_capturing_insert()
        db = _make_db(
            latest_max_date=latest,
            positions=[pos],
            cash_txns=[],
            prior_acc_pnl=Decimal("0.00"),
        )

        p, configure = _patch_today(today)
        with p as mock_date_cls, patch(
            "app.services.daily_performance_service._fetch_price_history",
            side_effect=fake_fetch_price_history,
        ), patch(
            "app.services.daily_performance_service._fetch_price",
            return_value=LIVE_SENTINEL,
        ) as mock_fetch_price, patch(
            "sqlalchemy.dialects.postgresql.insert", side_effect=fake_pg_insert
        ):
            configure(mock_date_cls)
            r = await run_catch_up_snapshot(db, USER_ID, PORTFOLIO_ID)

        # ── The live-price path must never be touched by catch-up ───────────
        mock_fetch_price.assert_not_called()

        # ── The historical fetch must be scoped to the gap window only,
        #    not the portfolio's full history (which starts 2024-05-01) ──────
        assert fake_fetch_price_history.calls == [("PTT", tuesday, wednesday)]

        # ── Two rows written, one per missing date, each carrying THAT
        #    date's historical price — never the live sentinel ────────────────
        assert r["status"] == "completed"
        assert r["processed"] == 2
        assert len(captured) == 2

        day1, day2 = captured[0], captured[1]
        assert day1["date"] == tuesday
        assert day2["date"] == wednesday

        day1_open = day1["open_positions"][0]
        day2_open = day2["open_positions"][0]
        assert day1_open["close_price"] == pytest.approx(111.0)
        assert day2_open["close_price"] == pytest.approx(222.0)
        assert day1_open["close_price"] != pytest.approx(LIVE_SENTINEL)
        assert day2_open["close_price"] != pytest.approx(LIVE_SENTINEL)

        # open_pnl = (close - entry) * size, using the historical close only
        assert day1["open_pnl"] == pytest.approx((111.0 - 100.0) * 10)
        assert day2["open_pnl"] == pytest.approx((222.0 - 100.0) * 10)


# ── 3. Existing rows are never touched ─────────────────────────────────────────

class TestExistingRowsUntouched:
    """Structural proof that a catch-up run cannot mutate any pre-existing
    daily_performance row:
      (a) no DELETE statement is ever issued (sa_delete never invoked), and
      (b) every upsert this run performs targets a date strictly AFTER
          latest_existing_date — the pre-existing row's own date is only ever
          read (its acc_pnl column), never written.
    """

    @pytest.mark.asyncio
    async def test_no_delete_and_upserts_never_target_pre_existing_dates(self):
        latest = date(2024, 6, 3)  # the "pre-existing" row's date
        today = date(2024, 6, 4)   # exactly one new day beyond it

        pos = _pos(
            symbol="PTT", status="active",
            entry_date=date(2024, 5, 1), entry_price=100.0, size=10,
        )
        captured, fake_pg_insert = _make_capturing_insert()
        db = _make_db(
            latest_max_date=latest,
            positions=[pos],
            cash_txns=[],
            prior_acc_pnl=Decimal("500.00"),
        )

        p, configure = _patch_today(today)
        with p as mock_date_cls, patch(
            "app.services.daily_performance_service._fetch_price_history",
            return_value={},
        ), patch(
            "app.services.daily_performance_service.sa_delete"
        ) as mock_sa_delete, patch(
            "sqlalchemy.dialects.postgresql.insert", side_effect=fake_pg_insert
        ):
            configure(mock_date_cls)
            r = await run_catch_up_snapshot(db, USER_ID, PORTFOLIO_ID)

        # No DELETE of any kind was ever constructed.
        mock_sa_delete.assert_not_called()

        # Exactly one row written — the new day — and its date is strictly
        # after the pre-existing row's date, never equal to or before it.
        assert r["processed"] == 1
        assert len(captured) == 1
        assert captured[0]["date"] == today
        assert captured[0]["date"] > latest

        # Total DB interactions == the 4 read-only metadata queries + the
        # single new-day upsert. No extra read/write touched the old date.
        assert db.execute.call_count == 5


# ── 4. Concurrency guard (both directions, shared lock) ────────────────────────

class TestConcurrencyGuard:
    @pytest.mark.asyncio
    async def test_catch_up_rejected_while_backfill_in_progress(self):
        svc._active_backfills.add(PORTFOLIO_ID)
        with pytest.raises(RuntimeError, match="already in progress"):
            await run_catch_up_snapshot(_make_db(latest_max_date=None), USER_ID, PORTFOLIO_ID)

    @pytest.mark.asyncio
    async def test_backfill_rejected_while_catch_up_in_progress(self):
        # Simulate a catch-up holding the shared lock (same set/mechanism
        # run_historical_backfill itself uses) and confirm backfill is
        # rejected too — proving the guard is genuinely shared, not a
        # parallel/duplicate set.
        svc._active_backfills.add(PORTFOLIO_ID)
        with pytest.raises(RuntimeError, match="already in progress"):
            await run_historical_backfill(_make_db(latest_max_date=None), USER_ID, PORTFOLIO_ID)

    @pytest.mark.asyncio
    async def test_lock_released_after_catch_up_completes(self):
        db = _make_db(latest_max_date=date(2024, 6, 5))
        p, configure = _patch_today(date(2024, 6, 5))
        with p as mock_date_cls:
            configure(mock_date_cls)
            await run_catch_up_snapshot(db, USER_ID, PORTFOLIO_ID)
        assert PORTFOLIO_ID not in svc._active_backfills

    @pytest.mark.asyncio
    async def test_lock_released_even_when_no_history(self):
        db = _make_db(latest_max_date=None)
        await run_catch_up_snapshot(db, USER_ID, PORTFOLIO_ID)
        assert PORTFOLIO_ID not in svc._active_backfills


# ── 5. acc_pnl chaining across 2+ new consecutive days ──────────────────────────

class TestAccPnlChaining:
    @pytest.mark.asyncio
    async def test_day_two_acc_pnl_equals_day_one_plus_day_two_realized(self):
        latest = date(2024, 6, 3)   # Monday, prior acc_pnl = 500.0
        tuesday = date(2024, 6, 4)
        wednesday = date(2024, 6, 5)

        # Sold on Tuesday: (100-80)*10 = +200 realized
        pos_a = _pos(
            symbol="AAA", status="closed",
            entry_date=date(2024, 5, 1), exit_date=tuesday,
            entry_price=80.0, exit_price=100.0, size=10,
        )
        # Sold on Wednesday: (100-85)*10 = +150 realized
        pos_b = _pos(
            symbol="BBB", status="closed",
            entry_date=date(2024, 5, 2), exit_date=wednesday,
            entry_price=85.0, exit_price=100.0, size=10,
        )

        captured, fake_pg_insert = _make_capturing_insert()
        db = _make_db(
            latest_max_date=latest,
            positions=[pos_a, pos_b],
            cash_txns=[],
            prior_acc_pnl=Decimal("500.00"),
        )

        p, configure = _patch_today(wednesday)
        with p as mock_date_cls, patch(
            "app.services.daily_performance_service._fetch_price_history",
            return_value={},
        ), patch(
            "sqlalchemy.dialects.postgresql.insert", side_effect=fake_pg_insert
        ):
            configure(mock_date_cls)
            r = await run_catch_up_snapshot(db, USER_ID, PORTFOLIO_ID)

        assert r["processed"] == 2
        assert len(captured) == 2
        # Day 1 (Tuesday): 500 (prior) + 200 (realized) = 700 — never reset.
        assert captured[0]["date"] == tuesday
        assert captured[0]["acc_pnl"] == pytest.approx(700.0)
        # Day 2 (Wednesday): 700 (running) + 150 (realized) = 850 —
        # chained forward, not duplicated and not reset to just 150.
        assert captured[1]["date"] == wednesday
        assert captured[1]["acc_pnl"] == pytest.approx(850.0)

    @pytest.mark.asyncio
    async def test_null_prior_acc_pnl_seeds_from_zero_with_warning(self):
        """Legacy row predating the acc_pnl column: NULL -> seed from 0.0,
        not a crash, and a warning is logged."""
        latest = date(2024, 6, 3)
        tuesday = date(2024, 6, 4)
        pos = _pos(
            symbol="AAA", status="closed",
            entry_date=date(2024, 5, 1), exit_date=tuesday,
            entry_price=80.0, exit_price=100.0, size=10,
        )
        captured, fake_pg_insert = _make_capturing_insert()
        db = _make_db(
            latest_max_date=latest,
            positions=[pos],
            cash_txns=[],
            prior_acc_pnl=None,  # legacy NULL row
        )
        p, configure = _patch_today(tuesday)
        with p as mock_date_cls, patch(
            "app.services.daily_performance_service._fetch_price_history",
            return_value={},
        ), patch(
            "sqlalchemy.dialects.postgresql.insert", side_effect=fake_pg_insert
        ):
            configure(mock_date_cls)
            r = await run_catch_up_snapshot(db, USER_ID, PORTFOLIO_ID)

        assert r["processed"] == 1
        # 0.0 (seeded) + 200 (realized) = 200.0
        assert captured[0]["acc_pnl"] == pytest.approx(200.0)


# ── 6. Partial failure + idempotent retry ───────────────────────────────────────

class TestPartialFailureAndRetry:
    @pytest.mark.asyncio
    async def test_one_bad_date_does_not_abort_the_whole_run(self):
        latest = date(2024, 6, 3)   # Monday
        today = date(2024, 6, 6)    # Thursday -> Tue/Wed/Thu missing
        tuesday = date(2024, 6, 4)
        wednesday = date(2024, 6, 5)
        thursday = today

        pos = _pos(
            symbol="PTT", status="active",
            entry_date=date(2024, 5, 1), entry_price=100.0, size=10,
        )

        real_compute = svc._compute_snapshot_values

        def flaky_compute(positions, snapshot_date, price_lookup, cash_investment=0.0):
            if snapshot_date == wednesday:
                raise RuntimeError("simulated price-service outage")
            return real_compute(positions, snapshot_date, price_lookup, cash_investment)

        captured, fake_pg_insert = _make_capturing_insert()
        db = _make_db(
            latest_max_date=latest,
            positions=[pos],
            cash_txns=[],
            prior_acc_pnl=Decimal("0.00"),
        )

        p, configure = _patch_today(today)
        with p as mock_date_cls, patch(
            "app.services.daily_performance_service._fetch_price_history",
            return_value={},
        ), patch(
            "app.services.daily_performance_service._compute_snapshot_values",
            side_effect=flaky_compute,
        ), patch(
            "sqlalchemy.dialects.postgresql.insert", side_effect=fake_pg_insert
        ):
            configure(mock_date_cls)
            r = await run_catch_up_snapshot(db, USER_ID, PORTFOLIO_ID)

        assert r["missing_dates_found"] == 3
        assert r["processed"] == 2
        assert r["errors"] == 1
        assert r["skipped"] == 0

        written_dates = [c["date"] for c in captured]
        assert written_dates == [tuesday, thursday]  # Wednesday skipped, run continued

        assert db.rollback.await_count == 1
        assert db.commit.await_count == 2

    @pytest.mark.asyncio
    async def test_QA_middle_date_failure_leaves_permanent_gap_not_healed_by_retry(self):
        """QA-added coverage gap closer (not part of the original delivery).

        Reproduces the exact scenario of test_one_bad_date_does_not_abort_the_whole_run
        (Tue succeeds, Wed fails, Thu succeeds) and then simulates the retry the
        endpoint docstring / UI banner explicitly advertise as safe ("Caught up
        N day(s) with M error(s). Safe to retry").

        The service's missing-day algorithm is a pure forward scan from
        MAX(date): ``cursor = latest_existing_date + 1`` through today. Because
        Thursday committed successfully, MAX(date) advances to Thursday even
        though Wednesday was never written. A subsequent catch-up call
        therefore starts scanning from Friday and can never re-discover the
        Wednesday hole.

        This test documents that behaviour precisely: after the partial
        failure, calling run_catch_up_snapshot again (no new calendar day
        elapsed) reports "up_to_date" / zero missing dates, proving the
        Wednesday gap is silently permanent rather than closed by the
        advertised retry. This does not corrupt or duplicate any data (AC6
        still holds), but it means AC5's "safe to retry" guarantee is not
        actually true for a failure on a date strictly before the last
        successfully-processed date in the same run — only Backfill History
        (full delete+recompute) currently heals such a hole.
        """
        latest = date(2024, 6, 3)   # Monday
        today = date(2024, 6, 6)    # Thursday -> Tue/Wed/Thu missing
        tuesday = date(2024, 6, 4)
        wednesday = date(2024, 6, 5)
        thursday = today

        pos = _pos(
            symbol="PTT", status="active",
            entry_date=date(2024, 5, 1), entry_price=100.0, size=10,
        )

        real_compute = svc._compute_snapshot_values

        def flaky_compute(positions, snapshot_date, price_lookup, cash_investment=0.0):
            if snapshot_date == wednesday:
                raise RuntimeError("simulated price-service outage")
            return real_compute(positions, snapshot_date, price_lookup, cash_investment)

        captured1, fake_pg_insert1 = _make_capturing_insert()
        db1 = _make_db(
            latest_max_date=latest,
            positions=[pos],
            cash_txns=[],
            prior_acc_pnl=Decimal("0.00"),
        )

        p, configure = _patch_today(today)
        with p as mock_date_cls, patch(
            "app.services.daily_performance_service._fetch_price_history",
            return_value={},
        ), patch(
            "app.services.daily_performance_service._compute_snapshot_values",
            side_effect=flaky_compute,
        ), patch(
            "sqlalchemy.dialects.postgresql.insert", side_effect=fake_pg_insert1
        ):
            configure(mock_date_cls)
            r1 = await run_catch_up_snapshot(db1, USER_ID, PORTFOLIO_ID)

        assert r1["processed"] == 2
        assert r1["errors"] == 1
        assert [c["date"] for c in captured1] == [tuesday, thursday]

        # Simulate the real world: Thursday's commit really did advance
        # MAX(date) in the DB, even though Wednesday was never inserted.
        db2 = _make_db(latest_max_date=thursday)
        with p as mock_date_cls:
            configure(mock_date_cls)
            r2 = await run_catch_up_snapshot(db2, USER_ID, PORTFOLIO_ID)

        # The advertised retry does NOT rediscover or refill Wednesday: the
        # forward-only MAX(date) scan reports the portfolio as fully
        # up-to-date, with zero missing dates and zero DB work beyond the
        # MAX(date) read itself.
        assert r2["status"] == "up_to_date"
        assert r2["missing_dates_found"] == 0
        assert r2["processed"] == 0
        assert db2.execute.call_count == 1

    @pytest.mark.asyncio
    async def test_partial_failure_note_present_only_when_errors_occurred(self):
        """DEF-001 fix: the response must not overpromise what retry does.

        When errors > 0, a `partial_failure_note` field explains the actual
        retry semantics (forward-only from the new MAX(date), does not heal
        an orphaned earlier gap). When errors == 0, the field must be absent
        or None — no unnecessary noise on the common, fully-successful path.
        """
        latest = date(2024, 6, 3)   # Monday
        today = date(2024, 6, 6)    # Thursday -> Tue/Wed/Thu missing
        wednesday = date(2024, 6, 5)

        pos = _pos(
            symbol="PTT", status="active",
            entry_date=date(2024, 5, 1), entry_price=100.0, size=10,
        )

        real_compute = svc._compute_snapshot_values

        def flaky_compute(positions, snapshot_date, price_lookup, cash_investment=0.0):
            if snapshot_date == wednesday:
                raise RuntimeError("simulated price-service outage")
            return real_compute(positions, snapshot_date, price_lookup, cash_investment)

        captured, fake_pg_insert = _make_capturing_insert()
        db = _make_db(
            latest_max_date=latest,
            positions=[pos],
            cash_txns=[],
            prior_acc_pnl=Decimal("0.00"),
        )

        p, configure = _patch_today(today)
        with p as mock_date_cls, patch(
            "app.services.daily_performance_service._fetch_price_history",
            return_value={},
        ), patch(
            "app.services.daily_performance_service._compute_snapshot_values",
            side_effect=flaky_compute,
        ), patch(
            "sqlalchemy.dialects.postgresql.insert", side_effect=fake_pg_insert
        ):
            configure(mock_date_cls)
            r_with_errors = await run_catch_up_snapshot(db, USER_ID, PORTFOLIO_ID)

        assert r_with_errors["errors"] == 1
        assert r_with_errors["partial_failure_note"]
        assert "Refresh" in r_with_errors["partial_failure_note"]
        assert "Backfill" in r_with_errors["partial_failure_note"]

        # Fully successful run (no errors) -> field must be absent/None.
        latest2 = date(2024, 6, 3)
        today2 = date(2024, 6, 4)
        captured2, fake_pg_insert2 = _make_capturing_insert()
        db2 = _make_db(
            latest_max_date=latest2,
            positions=[pos],
            cash_txns=[],
            prior_acc_pnl=Decimal("0.00"),
        )
        p2, configure2 = _patch_today(today2)
        with p2 as mock_date_cls2, patch(
            "app.services.daily_performance_service._fetch_price_history",
            return_value={},
        ), patch(
            "sqlalchemy.dialects.postgresql.insert", side_effect=fake_pg_insert2
        ):
            configure2(mock_date_cls2)
            r_no_errors = await run_catch_up_snapshot(db2, USER_ID, PORTFOLIO_ID)

        assert r_no_errors["errors"] == 0
        assert r_no_errors.get("partial_failure_note") is None

    @pytest.mark.asyncio
    async def test_rerun_after_success_does_not_duplicate_already_processed_days(self):
        """After a fully successful catch-up run, latest_existing_date has
        advanced to the last processed day. Re-running immediately (no new
        calendar days elapsed) must find nothing missing and write nothing —
        proving idempotent retry semantics: already-succeeded days are never
        reprocessed or duplicated."""
        latest = date(2024, 6, 3)
        today = date(2024, 6, 4)

        pos = _pos(
            symbol="PTT", status="active",
            entry_date=date(2024, 5, 1), entry_price=100.0, size=10,
        )
        captured1, fake_pg_insert1 = _make_capturing_insert()
        db1 = _make_db(
            latest_max_date=latest,
            positions=[pos],
            cash_txns=[],
            prior_acc_pnl=Decimal("0.00"),
        )
        p1, configure1 = _patch_today(today)
        with p1 as mock_date_cls, patch(
            "app.services.daily_performance_service._fetch_price_history",
            return_value={},
        ), patch(
            "sqlalchemy.dialects.postgresql.insert", side_effect=fake_pg_insert1
        ):
            configure1(mock_date_cls)
            r1 = await run_catch_up_snapshot(db1, USER_ID, PORTFOLIO_ID)

        assert r1["status"] == "completed"
        assert r1["processed"] == 1
        assert captured1[0]["date"] == today

        # Second run: MAX(date) in the (simulated) DB has now advanced to
        # `today` because the first run's upsert succeeded — no calendar
        # time has passed, so nothing should be missing.
        db2 = _make_db(latest_max_date=today)  # advanced past the new row
        with p1 as mock_date_cls:
            configure1(mock_date_cls)
            r2 = await run_catch_up_snapshot(db2, USER_ID, PORTFOLIO_ID)

        assert r2["status"] == "up_to_date"
        assert r2["processed"] == 0
        assert r2["missing_dates_found"] == 0
        # Only the MAX(date) read happened — no upsert, no duplicate write.
        assert db2.execute.call_count == 1


# ── Endpoint wiring: status mapping + no envelope wrapping ─────────────────────

class TestCatchUpEndpoint:
    """Exercises app.api.v1.endpoints.daily_performance.trigger_catch_up_snapshot
    directly as a plain coroutine (no HTTP layer / real DB needed) to verify:
      - RuntimeError from the service maps to HTTP 409.
      - The service's summary dict is returned AS-IS (unlike /backfill and
        /run, catch-up must NOT be wrapped in {"status": "ok", **summary}
        since its own `status` field already carries the three-way outcome).
    """

    @pytest.mark.asyncio
    async def test_runtime_error_maps_to_409(self):
        from app.api.v1.endpoints import daily_performance as dp_endpoint

        fake_uuid = MagicMock()
        with patch.object(
            dp_endpoint, "_resolve_portfolio_id", new=AsyncMock(return_value=fake_uuid)
        ), patch.object(
            dp_endpoint,
            "run_catch_up_snapshot",
            new=AsyncMock(side_effect=RuntimeError("already in progress")),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await dp_endpoint.trigger_catch_up_snapshot(
                    user_id=USER_ID, db=AsyncMock(), portfolio_id=None
                )
        assert exc_info.value.status_code == 409

    @pytest.mark.asyncio
    async def test_summary_dict_returned_without_ok_envelope(self):
        from app.api.v1.endpoints import daily_performance as dp_endpoint

        fake_uuid = MagicMock()
        summary = {
            "status": "up_to_date",
            "message": None,
            "latest_existing_date": "2024-06-05",
            "missing_dates_found": 0,
            "processed": 0,
            "skipped": 0,
            "errors": 0,
            "start_date": None,
            "end_date": None,
        }
        with patch.object(
            dp_endpoint, "_resolve_portfolio_id", new=AsyncMock(return_value=fake_uuid)
        ), patch.object(
            dp_endpoint, "run_catch_up_snapshot", new=AsyncMock(return_value=summary)
        ):
            result = await dp_endpoint.trigger_catch_up_snapshot(
                user_id=USER_ID, db=AsyncMock(), portfolio_id=None
            )

        # Returned exactly as the service produced it — no "status": "ok"
        # envelope merged on top (that would clobber the real status value).
        assert result == summary
        assert result is summary or result == summary
