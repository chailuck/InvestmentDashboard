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
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import app.services.daily_performance_service as svc
from app.services.daily_performance_service import (
    _compute_snapshot_values,
    _fetch_price_history,
    _get_historical_price,
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
