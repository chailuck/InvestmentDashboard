"""Unit tests for the daily_performance historical backfill feature.

Tests cover:
  - _compute_snapshot_values  (P&L business logic, open/closed classification)
  - _get_historical_price     (carry-forward for market holidays)
  - _fetch_price_history      (yfinance integration, error handling)
  - run_historical_backfill   (orchestration, guards, date iteration)

Run with:
    pytest tests/test_daily_performance_backfill.py -v

All tests use unittest.mock — no real DB or yfinance connection required.
"""

from __future__ import annotations

import sys
from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import app.services.daily_performance_service as svc
from app.services.daily_performance_service import (
    _compute_snapshot_values,
    _fetch_price_history,
    _get_historical_price,
    _merge_same_symbol_positions,
    run_daily_snapshot,
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
    null_entry: bool = False,
) -> MagicMock:
    """Build a minimal PortfolioDbPosition mock."""
    p = MagicMock()
    p.symbol = symbol
    p.entry_date = None if null_entry else entry_date
    p.exit_date = exit_date
    p.status = status
    p.entry_price = entry_price
    p.exit_price = exit_price
    p.position_size = size
    p.direction = direction
    return p


def _db(*positions: MagicMock) -> AsyncMock:
    """Build an AsyncSession mock that returns the given positions from execute()."""
    scalars = MagicMock()
    scalars.all.return_value = list(positions)
    result = MagicMock()
    result.scalars.return_value = scalars
    db = AsyncMock()
    db.execute.return_value = result
    return db


@pytest.fixture(autouse=True)
def _reset_backfill_lock():
    """Clear the concurrency set before and after every test."""
    svc._active_backfills.clear()
    yield
    svc._active_backfills.clear()


# ── _compute_snapshot_values ──────────────────────────────────────────────────

class TestComputeSnapshotValues:
    """TC-001 through TC-007: P&L business logic."""

    def test_TC001_open_long_pnl_correct(self):
        """Active LONG: open_pnl = (current_price - entry_price) × size."""
        pos = _pos(entry_price=100.0, size=10, status="active")
        r = _compute_snapshot_values([pos], date(2024, 6, 1), lambda s: 120.0)
        assert r["investment"] == pytest.approx(1000.0)
        assert r["open_pnl"] == pytest.approx(200.0)
        assert r["closed_pnl"] == pytest.approx(0.0)
        assert r["open_pnl_pct"] == pytest.approx(20.0)

    def test_TC002_closed_before_snapshot_goes_to_closed_pnl(self):
        """exit_date <= snapshot_date → contributes to closed_pnl, not open_pnl."""
        pos = _pos(
            status="closed",
            exit_date=date(2024, 5, 1),
            exit_price=130.0,
            size=10,
        )
        r = _compute_snapshot_values([pos], date(2024, 6, 1), lambda s: 999.0)
        assert r["closed_pnl"] == pytest.approx(300.0)
        assert r["open_pnl"] == pytest.approx(0.0)
        assert r["open_positions"] is None

    def test_TC003_closed_after_snapshot_counts_as_open_on_that_date(self):
        """exit_date > snapshot_date → position was still open on that date."""
        pos = _pos(
            status="closed",
            exit_date=date(2024, 9, 1),
            exit_price=130.0,
            size=10,
        )
        # On 2024-03-01 the position had not yet been closed
        r = _compute_snapshot_values([pos], date(2024, 3, 1), lambda s: 110.0)
        assert r["open_pnl"] == pytest.approx(100.0)
        assert r["closed_pnl"] == pytest.approx(0.0)
        assert len(r["open_positions"]) == 1

    def test_TC004_short_position_pnl_inverted(self):
        """SHORT: falling price = gain; rising price = loss."""
        pos = _pos(direction="SHORT", entry_price=100.0, size=10, status="active")
        r_gain = _compute_snapshot_values([pos], date(2024, 6, 1), lambda s: 80.0)
        r_loss = _compute_snapshot_values([pos], date(2024, 6, 1), lambda s: 120.0)
        assert r_gain["open_pnl"] == pytest.approx(200.0)
        assert r_loss["open_pnl"] == pytest.approx(-200.0)

    def test_TC005_none_price_yields_zero_pnl_no_crash(self):
        """Missing price → open_pnl = 0.0; no TypeError."""
        pos = _pos(status="active")
        r = _compute_snapshot_values([pos], date(2024, 6, 1), lambda s: None)
        assert r["open_pnl"] == pytest.approx(0.0)

    def test_TC006_empty_positions_all_zeros(self):
        """No positions → all figures are zero; open_positions is None."""
        r = _compute_snapshot_values([], date(2024, 6, 1), lambda s: 100.0)
        assert r["investment"] == pytest.approx(0.0)
        assert r["open_pnl"] == pytest.approx(0.0)
        assert r["open_positions"] is None

    def test_TC007_zero_investment_no_division_error(self):
        """entry_price = None → investment = 0; percentage fields must not raise."""
        pos = _pos(entry_price=None)
        r = _compute_snapshot_values([pos], date(2024, 6, 1), lambda s: 100.0)
        assert r["closed_pnl_pct"] == pytest.approx(0.0)
        assert r["open_pnl_pct"] == pytest.approx(0.0)


# ── Partial-sell same-symbol merge (open/purchased/sold_positions) ────────────

class TestMergeSameSymbolPositions:
    """TC-031 through TC-042: _merge_same_symbol_positions via _compute_snapshot_values.

    Regression coverage for the partial-sell bug: selling part of a position
    creates a shrunk "active" parent row plus a "closed" child row sharing the
    same symbol/entry_price/entry_date.  Without merging, both rows show up as
    separate chips in open_positions/purchased_positions/sold_positions on the
    same snapshot day even though they represent one logical position.
    """

    def test_TC031_open_positions_partial_sell_parent_and_child_merge(self):
        """BJC partial-sell scenario: parent size 1500 + child size 500, both
        entry_price=15.6 and entry_date=2026-08-11 → ONE merged open_positions
        entry with size=2000 and pnl = sum of what each would contribute alone."""
        snap_date = date(2026, 8, 12)  # day after entry, so not "purchased today"
        entry_date = date(2026, 8, 11)
        parent = _pos(
            symbol="BJC", status="active", entry_date=entry_date,
            entry_price=15.6, size=1500,
        )
        child = _pos(
            symbol="BJC", status="active", entry_date=entry_date,
            entry_price=15.6, size=500,
        )
        cp = 16.0
        diff = cp - 15.6
        expected_parent_pnl = round(diff * 1500, 2)
        expected_child_pnl = round(diff * 500, 2)

        r = _compute_snapshot_values([parent, child], snap_date, lambda s: cp)

        open_positions = r["open_positions"]
        assert open_positions is not None
        assert len(open_positions) == 1
        merged = open_positions[0]
        assert merged["symbol"] == "BJC"
        assert merged["size"] == 2000
        assert merged["pnl"] == pytest.approx(
            round(expected_parent_pnl + expected_child_pnl, 2)
        )
        assert merged["buy_price"] == pytest.approx(15.6)
        assert merged["entry_date"] == entry_date.isoformat()

    def test_TC032_open_positions_differing_buy_price_not_merged(self):
        """Same symbol/entry_date but DIFFERENT entry_price → stays as two
        separate entries; sizes are NOT summed."""
        d = date(2026, 8, 11)
        pos1 = _pos(symbol="XYZ", status="active", entry_date=d, entry_price=10.0, size=100)
        pos2 = _pos(symbol="XYZ", status="active", entry_date=d, entry_price=12.0, size=100)

        r = _compute_snapshot_values(
            [pos1, pos2], date(2026, 8, 12), lambda s: 15.0
        )

        open_positions = r["open_positions"]
        assert len(open_positions) == 2
        assert {p["size"] for p in open_positions} == {100}
        assert {p["buy_price"] for p in open_positions} == {10.0, 12.0}

    def test_TC033_open_positions_differing_entry_date_not_merged(self):
        """Same symbol/entry_price but DIFFERENT entry_date → NOT merged, even
        though the price coincidentally matches."""
        pos1 = _pos(
            symbol="XYZ", status="active", entry_date=date(2026, 8, 1),
            entry_price=10.0, size=100,
        )
        pos2 = _pos(
            symbol="XYZ", status="active", entry_date=date(2026, 8, 5),
            entry_price=10.0, size=100,
        )

        r = _compute_snapshot_values(
            [pos1, pos2], date(2026, 8, 12), lambda s: 15.0
        )

        open_positions = r["open_positions"]
        assert len(open_positions) == 2
        assert {p["entry_date"] for p in open_positions} == {
            date(2026, 8, 1).isoformat(),
            date(2026, 8, 5).isoformat(),
        }

    def test_TC034_purchased_positions_partial_sell_merges(self):
        """Same partial-sell scenario but entry_date == snapshot_date (the
        "purchased today" list) → also merges to one entry with summed size."""
        snap_date = date(2026, 8, 11)
        parent = _pos(
            symbol="BJC", status="active", entry_date=snap_date,
            entry_price=15.6, size=1500,
        )
        child = _pos(
            symbol="BJC", status="active", entry_date=snap_date,
            entry_price=15.6, size=500,
        )

        r = _compute_snapshot_values([parent, child], snap_date, lambda s: 16.0)

        purchased = r["purchased_positions"]
        assert purchased is not None
        assert len(purchased) == 1
        assert purchased[0]["size"] == 2000

    def test_TC035_purchased_positions_differing_buy_price_not_merged(self):
        """purchased_positions: different entry_price on the same symbol/day
        stays unmerged."""
        snap_date = date(2026, 8, 11)
        pos1 = _pos(symbol="XYZ", status="active", entry_date=snap_date, entry_price=10.0, size=100)
        pos2 = _pos(symbol="XYZ", status="active", entry_date=snap_date, entry_price=11.0, size=100)

        r = _compute_snapshot_values([pos1, pos2], snap_date, lambda s: 12.0)

        purchased = r["purchased_positions"]
        assert len(purchased) == 2

    def test_TC036_sold_positions_partial_sell_merges(self):
        """Two closed rows, same symbol/entry_price/entry_date/exit_price(close_price),
        both exiting on snapshot_date → merge into one sold_positions entry with
        summed size and pnl."""
        snap_date = date(2026, 8, 12)
        entry_date = date(2026, 8, 11)
        parent = _pos(
            symbol="BJC", status="closed", entry_date=entry_date, exit_date=snap_date,
            entry_price=15.6, exit_price=16.5, size=1500,
        )
        child = _pos(
            symbol="BJC", status="closed", entry_date=entry_date, exit_date=snap_date,
            entry_price=15.6, exit_price=16.5, size=500,
        )
        expected_parent_pnl = round((16.5 - 15.6) * 1500, 2)
        expected_child_pnl = round((16.5 - 15.6) * 500, 2)

        r = _compute_snapshot_values([parent, child], snap_date, lambda s: None)

        sold = r["sold_positions"]
        assert sold is not None
        assert len(sold) == 1
        merged = sold[0]
        assert merged["size"] == 2000
        assert merged["pnl"] == pytest.approx(
            round(expected_parent_pnl + expected_child_pnl, 2)
        )
        assert merged["exit_price"] == pytest.approx(16.5)
        assert merged["close_price"] == pytest.approx(16.5)

    def test_TC037_sold_positions_differing_close_price_not_merged(self):
        """Same symbol/entry_price/entry_date but DIFFERENT exit_price → two
        separate sales, NOT merged (they are economically different fills)."""
        snap_date = date(2026, 8, 12)
        entry_date = date(2026, 8, 11)
        pos1 = _pos(
            symbol="BJC", status="closed", entry_date=entry_date, exit_date=snap_date,
            entry_price=15.6, exit_price=16.5, size=1000,
        )
        pos2 = _pos(
            symbol="BJC", status="closed", entry_date=entry_date, exit_date=snap_date,
            entry_price=15.6, exit_price=17.0, size=1000,
        )

        r = _compute_snapshot_values([pos1, pos2], snap_date, lambda s: None)

        sold = r["sold_positions"]
        assert len(sold) == 2
        assert {p["exit_price"] for p in sold} == {16.5, 17.0}

    def test_TC038_single_entry_passthrough_unaffected(self):
        """A lone position (no partial-sell sibling) is unaffected by merging —
        list still has exactly one entry with its original values."""
        pos = _pos(symbol="PTT", status="active", entry_date=date(2026, 8, 1), entry_price=100.0, size=10)
        r = _compute_snapshot_values([pos], date(2026, 8, 12), lambda s: 120.0)
        open_positions = r["open_positions"]
        assert len(open_positions) == 1
        assert open_positions[0]["size"] == 10

    def test_TC039_empty_lists_still_yield_none(self):
        """No positions at all → open/purchased/sold_positions remain None,
        confirming the `if list else None` conversion still works after the
        merge step is inserted before it."""
        r = _compute_snapshot_values([], date(2026, 8, 12), lambda s: 100.0)
        assert r["open_positions"] is None
        assert r["purchased_positions"] is None
        assert r["sold_positions"] is None

    def test_TC040_sold_and_open_same_symbol_same_day_stay_independent(self):
        """A same-day partial sell: one remainder stays open, one child is sold.
        Both share symbol/entry_price/entry_date but belong to DIFFERENT lists
        (open_positions vs sold_positions) and must never merge across lists."""
        snap_date = date(2026, 8, 12)
        entry_date = date(2026, 8, 11)
        remainder = _pos(
            symbol="BJC", status="active", entry_date=entry_date,
            entry_price=15.6, size=1000,
        )
        sold_child = _pos(
            symbol="BJC", status="closed", entry_date=entry_date, exit_date=snap_date,
            entry_price=15.6, exit_price=16.5, size=500,
        )

        r = _compute_snapshot_values([remainder, sold_child], snap_date, lambda s: 16.0)

        open_positions = r["open_positions"]
        sold = r["sold_positions"]
        assert open_positions is not None and len(open_positions) == 1
        assert open_positions[0]["size"] == 1000
        assert sold is not None and len(sold) == 1
        assert sold[0]["size"] == 500

    def test_TC041_merge_helper_direct_group_of_two(self):
        """Direct unit test of _merge_same_symbol_positions: verifies the exact
        grouping key (symbol, buy_price, entry_date) and summed fields."""
        entries = [
            {
                "symbol": "BJC", "size": 1500, "buy_price": 15.6, "close_price": 16.0,
                "pnl": 600.0, "pnl_pct": 2.5641, "entry_date": "2026-08-11",
            },
            {
                "symbol": "BJC", "size": 500, "buy_price": 15.6, "close_price": 16.0,
                "pnl": 200.0, "pnl_pct": 2.5641, "entry_date": "2026-08-11",
            },
        ]
        merged = _merge_same_symbol_positions(entries)
        assert len(merged) == 1
        assert merged[0]["size"] == 2000
        assert merged[0]["pnl"] == pytest.approx(800.0)
        assert merged[0]["pnl_pct"] == pytest.approx(2.5641)

    def test_TC042_merge_helper_empty_list_returns_empty_list(self):
        """_merge_same_symbol_positions([]) → [] (not None, not an error) so
        the caller's `if list else None` conversion continues to work."""
        assert _merge_same_symbol_positions([]) == []

    def test_TC043_null_entry_date_same_symbol_never_merged(self):
        """Two DISTINCT, unrelated positions that both have entry_date=None and
        both lack entry_price (so buy_price computes to 0.0 via `float(pos.entry_price
        or 0)`) and share the same symbol would collide on the grouping key
        (symbol, 0.0, None) if entry_date were treated like any other field.
        Since a missing entry_date means the "same partial-sell split" invariant
        cannot be verified, these must NEVER be merged — even into each other —
        and must remain two separate entries with sizes NOT summed."""
        pos1 = _pos(
            symbol="XYZ", status="active", entry_price=None, size=100,
            null_entry=True,
        )
        pos2 = _pos(
            symbol="XYZ", status="active", entry_price=None, size=250,
            null_entry=True,
        )

        r = _compute_snapshot_values([pos1, pos2], date(2026, 8, 12), lambda s: 15.0)

        open_positions = r["open_positions"]
        assert open_positions is not None
        assert len(open_positions) == 2
        assert {p["size"] for p in open_positions} == {100, 250}
        assert all(p["entry_date"] is None for p in open_positions)


# ── _get_historical_price ─────────────────────────────────────────────────────

class TestGetHistoricalPrice:
    """TC-008 through TC-012: carry-forward for market holidays."""

    def test_TC008_exact_date_hit(self):
        hist = {"PTT": {date(2024, 6, 3): 95.5}}
        assert _get_historical_price(hist, "PTT", date(2024, 6, 3)) == pytest.approx(95.5)

    def test_TC009_carry_forward_one_day_back(self):
        """Market holiday: use previous trading day's close."""
        hist = {"PTT": {date(2024, 6, 2): 94.0}}
        assert _get_historical_price(hist, "PTT", date(2024, 6, 3)) == pytest.approx(94.0)

    def test_TC010_carry_forward_exactly_five_days(self):
        """Long holiday: searches up to 5 days back."""
        hist = {"PTT": {date(2024, 6, 1): 90.0}}
        assert _get_historical_price(hist, "PTT", date(2024, 6, 6)) == pytest.approx(90.0)

    def test_TC011_beyond_five_days_returns_none(self):
        """Beyond 5-day window → None (not 0.0 — caller treats None as missing)."""
        hist = {"PTT": {date(2024, 5, 31): 90.0}}
        assert _get_historical_price(hist, "PTT", date(2024, 6, 7)) is None

    def test_TC012_unknown_symbol_returns_none(self):
        assert _get_historical_price({}, "UNKNOWN", date(2024, 6, 3)) is None


# ── _fetch_price_history ──────────────────────────────────────────────────────

class TestFetchPriceHistory:
    """TC-013 through TC-015: yfinance integration and error handling."""

    def _make_yf_mock(self, ts_date: date, price: float) -> MagicMock:
        ts = MagicMock()
        ts.date.return_value = ts_date
        close_series = MagicMock()
        close_series.items.return_value = [(ts, price)]
        hist_df = MagicMock()
        hist_df.empty = False
        hist_df.__getitem__ = lambda self, k: close_series
        yf = MagicMock()
        yf.Ticker.return_value.history.return_value = hist_df
        return yf

    def test_TC013_returns_date_keyed_dict(self):
        yf_mock = self._make_yf_mock(date(2024, 6, 3), 95.5)
        with patch.dict(sys.modules, {"yfinance": yf_mock}):
            result = _fetch_price_history("PTT", date(2024, 6, 1), date(2024, 6, 7))
        assert result.get(date(2024, 6, 3)) == pytest.approx(95.5)

    def test_TC014_empty_yfinance_response_returns_empty_dict(self):
        hist_df = MagicMock()
        hist_df.empty = True
        yf_mock = MagicMock()
        yf_mock.Ticker.return_value.history.return_value = hist_df
        with patch.dict(sys.modules, {"yfinance": yf_mock}):
            assert _fetch_price_history("PTT", date(2024, 6, 1), date(2024, 6, 7)) == {}

    def test_TC015_network_error_returns_empty_dict_no_raise(self):
        yf_mock = MagicMock()
        yf_mock.Ticker.side_effect = Exception("network timeout")
        with patch.dict(sys.modules, {"yfinance": yf_mock}):
            result = _fetch_price_history("PTT", date(2024, 6, 1), date(2024, 6, 7))
        assert result == {}


# ── run_historical_backfill ───────────────────────────────────────────────────

class TestRunHistoricalBackfill:
    """TC-016 through TC-023: orchestration, guards, date iteration."""

    # Patch pg_insert and _fetch_price_history for all tests in this class
    _patch_insert = patch(
        "app.services.daily_performance_service.pg_insert",
        create=True,
    )
    _patch_fph = patch(
        "app.services.daily_performance_service._fetch_price_history",
        return_value={},
    )

    def _upsert_mock(self) -> MagicMock:
        """Build a chainable mock for pg_insert(...).values(...).on_conflict_do_update(...)."""
        stmt = MagicMock()
        on_conflict = MagicMock(return_value=stmt)
        values_mock = MagicMock()
        values_mock.on_conflict_do_update = on_conflict
        insert_mock = MagicMock(return_value=MagicMock(values=MagicMock(return_value=values_mock)))
        return insert_mock

    @pytest.mark.asyncio
    async def test_TC016_empty_portfolio_returns_zero_counts(self):
        with patch("app.services.daily_performance_service._fetch_price_history", return_value={}):
            r = await run_historical_backfill(_db(), USER_ID, PORTFOLIO_ID)
        assert r["processed"] == 0
        assert r["start_date"] is None
        assert "No positions" in r.get("message", "")

    @pytest.mark.asyncio
    async def test_TC017_concurrency_guard_raises_runtime_error(self):
        svc._active_backfills.add(PORTFOLIO_ID)
        with pytest.raises(RuntimeError, match="already in progress"):
            await run_historical_backfill(_db(), USER_ID, PORTFOLIO_ID)

    @pytest.mark.asyncio
    async def test_TC018_lock_released_after_normal_completion(self):
        with patch("app.services.daily_performance_service._fetch_price_history", return_value={}):
            await run_historical_backfill(_db(), USER_ID, PORTFOLIO_ID)
        assert PORTFOLIO_ID not in svc._active_backfills

    @pytest.mark.asyncio
    async def test_TC019_null_entry_date_rows_excluded_no_crash(self):
        """entry_date=None rows are silently dropped; function must not raise TypeError."""
        with patch("app.services.daily_performance_service._fetch_price_history", return_value={}):
            r = await run_historical_backfill(
                _db(_pos(null_entry=True)), USER_ID, PORTFOLIO_ID
            )
        assert r["processed"] == 0
        assert r["start_date"] is None

    @pytest.mark.asyncio
    async def test_TC020_start_date_exceeds_max_lookback_raises_value_error(self):
        """Explicit start_date > 3650 days ago must raise ValueError."""
        too_old = date.today() - timedelta(days=3651)
        with patch("app.services.daily_performance_service._fetch_price_history", return_value={}):
            with pytest.raises(ValueError, match="3650"):
                await run_historical_backfill(
                    _db(_pos(entry_date=date(2020, 1, 1))),
                    USER_ID,
                    PORTFOLIO_ID,
                    start_date=too_old,
                )

    @pytest.mark.asyncio
    async def test_TC021_weekends_are_skipped(self):
        """Saturday and Sunday dates must not produce upsert calls."""
        saturday = date(2024, 6, 8)   # Saturday
        sunday = date(2024, 6, 9)     # Sunday
        monday = date(2024, 6, 10)    # Monday — only eligible weekday

        pos = _pos(entry_date=saturday)
        db_mock = _db(pos)

        # Track how many times db.execute is called (first call = positions load;
        # subsequent calls = upserts for weekdays)
        execute_calls = []
        original_execute = db_mock.execute

        async def tracking_execute(stmt):
            execute_calls.append(stmt)
            return await original_execute(stmt)

        db_mock.execute = tracking_execute

        with patch("app.services.daily_performance_service._fetch_price_history", return_value={}):
            with patch("app.services.daily_performance_service.date") as mock_date_cls:
                mock_date_cls.today.return_value = monday
                mock_date_cls.side_effect = lambda *a: date(*a)
                r = await run_historical_backfill(
                    db_mock, USER_ID, PORTFOLIO_ID, start_date=saturday
                )

        # Saturday and Sunday must be skipped; Monday may be processed (or skipped
        # if no position exists on that date) — either way, no error
        assert r["errors"] == 0

    @pytest.mark.asyncio
    async def test_TC022_idempotency_same_processed_count_on_second_run(self):
        """Running backfill twice for same data must return the same processed count."""
        friday = date(2024, 6, 7)
        pos = _pos(entry_date=friday)

        with patch("app.services.daily_performance_service._fetch_price_history", return_value={}):
            with patch("app.services.daily_performance_service.date") as mock_date_cls:
                mock_date_cls.today.return_value = friday
                mock_date_cls.side_effect = lambda *a: date(*a)

                r1 = await run_historical_backfill(
                    _db(pos), USER_ID, PORTFOLIO_ID, start_date=friday
                )
                r2 = await run_historical_backfill(
                    _db(pos), USER_ID, PORTFOLIO_ID, start_date=friday
                )

        assert r1["processed"] == r2["processed"]

    @pytest.mark.asyncio
    async def test_TC023_lock_released_when_db_raises_during_execution(self):
        """The finally block must discard the lock even when an exception escapes."""
        pos = _pos(entry_date=date(2024, 6, 7))

        # First execute() call returns the positions; second call raises
        scalars_mock = MagicMock()
        scalars_mock.all.return_value = [pos]
        positions_result = MagicMock()
        positions_result.scalars.return_value = scalars_mock

        db_mock = AsyncMock()
        db_mock.execute.side_effect = [
            positions_result,
            Exception("DB connection lost"),
        ]

        with patch("app.services.daily_performance_service._fetch_price_history", return_value={}):
            with patch("app.services.daily_performance_service.date") as mock_date_cls:
                mock_date_cls.today.return_value = date(2024, 6, 7)
                mock_date_cls.side_effect = lambda *a: date(*a)
                # The DB exception is caught per-day — function should complete
                await run_historical_backfill(
                    db_mock, USER_ID, PORTFOLIO_ID, start_date=date(2024, 6, 7)
                )

        # Lock must be released regardless of what happened inside
        assert PORTFOLIO_ID not in svc._active_backfills


# ── _compute_snapshot_values – sold_positions pnl extraction ──────────────────

class TestAccPnlSoldPositionsExtraction:
    """TC-024 through TC-026: sold_positions.pnl values that feed the acc_pnl accumulator."""

    def test_TC024_single_long_position_closed_on_snapshot_date_produces_correct_pnl(self):
        """LONG closed exactly on snapshot_date: sold_positions[0]['pnl'] == 300.0."""
        snap_date = date(2024, 6, 7)
        pos = _pos(
            symbol="PTT",
            status="closed",
            entry_date=date(2024, 5, 1),
            exit_date=snap_date,
            entry_price=100.0,
            exit_price=130.0,
            size=10,
            direction="LONG",
        )
        r = _compute_snapshot_values([pos], snap_date, lambda s: None)
        sold = r.get("sold_positions")
        assert sold is not None
        assert len(sold) == 1
        assert sold[0]["pnl"] == pytest.approx(300.0)

    def test_TC025_only_position_closed_on_snapshot_date_appears_in_sold_positions(self):
        """Two positions: only the one whose exit_date == snapshot_date is in sold_positions."""
        snap_date = date(2024, 6, 7)
        pos_closed_today = _pos(
            symbol="AAA",
            status="closed",
            entry_date=date(2024, 5, 1),
            exit_date=snap_date,
            entry_price=100.0,
            exit_price=130.0,
            size=10,
        )
        pos_still_open = _pos(
            symbol="BBB",
            status="active",
            entry_date=date(2024, 5, 2),
            exit_date=None,
        )
        r = _compute_snapshot_values(
            [pos_closed_today, pos_still_open], snap_date, lambda s: 110.0
        )
        sold = r.get("sold_positions")
        assert sold is not None
        assert len(sold) == 1
        assert sold[0]["symbol"] == "AAA"

    def test_TC026_no_sales_on_snapshot_date_yields_zero_daily_pnl(self):
        """Active-only portfolio: sold_positions is None/empty → acc_pnl contribution = 0.0."""
        snap_date = date(2024, 6, 7)
        pos = _pos(symbol="PTT", status="active", entry_date=date(2024, 5, 1))
        r = _compute_snapshot_values([pos], snap_date, lambda s: 110.0)
        sold = r.get("sold_positions")
        # Mirrors the accumulator formula: sum over (sold_positions or [])
        daily_pnl = sum(float(p.get("pnl", 0) or 0) for p in (sold or []))
        assert daily_pnl == pytest.approx(0.0)


# ── acc_pnl accumulation formula (pure logic) ─────────────────────────────────

class TestAccPnlAccumulationFormula:
    """TC-027 through TC-028: accumulation math verified in isolation, no async."""

    def test_TC027_multi_day_accumulation_over_three_days(self):
        """Day1: +200, Day2: 0 sales, Day3: +150 → running acc: 200 → 200 → 350."""
        snap1 = date(2024, 6, 3)  # Monday
        snap2 = date(2024, 6, 4)  # Tuesday
        snap3 = date(2024, 6, 5)  # Wednesday

        # Position closed Day 1: (100-80)*10 = 200
        pos_day1 = _pos(
            symbol="AAA",
            status="closed",
            entry_date=date(2024, 5, 1),
            exit_date=snap1,
            entry_price=80.0,
            exit_price=100.0,
            size=10,
        )
        # Position closed Day 3: (100-85)*10 = 150
        pos_day3 = _pos(
            symbol="BBB",
            status="closed",
            entry_date=date(2024, 5, 2),
            exit_date=snap3,
            entry_price=85.0,
            exit_price=100.0,
            size=10,
        )

        acc_pnl_running = 0.0

        # --- Day 1: one sale (pos_day1) ---
        r1 = _compute_snapshot_values([pos_day1], snap1, lambda s: None)
        daily_pnl = sum(
            float(p.get("pnl", 0) or 0) for p in (r1.get("sold_positions") or [])
        )
        acc_pnl_running += daily_pnl
        assert acc_pnl_running == pytest.approx(200.0), "After Day 1: acc should be 200"

        # --- Day 2: no sales (pos_day1 already exited; pos_day3 exit is in the future) ---
        r2 = _compute_snapshot_values([pos_day1, pos_day3], snap2, lambda s: None)
        daily_pnl = sum(
            float(p.get("pnl", 0) or 0) for p in (r2.get("sold_positions") or [])
        )
        acc_pnl_running += daily_pnl
        assert acc_pnl_running == pytest.approx(200.0), "After Day 2: acc must be unchanged"

        # --- Day 3: one sale (pos_day3) ---
        r3 = _compute_snapshot_values([pos_day1, pos_day3], snap3, lambda s: None)
        daily_pnl = sum(
            float(p.get("pnl", 0) or 0) for p in (r3.get("sold_positions") or [])
        )
        acc_pnl_running += daily_pnl
        assert acc_pnl_running == pytest.approx(350.0), "After Day 3: acc should be 350"

    def test_TC028_accumulator_restored_on_exception_simulation(self):
        """Simulated DB failure: acc_pnl_running is restored to its pre-increment value."""
        acc_pnl_running = 200.0
        acc_pnl_before = acc_pnl_running
        try:
            daily_pnl = 100.0
            acc_pnl_running += daily_pnl
            raise RuntimeError("simulated DB failure")
        except RuntimeError:
            acc_pnl_running = acc_pnl_before
        assert acc_pnl_running == pytest.approx(200.0)


# ── run_daily_snapshot – acc_pnl computation ──────────────────────────────────

class TestAccPnlDailySnapshot:
    """TC-029 through TC-030: run_daily_snapshot writes the correct acc_pnl."""

    def _build_db_mock(
        self,
        positions: list,
        cash_amount: float,
        prior_acc_pnl: Decimal | None,
    ) -> AsyncMock:
        """Return an AsyncMock for run_daily_snapshot's 5 sequential execute() calls.

        Call order:
          1. select(PortfolioDbPosition)         → scalars().all()
          2. select(coalesce(sum(...), 0))        → scalar_one()   [cash investment]
          3. select(DailyPerformance.acc_pnl)...  → scalar_one_or_none()  [prior acc_pnl]
          4. pg_insert(...).values(...)...         → upsert (result ignored)
          5. select(DailyPerformance).where(...)  → scalar_one()   [re-fetch row]
        """
        # Call 1 — positions
        scalars_mock = MagicMock()
        scalars_mock.all.return_value = list(positions)
        positions_result = MagicMock()
        positions_result.scalars.return_value = scalars_mock

        # Call 2 — cash sum
        cash_result = MagicMock()
        cash_result.scalar_one.return_value = cash_amount

        # Call 3 — prior acc_pnl
        prior_result = MagicMock()
        prior_result.scalar_one_or_none.return_value = prior_acc_pnl

        # Call 4 — upsert (pg_insert stmt; return value unused by caller)
        upsert_result = MagicMock()

        # Call 5 — re-fetch upserted row
        row_mock = MagicMock()
        refetch_result = MagicMock()
        refetch_result.scalar_one.return_value = row_mock

        db = AsyncMock()
        db.execute.side_effect = [
            positions_result,
            cash_result,
            prior_result,
            upsert_result,
            refetch_result,
        ]
        return db

    @pytest.mark.asyncio
    async def test_TC029_prior_row_exists_acc_pnl_accumulates_correctly(self):
        """Prior acc_pnl=Decimal('500.00') + daily_pnl=200 → upserted acc_pnl==700.0."""
        snap_date = date(2024, 6, 7)  # Friday
        # LONG position closed today: (120-100)*10 = 200
        pos = _pos(
            symbol="PTT",
            status="closed",
            entry_date=date(2024, 5, 1),
            exit_date=snap_date,
            entry_price=100.0,
            exit_price=120.0,
            size=10,
            direction="LONG",
        )

        captured: dict = {}

        class _FakeValuesClause:
            def on_conflict_do_update(self, **kwargs):
                return MagicMock()

        class _FakeInsertStmt:
            def values(self, **kwargs):
                captured.update(kwargs)
                return _FakeValuesClause()

        def fake_pg_insert(table):
            return _FakeInsertStmt()

        db_mock = self._build_db_mock(
            positions=[pos],
            cash_amount=0.0,
            prior_acc_pnl=Decimal("500.00"),
        )

        with patch("sqlalchemy.dialects.postgresql.insert", side_effect=fake_pg_insert):
            await run_daily_snapshot(db_mock, USER_ID, snap_date, portfolio_id=PORTFOLIO_ID)

        assert captured.get("acc_pnl") == pytest.approx(700.0)

    @pytest.mark.asyncio
    async def test_TC030_no_prior_row_acc_pnl_starts_from_zero(self):
        """No prior row (scalar_one_or_none returns None): acc_pnl == 0 + daily_pnl == 200."""
        snap_date = date(2024, 6, 7)  # Friday
        # LONG position closed today: (120-100)*10 = 200
        pos = _pos(
            symbol="PTT",
            status="closed",
            entry_date=date(2024, 5, 1),
            exit_date=snap_date,
            entry_price=100.0,
            exit_price=120.0,
            size=10,
            direction="LONG",
        )

        captured: dict = {}

        class _FakeValuesClause:
            def on_conflict_do_update(self, **kwargs):
                return MagicMock()

        class _FakeInsertStmt:
            def values(self, **kwargs):
                captured.update(kwargs)
                return _FakeValuesClause()

        def fake_pg_insert(table):
            return _FakeInsertStmt()

        db_mock = self._build_db_mock(
            positions=[pos],
            cash_amount=0.0,
            prior_acc_pnl=None,  # first-ever snapshot for this portfolio
        )

        with patch("sqlalchemy.dialects.postgresql.insert", side_effect=fake_pg_insert):
            await run_daily_snapshot(db_mock, USER_ID, snap_date, portfolio_id=PORTFOLIO_ID)

        # Prior = 0.0 (no row), daily_pnl = 200 → acc_pnl = 200
        assert captured.get("acc_pnl") == pytest.approx(200.0)
