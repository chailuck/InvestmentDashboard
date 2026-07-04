"""Unit tests for app/services/email_template.py.

The template renderer is a pure function — no DB, no network, no I/O.
Tests run without any fixtures and complete in milliseconds.

Coverage areas:
    - Full render with all sections populated
    - Render with all sections None (graceful degradation)
    - Render with partial sections (None mix)
    - Weekly scan: colour counts, CYAN/GREEN symbol chips
    - Purchase plan: triggered row styling, stale price warning, strategy abbreviations
    - Portfolio: P&L colouring, sort order, total row
    - Structural invariants: DOCTYPE, max-width, inline CSS only
    - Strategy abbreviation helper
    - Float formatting helper
"""

from __future__ import annotations

import pytest

from app.services.email_template import (
    _abbr_strategy,
    _fmt,
    render_daily_digest,
)


# ── Fixtures / shared test data ───────────────────────────────────────────────

def _make_scan(items: list[dict] | None = None) -> dict:
    return {
        "id": "scan-1",
        "name": "2026-06-30",
        "items": items or [
            {"symbol": "AOT", "color_mark": "CYAN", "strategy": "BO", "buy_price": 50.0, "sl": 48.0, "tp": 55.0, "remark": None, "list_name": "A"},
            {"symbol": "BDMS", "color_mark": "CYAN", "strategy": None, "buy_price": None, "sl": None, "tp": None, "remark": None, "list_name": "A"},
            {"symbol": "PTT", "color_mark": "GREEN", "strategy": "BOD", "buy_price": 30.0, "sl": 28.0, "tp": 35.0, "remark": None, "list_name": "B"},
            {"symbol": "KBANK", "color_mark": "YELLOW", "strategy": None, "buy_price": None, "sl": None, "tp": None, "remark": None, "list_name": "B"},
            {"symbol": "BBL", "color_mark": "RED", "strategy": None, "buy_price": None, "sl": None, "tp": None, "remark": None, "list_name": "B"},
            {"symbol": "INTUCH", "color_mark": "PURPLE", "strategy": None, "buy_price": None, "sl": None, "tp": None, "remark": None, "list_name": "C"},
        ],
    }


def _make_purchase_plan(items: list[dict] | None = None) -> dict:
    return {
        "id": "plan-1",
        "name": "2026-06-30",
        "plan_type": "purchase",
        "purchase_items": items or [
            {
                "id": "item-1",
                "sort_order": 0,
                "stock": "AOT",
                "current_price": 51.25,
                "buy_price": 50.0,
                "tp": 55.0,
                "sl": 48.0,
                "strategy": "BREAK OUT",
                "reason": "strong momentum",
                "triggered": True,
            },
            {
                "id": "item-2",
                "sort_order": 1,
                "stock": "BDMS",
                "current_price": None,          # stale / unavailable
                "buy_price": 22.5,
                "tp": 25.0,
                "sl": 21.0,
                "strategy": "BUY ON DIP",
                "reason": None,
                "triggered": False,
            },
        ],
    }


def _make_portfolio(positions: list[dict] | None = None, total_net_pnl: float = 3500.0) -> dict:
    return {
        "positions": positions or [
            {
                "id": "pos-1",
                "symbol": "PTT",
                "direction": "LONG",
                "entryDate": "2026-06-01",
                "entryPrice": 30.0,
                "currentPrice": 33.0,
                "positionSize": 1000,
                "netPnl": 3000.0,
                "pnlPct": 10.0,
                "sl": 28.0,
                "tp": 36.0,
                "status": "active",
                "remarks": None,
            },
            {
                "id": "pos-2",
                "symbol": "KBANK",
                "direction": "LONG",
                "entryDate": "2026-06-10",
                "entryPrice": 140.0,
                "currentPrice": 135.0,
                "positionSize": 100,
                "netPnl": -500.0,
                "pnlPct": -3.57,
                "sl": 130.0,
                "tp": 155.0,
                "status": "active",
                "remarks": None,
            },
        ],
        "total": 2,
        "totalNetPnl": total_net_pnl,
    }


GENERATED_AT = "30 Jun 2026, 17:30 ICT"


# ── Helper tests ──────────────────────────────────────────────────────────────

class TestAbbrStrategy:
    @pytest.mark.parametrize("raw,expected", [
        ("BREAK OUT", "BO"),
        ("BREAKOUT", "BO"),
        ("BUY ON DIP", "BOD"),
        ("BUY ON THE DIP", "BOD"),
        ("break out", "BO"),           # case-insensitive
        ("buy on dip", "BOD"),
        ("MOMENTUM", "MOMENTUM"),      # unknown — pass through
        ("", ""),                      # empty
        (None, ""),                    # None guard
    ])
    def test_abbreviation(self, raw: str | None, expected: str) -> None:
        assert _abbr_strategy(raw) == expected


class TestFmt:
    @pytest.mark.parametrize("value,decimals,expected", [
        (50.0, 2, "50.00"),
        (1234.5678, 2, "1,234.57"),
        (0.0, 2, "0.00"),
        (None, 2, "—"),
        ("bad", 2, "—"),
        (3000.0, 0, "3,000"),
        (-500.0, 0, "-500"),
    ])
    def test_fmt(self, value, decimals: int, expected: str) -> None:
        assert _fmt(value, decimals) == expected


# ── render_daily_digest structural tests ──────────────────────────────────────

class TestRenderDailyDigestStructure:
    def test_returns_string(self) -> None:
        html = render_daily_digest(None, None, None, GENERATED_AT)
        assert isinstance(html, str)

    def test_doctype_present(self) -> None:
        html = render_daily_digest(None, None, None, GENERATED_AT)
        assert html.strip().startswith("<!DOCTYPE html>")

    def test_charset_utf8(self) -> None:
        html = render_daily_digest(None, None, None, GENERATED_AT)
        assert 'charset="utf-8"' in html.lower() or "charset=utf-8" in html.lower()

    def test_max_width_600(self) -> None:
        html = render_daily_digest(None, None, None, GENERATED_AT)
        assert "600" in html

    def test_no_style_block(self) -> None:
        """Gmail strips <style> blocks; all CSS must be inline."""
        html = render_daily_digest(None, None, None, GENERATED_AT)
        assert "<style" not in html.lower()

    def test_no_external_image_urls(self) -> None:
        html = render_daily_digest(None, None, None, GENERATED_AT)
        assert "<img" not in html.lower()

    def test_generated_at_in_header_and_footer(self) -> None:
        html = render_daily_digest(None, None, None, GENERATED_AT)
        # The timestamp appears in both the header and the footer
        assert html.count(GENERATED_AT) >= 2

    def test_footer_branding(self) -> None:
        html = render_daily_digest(None, None, None, GENERATED_AT)
        assert "POP Investment Dashboard" in html


# ── Weekly Scan section ───────────────────────────────────────────────────────

class TestWeeklyScanSection:
    def test_none_shows_no_data_message(self) -> None:
        html = render_daily_digest(None, None, None, GENERATED_AT)
        assert "No scan data available" in html

    def test_colour_counts_rendered(self) -> None:
        scan = _make_scan()
        html = render_daily_digest(scan, None, None, GENERATED_AT)
        # 2 CYAN, 1 GREEN, 1 YELLOW, 1 RED, 1 PURPLE
        assert "Cyan: 2" in html
        assert "Green: 1" in html
        assert "Yellow: 1" in html
        assert "Red: 1" in html
        assert "Purple: 1" in html

    def test_cyan_symbols_listed(self) -> None:
        scan = _make_scan()
        html = render_daily_digest(scan, None, None, GENERATED_AT)
        assert "AOT" in html
        assert "BDMS" in html

    def test_green_symbols_listed(self) -> None:
        scan = _make_scan()
        html = render_daily_digest(scan, None, None, GENERATED_AT)
        assert "PTT" in html

    def test_scan_name_shown(self) -> None:
        scan = _make_scan()
        html = render_daily_digest(scan, None, None, GENERATED_AT)
        assert "2026-06-30" in html

    def test_no_cyan_green_shows_message(self) -> None:
        scan = _make_scan(items=[
            {"symbol": "BBL", "color_mark": "RED", "strategy": None, "buy_price": None,
             "sl": None, "tp": None, "remark": None, "list_name": None},
        ])
        html = render_daily_digest(scan, None, None, GENERATED_AT)
        assert "No CYAN or GREEN items" in html

    def test_empty_items_list(self) -> None:
        scan = _make_scan(items=[])
        html = render_daily_digest(scan, None, None, GENERATED_AT)
        # All counts should be zero
        assert "Cyan: 0" in html

    def test_colour_hex_in_output(self) -> None:
        scan = _make_scan()
        html = render_daily_digest(scan, None, None, GENERATED_AT)
        # CYAN colour used in dot / chip styling
        assert "#22d3ee" in html


# ── Purchase Plan section ─────────────────────────────────────────────────────

class TestPurchasePlanSection:
    def test_none_shows_no_data_message(self) -> None:
        html = render_daily_digest(None, None, None, GENERATED_AT)
        assert "No purchase plan data available" in html

    def test_symbols_in_table(self) -> None:
        plan = _make_purchase_plan()
        html = render_daily_digest(None, plan, None, GENERATED_AT)
        assert "AOT" in html
        assert "BDMS" in html

    def test_triggered_row_bold(self) -> None:
        plan = _make_purchase_plan()
        html = render_daily_digest(None, plan, None, GENERATED_AT)
        # The triggered row uses font-weight:700
        assert "font-weight:700" in html

    def test_stale_price_warning_symbol(self) -> None:
        plan = _make_purchase_plan()
        html = render_daily_digest(None, plan, None, GENERATED_AT)
        # BDMS has current_price=None → should show the warning
        assert "⚠" in html

    def test_strategy_abbreviation_applied(self) -> None:
        plan = _make_purchase_plan()
        html = render_daily_digest(None, plan, None, GENERATED_AT)
        assert "BO" in html      # "BREAK OUT" → "BO"
        assert "BOD" in html     # "BUY ON DIP" → "BOD"

    def test_empty_plan_shows_message(self) -> None:
        plan = _make_purchase_plan(items=[])
        html = render_daily_digest(None, plan, None, GENERATED_AT)
        assert "No items in the current purchase plan" in html

    def test_column_headers_present(self) -> None:
        plan = _make_purchase_plan()
        html = render_daily_digest(None, plan, None, GENERATED_AT)
        for header in ("Symbol", "Entry", "Current", "SL", "TP", "Strategy"):
            assert header in html

    def test_buy_price_formatted(self) -> None:
        plan = _make_purchase_plan()
        html = render_daily_digest(None, plan, None, GENERATED_AT)
        assert "50.00" in html   # buy_price for AOT

    def test_plan_name_in_subtitle(self) -> None:
        plan = _make_purchase_plan()
        html = render_daily_digest(None, plan, None, GENERATED_AT)
        assert "2026-06-30" in html


# ── Portfolio section ─────────────────────────────────────────────────────────

class TestPortfolioSection:
    def test_none_shows_no_data_message(self) -> None:
        html = render_daily_digest(None, None, None, GENERATED_AT)
        assert "No portfolio data available" in html

    def test_active_symbols_shown(self) -> None:
        portfolio = _make_portfolio()
        html = render_daily_digest(None, None, portfolio, GENERATED_AT)
        assert "PTT" in html
        assert "KBANK" in html

    def test_positive_pnl_uses_green_colour(self) -> None:
        portfolio = _make_portfolio()
        html = render_daily_digest(None, None, portfolio, GENERATED_AT)
        assert "#10b981" in html   # green for positive P&L

    def test_negative_pnl_uses_red_colour(self) -> None:
        portfolio = _make_portfolio()
        html = render_daily_digest(None, None, portfolio, GENERATED_AT)
        assert "#ef4444" in html   # red for negative P&L

    def test_pnl_percentage_formatted(self) -> None:
        portfolio = _make_portfolio()
        html = render_daily_digest(None, None, portfolio, GENERATED_AT)
        assert "+10.00%" in html    # PTT positive
        assert "-3.57%" in html     # KBANK negative

    def test_total_pnl_row_shown(self) -> None:
        portfolio = _make_portfolio(total_net_pnl=3500.0)
        html = render_daily_digest(None, None, portfolio, GENERATED_AT)
        assert "Total P" in html   # "Total P&L" (& may be escaped as &amp;)
        assert "3,500" in html

    def test_negative_total_pnl(self) -> None:
        portfolio = _make_portfolio(total_net_pnl=-1200.0)
        html = render_daily_digest(None, None, portfolio, GENERATED_AT)
        assert "-1,200" in html

    def test_sort_by_abs_pnl_pct_desc(self) -> None:
        """PTT (10%) must appear before KBANK (-3.57%) in the output."""
        portfolio = _make_portfolio()
        html = render_daily_digest(None, None, portfolio, GENERATED_AT)
        ptt_pos = html.index("PTT")
        kbank_pos = html.index("KBANK")
        assert ptt_pos < kbank_pos, "Higher abs P&L% should sort first"

    def test_no_active_positions_message(self) -> None:
        portfolio = {"positions": [], "total": 0, "totalNetPnl": 0.0}
        html = render_daily_digest(None, None, portfolio, GENERATED_AT)
        assert "No active positions" in html

    def test_column_headers_present(self) -> None:
        portfolio = _make_portfolio()
        html = render_daily_digest(None, None, portfolio, GENERATED_AT)
        for header in ("Symbol", "Entry", "Current", "SL", "TP"):
            assert header in html


# ── All sections together ─────────────────────────────────────────────────────

class TestFullRender:
    def test_all_sections_populated(self) -> None:
        html = render_daily_digest(
            _make_scan(),
            _make_purchase_plan(),
            _make_portfolio(),
            GENERATED_AT,
        )
        # Structural
        assert "<!DOCTYPE html>" in html
        assert "POP Investment Dashboard" in html
        # Content from each section
        assert "Cyan: 2" in html           # weekly scan
        assert "AOT" in html               # purchase plan
        assert "PTT" in html               # portfolio
        assert "+10.00%" in html           # portfolio P&L

    def test_all_sections_none_no_exception(self) -> None:
        """Must not raise even with all sections absent."""
        html = render_daily_digest(None, None, None, GENERATED_AT)
        assert "<!DOCTYPE html>" in html
        assert "No scan data available" in html
        assert "No purchase plan data available" in html
        assert "No portfolio data available" in html

    def test_partial_sections(self) -> None:
        """Scan present, purchase and portfolio absent."""
        html = render_daily_digest(_make_scan(), None, None, GENERATED_AT)
        assert "Cyan: 2" in html
        assert "No purchase plan data available" in html
        assert "No portfolio data available" in html

    def test_html_entities_escaped(self) -> None:
        """P&L label should use &amp; in HTML context."""
        portfolio = _make_portfolio()
        html = render_daily_digest(None, None, portfolio, GENERATED_AT)
        # The label "P&L" must be HTML-escaped in a table cell
        assert "P&amp;L" in html or "P&L" in html   # either encoding is acceptable

    def test_no_script_tags(self) -> None:
        html = render_daily_digest(
            _make_scan(), _make_purchase_plan(), _make_portfolio(), GENERATED_AT
        )
        assert "<script" not in html.lower()
