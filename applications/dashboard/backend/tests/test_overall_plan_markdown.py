"""Unit tests for app.services.overall_plan_markdown.

These are pure-function tests — plain dicts in, markdown string out. No DB,
no event loop, no HTTP client. Expected strings for the populated cases are
transcribed from (and independently verified against) the real ground-truth
export at
D:\\Documents\\Pop\\Knowledge\\Vault-Investment\\Investment\\raw\\Weeklyplan\\
OVERALL PLAN 20260712.md, sections 1, 2, and 4.
"""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

from app.services.overall_plan_markdown import (
    build_overall_plan_markdown,
    _section_positions,
    _section_purchase_plan,
    _section_review,
    _section_weekly_scan,
    _dir_arrow,
    _fmt_generated_at,
    _fmt_pct,
    _fmt_pnl,
    _md_cell,
    _parse_date,
)

BANGKOK = ZoneInfo("Asia/Bangkok")


# ── Section 1: Purchase Action Plan ─────────────────────────────────────────

def test_purchase_plan_section_matches_ground_truth_exactly():
    """TC-MD-01: Populated purchase plan renders byte-for-byte like the
    ground-truth report's section 1 (name header, table, dashes for nulls,
    triggered=False → '—', empty reason cell)."""
    plan = {
        "name": "2026-07-11",
        "notes": None,
        "set_analysis": None,
        "ai_recommend": None,
        "items": [
            {"sort_order": 0, "stock": "OSP", "strategy": "BREAK OUT", "buy_price": 17.90,
             "tp": 20.00, "sl": 16.90, "size": 1200, "current_price": 17.40,
             "triggered": False, "reason": ""},
            {"sort_order": 1, "stock": "ADVANC", "strategy": "BUY ON DIP", "buy_price": 381.00,
             "tp": 454.00, "sl": 368.00, "size": 100, "current_price": 373.00,
             "triggered": False, "reason": ""},
            {"sort_order": 2, "stock": "TLI", "strategy": "BREAK OUT", "buy_price": 12.20,
             "tp": 14.40, "sl": 11.60, "size": 2000, "current_price": 11.90,
             "triggered": False, "reason": ""},
        ],
    }
    expected = (
        "## 1. Purchase Action Plan — 2026-07-11\n\n"
        "| # | Stock | Strategy | Buy | TP | SL | Size | Current | Triggered | Reason |\n"
        "|---|-------|----------|-----|----|----|----|---------|-----------|--------|\n"
        "| 0 | **OSP** | BREAK OUT | 17.90 | 20.00 | 16.90 | 1200 | 17.40 | — |  |\n"
        "| 1 | **ADVANC** | BUY ON DIP | 381.00 | 454.00 | 368.00 | 100 | 373.00 | — |  |\n"
        "| 2 | **TLI** | BREAK OUT | 12.20 | 14.40 | 11.60 | 2000 | 11.90 | — |  |\n"
        "\n"
    )
    assert _section_purchase_plan(plan) == expected


def test_purchase_plan_section_empty_items_list():
    """TC-MD-02: A plan with zero items renders the empty-state message but
    still shows the plan name in the header (matches frontend: header check
    and item-emptiness check are independent conditions)."""
    plan = {"name": "Empty Plan", "notes": None, "set_analysis": None, "ai_recommend": None, "items": []}
    assert _section_purchase_plan(plan) == (
        "## 1. Purchase Action Plan — Empty Plan\n\n_No purchase plan items._\n\n"
    )


def test_purchase_plan_section_none_plan():
    """TC-MD-03: plan=None omits the name suffix and shows the empty state."""
    assert _section_purchase_plan(None) == (
        "## 1. Purchase Action Plan\n\n_No purchase plan items._\n\n"
    )


def test_purchase_plan_section_includes_notes_analysis_and_ai_recommend():
    """TC-MD-04: notes / set_analysis / ai_recommend are rendered when present."""
    plan = {
        "name": "P1",
        "notes": "Watch for gap up",
        "set_analysis": "SET index bullish",
        "ai_recommend": "Consider trimming on strength",
        "items": [
            {"sort_order": 0, "stock": "PTT", "strategy": None, "buy_price": None,
             "tp": None, "sl": None, "size": None, "current_price": None,
             "triggered": True, "reason": "Solid setup"},
        ],
    }
    out = _section_purchase_plan(plan)
    assert "**Notes:** Watch for gap up  \n\n" in out
    assert "**Market Analysis:** SET index bullish  \n\n" in out
    assert "\n**AI Recommendation:** Consider trimming on strength\n" in out
    # triggered=True → checkmark; all-null numeric fields → dashes
    assert "| 0 | **PTT** | — | — | — | — | — | — | ✓ | Solid setup |\n" in out


# ── Section 2: Portfolio DB active positions ────────────────────────────────

def test_positions_section_matches_ground_truth_exactly():
    """TC-MD-05: 8 active positions render byte-for-byte like the ground
    truth (alpha-sorted by symbol, total P&L computed from netPnl sum,
    zero-P&L row still gets a '+' sign, negative P&L has no double sign)."""
    positions = [
        {"symbol": "TRUE", "direction": "LONG", "entryDate": "2026-07-10", "entryPrice": 13.60,
         "currentPrice": 13.60, "netPnl": 0, "pnlPct": 0.00, "tp": 14.80, "sl": 12.60, "remarks": ""},
        {"symbol": "AOT", "direction": "LONG", "entryDate": "2026-06-02", "entryPrice": 56.00,
         "currentPrice": 63.50, "netPnl": 1500, "pnlPct": 13.39, "tp": 66.00, "sl": 54.25, "remarks": ""},
        {"symbol": "TIDLOR", "direction": "LONG", "entryDate": "2026-07-06", "entryPrice": 19.60,
         "currentPrice": 19.20, "netPnl": -200, "pnlPct": -2.04, "tp": 22.40, "sl": 18.80, "remarks": ""},
        {"symbol": "BLA", "direction": "LONG", "entryDate": "2026-07-03", "entryPrice": 26.00,
         "currentPrice": 27.50, "netPnl": 1500, "pnlPct": 5.77, "tp": 29.25, "sl": 24.20, "remarks": ""},
        {"symbol": "BTG", "direction": "LONG", "entryDate": "2026-06-10", "entryPrice": 20.60,
         "currentPrice": 21.30, "netPnl": 700, "pnlPct": 3.40, "tp": 24.50, "sl": 19.40, "remarks": ""},
        {"symbol": "EGCO", "direction": "LONG", "entryDate": "2026-06-29", "entryPrice": 119.50,
         "currentPrice": 126.50, "netPnl": 1400, "pnlPct": 5.86, "tp": 128.00, "sl": 117.00, "remarks": ""},
        {"symbol": "PLANB", "direction": "LONG", "entryDate": "2026-07-09", "entryPrice": 5.05,
         "currentPrice": 5.40, "netPnl": 700, "pnlPct": 6.93, "tp": 6.55, "sl": 4.70, "remarks": ""},
        {"symbol": "PR9", "direction": "LONG", "entryDate": "2026-06-25", "entryPrice": 17.30,
         "currentPrice": 17.60, "netPnl": 300, "pnlPct": 1.73, "tp": 18.50, "sl": 17.10, "remarks": ""},
    ]
    expected = (
        "## 2. Portfolio DB (Active Positions)\n\n"
        "**8 active positions** | **Total P&L:** +5,900  \n\n"
        "| Symbol | Dir | Entry Date | Entry | Current | P&L | P&L% | TP | SL | Remarks |\n"
        "|--------|-----|------------|-------|---------|-----|------|----|----|--------|\n"
        "| **AOT** | ↑ L | 2 Jun 2026 | 56.00 | 63.50 | +1,500 | +13.39% | 66.00 | 54.25 |  |\n"
        "| **BLA** | ↑ L | 3 Jul 2026 | 26.00 | 27.50 | +1,500 | +5.77% | 29.25 | 24.20 |  |\n"
        "| **BTG** | ↑ L | 10 Jun 2026 | 20.60 | 21.30 | +700 | +3.40% | 24.50 | 19.40 |  |\n"
        "| **EGCO** | ↑ L | 29 Jun 2026 | 119.50 | 126.50 | +1,400 | +5.86% | 128.00 | 117.00 |  |\n"
        "| **PLANB** | ↑ L | 9 Jul 2026 | 5.05 | 5.40 | +700 | +6.93% | 6.55 | 4.70 |  |\n"
        "| **PR9** | ↑ L | 25 Jun 2026 | 17.30 | 17.60 | +300 | +1.73% | 18.50 | 17.10 |  |\n"
        "| **TIDLOR** | ↑ L | 6 Jul 2026 | 19.60 | 19.20 | -200 | -2.04% | 22.40 | 18.80 |  |\n"
        "| **TRUE** | ↑ L | 10 Jul 2026 | 13.60 | 13.60 | +0 | +0.00% | 14.80 | 12.60 |  |\n"
        "\n"
    )
    assert _section_positions(positions) == expected


def test_positions_section_zero_active_positions():
    """TC-MD-06: No active positions renders the empty-state message."""
    assert _section_positions([]) == (
        "## 2. Portfolio DB (Active Positions)\n\n_No active positions._\n\n"
    )


def test_positions_section_short_direction_uses_down_arrow():
    positions = [
        {"symbol": "AAA", "direction": "SHORT", "entryDate": "2026-01-01", "entryPrice": 10.0,
         "currentPrice": 9.0, "netPnl": 100, "pnlPct": 10.0, "tp": 8.0, "sl": 11.0, "remarks": "note"},
    ]
    out = _section_positions(positions)
    assert "| **AAA** | ↓ S |" in out
    assert "| note |" in out


# ── Section 3: Weekly Scan ───────────────────────────────────────────────────

def test_weekly_scan_section_header_with_week_range():
    scan = {
        "name": "WEEKLY_SCAN_11_07_2026",
        "monday": date(2026, 7, 13),
        "sunday": date(2026, 7, 19),
        "week_number": 29,
        "items": [
            {"symbol": "OSP", "list_name": "SET100", "strategy": "BREAK OUT", "buy_price": 17.90,
             "tp": 20.00, "sl": 16.90, "size": 1200, "remark": "", "color_mark": "CYAN"},
        ],
    }
    out = _section_weekly_scan(scan)
    assert out.startswith(
        "## 3. Weekly Scan — WEEKLY_SCAN_11_07_2026 (Week 29, 13 Jul–19 Jul 2026)\n\n"
    )


def test_weekly_scan_section_color_grouping_and_counts():
    """TC-MD-07: Items are grouped by color, ordered CYAN/GREEN/YELLOW/RED/
    PURPLE/Unreviewed, sorted alphabetically within each group; the count
    table only lists colors that actually have items."""
    scan = {
        "name": "S1", "monday": date(2026, 1, 5), "sunday": date(2026, 1, 11), "week_number": 2,
        "items": [
            {"symbol": "ZZZ", "list_name": "L1", "strategy": None, "buy_price": None,
             "tp": None, "sl": None, "size": None, "remark": None, "color_mark": "GREEN"},
            {"symbol": "AAA", "list_name": "L1", "strategy": None, "buy_price": None,
             "tp": None, "sl": None, "size": None, "remark": None, "color_mark": "GREEN"},
            {"symbol": "BBB", "list_name": "L1", "strategy": None, "buy_price": None,
             "tp": None, "sl": None, "size": None, "remark": None, "color_mark": None},
        ],
    }
    out = _section_weekly_scan(scan)
    # Count table: only GREEN (2) and Unreviewed (1) — YELLOW/RED/PURPLE/CYAN absent
    assert "| GREEN — Buy | 2 |" in out
    assert "| Unreviewed | 1 |" in out
    assert "CYAN" not in out
    assert "YELLOW" not in out
    assert "RED" not in out
    assert "PURPLE" not in out
    # Alphabetical within group: AAA before ZZZ
    assert out.index("**AAA**") < out.index("**ZZZ**")
    # Unreviewed group renders with its own subsection
    assert "### Unreviewed" in out
    assert "**BBB**" in out


def test_weekly_scan_section_unknown_color_falls_back_to_unreviewed():
    """An unexpected color_mark value (not one of the 5 known colors) is
    treated as unreviewed rather than dropped or raising an error."""
    scan = {
        "name": "S1", "monday": date(2026, 1, 5), "sunday": date(2026, 1, 11), "week_number": 2,
        "items": [
            {"symbol": "AAA", "list_name": "L1", "strategy": None, "buy_price": None,
             "tp": None, "sl": None, "size": None, "remark": None, "color_mark": "MAGENTA"},
        ],
    }
    out = _section_weekly_scan(scan)
    assert "| Unreviewed | 1 |" in out
    assert "**AAA**" in out


def test_weekly_scan_section_zero_items():
    """TC-MD-08: A scan with zero items renders the empty-state message,
    header still included when scan is not None."""
    scan = {"name": "S1", "monday": date(2026, 1, 5), "sunday": date(2026, 1, 11),
            "week_number": 2, "items": []}
    assert _section_weekly_scan(scan) == (
        "## 3. Weekly Scan — S1 (Week 2, 5 Jan–11 Jan 2026)\n\n_No scan items._\n\n"
    )


def test_weekly_scan_section_none_scan():
    assert _section_weekly_scan(None) == "## 3. Weekly Scan\n\n_No scan items._\n\n"


# ── Section 4: Portfolio Action Review ──────────────────────────────────────

def test_review_section_matches_ground_truth_row_format():
    """TC-MD-09: Active position (no exit) and closed position (with exit +
    sell_reason) both render correctly; open positions show '—' for exit
    date/price."""
    review_items = [
        {"symbol": "TRUE", "direction": "LONG", "status": "active",
         "entry_date": date(2026, 7, 10), "entry_price": 13.60,
         "exit_date": None, "exit_price": None, "position_size": 1500,
         "tp": 14.80, "sl": 12.60,
         "reason": "ไม่ดีเลย หาจุดเข้าจากไหน", "feel": 1,
         "sell_reason": None, "remarks": None},
        {"symbol": "TIDLOR", "direction": "LONG", "status": "closed",
         "entry_date": date(2026, 7, 6), "entry_price": 19.60,
         "exit_date": date(2026, 7, 8), "exit_price": 18.80, "position_size": 500,
         "tp": 22.40, "sl": 18.80,
         "reason": "ซื้อแบบ BO trendline", "feel": 4,
         "sell_reason": "Trump ประกาศสงคราม", "remarks": "Partial sell (500 shares)"},
    ]
    out = _section_review(review_items)
    assert out.startswith("## 4. Portfolio Action Review (Latest 2 Weeks)\n\n")
    assert (
        "| **TRUE** | ↑ L | active | 10 Jul 2026 | 13.60 | — | — | 1500 | 14.80 | 12.60 "
        "| ไม่ดีเลย หาจุดเข้าจากไหน | 1 |  |  |\n"
    ) in out
    assert (
        "| **TIDLOR** | ↑ L | closed | 6 Jul 2026 | 19.60 | 8 Jul 2026 | 18.80 | 500 | 22.40 | 18.80 "
        "| ซื้อแบบ BO trendline | 4 | Trump ประกาศสงคราม | Partial sell (500 shares) |\n"
    ) in out


def test_review_section_zero_rows():
    """TC-MD-10: No entries/exits in the last 2 weeks renders the empty-state message."""
    assert _section_review([]) == (
        "## 4. Portfolio Action Review (Latest 2 Weeks)\n\n"
        "_No entries or exits in the latest 2 weeks._\n\n"
    )


# ── Full assembly ────────────────────────────────────────────────────────────

def test_build_overall_plan_markdown_assembles_all_four_sections_in_order():
    """TC-MD-11: The public entry point stitches the header + all 4 sections
    with '---' dividers between (but not after) each section, in order."""
    generated_at = datetime(2026, 7, 12, 12, 53, tzinfo=BANGKOK)
    md = build_overall_plan_markdown(
        date_str="20260712",
        generated_at=generated_at,
        plan=None,
        positions=[],
        scan=None,
        review_items=[],
    )
    assert md.startswith("# OVERALL PLAN 20260712\n\n**Generated:** 12 Jul 2026 12:53  \n\n---\n\n")
    # Sections appear in order 1 → 2 → 3 → 4
    idx1 = md.index("## 1. Purchase Action Plan")
    idx2 = md.index("## 2. Portfolio DB")
    idx3 = md.index("## 3. Weekly Scan")
    idx4 = md.index("## 4. Portfolio Action Review")
    assert idx1 < idx2 < idx3 < idx4
    # Exactly 3 '---' dividers (between sections 1-2, 2-3, 3-4) + the 1 after the header = 4 total
    assert md.count("\n---\n\n") == 4
    # No divider after the final section
    assert not md.rstrip("\n").endswith("---")


def test_fmt_generated_at_matches_ground_truth():
    """TC-MD-12: '12 Jul 2026 12:53' — day not zero-padded, time zero-padded."""
    dt = datetime(2026, 7, 12, 12, 53, tzinfo=BANGKOK)
    assert _fmt_generated_at(dt) == "12 Jul 2026 12:53"


def test_fmt_generated_at_single_digit_day_and_hour_not_zero_padded_for_day():
    dt = datetime(2026, 8, 1, 9, 5, tzinfo=BANGKOK)
    assert _fmt_generated_at(dt) == "1 Aug 2026 09:05"


# ── Small formatting-helper edge cases ──────────────────────────────────────

def test_fmt_pct_none_is_dash():
    assert _fmt_pct(None) == "—"


def test_fmt_pnl_none_is_dash():
    assert _fmt_pnl(None) == "—"


def test_dir_arrow_none_direction_is_dash():
    assert _dir_arrow(None) == "—"


def test_dir_arrow_unknown_direction_passes_through_unchanged():
    """Any direction value other than LONG/SHORT (e.g. a future FLAT status)
    is rendered as-is rather than silently dropped or erroring."""
    assert _dir_arrow("FLAT") == "FLAT"


def test_parse_date_accepts_a_full_datetime_object():
    """entry_date/exit_date may arrive as either a plain date or a full
    datetime depending on the caller — both must be accepted."""
    assert _parse_date(datetime(2026, 5, 1, 10, 30)) == date(2026, 5, 1)


def test_positions_section_with_null_pnl_and_pct_renders_dashes():
    """A position missing netPnl/pnlPct (e.g. a data-quality gap) still
    renders the row instead of raising, showing dashes for those cells."""
    positions = [
        {"symbol": "ZZZ", "direction": "LONG", "entryDate": None, "entryPrice": None,
         "currentPrice": None, "netPnl": None, "pnlPct": None, "tp": None, "sl": None, "remarks": None},
    ]
    out = _section_positions(positions)
    assert "| **ZZZ** | ↑ L | — | — | — | — | — | — | — |  |\n" in out
    # Total P&L with a single None-netPnl position still renders (treated as 0)
    assert "**Total P&L:** +0  " in out


# ── Security fix: free-text values must not corrupt markdown table cells ───
# A stray '|' shifts subsequent columns; an embedded newline splits the row
# into two. _md_cell() (used by _or_blank/_or_dash and applied directly at
# the handful of call sites that bypass them) neutralizes both.

def test_md_cell_escapes_pipe():
    assert _md_cell("a | b") == "a \\| b"


def test_md_cell_collapses_newline_variants_to_a_single_space():
    assert _md_cell("a\nb") == "a b"
    assert _md_cell("a\r\nb") == "a b"
    assert _md_cell("a\rb") == "a b"


def test_md_cell_none_is_empty_string():
    assert _md_cell(None) == ""


def test_md_cell_plain_value_is_unchanged():
    assert _md_cell("Solid setup") == "Solid setup"


def test_purchase_plan_reason_with_pipe_is_escaped_not_broken():
    """A '|' in a free-text 'reason' cell must render as a literal escaped
    pipe rather than opening a new (bogus) table column."""
    plan = {
        "name": "P1", "notes": None, "set_analysis": None, "ai_recommend": None,
        "items": [
            {"sort_order": 0, "stock": "PTT", "strategy": None, "buy_price": None,
             "tp": None, "sl": None, "size": None, "current_price": None,
             "triggered": False, "reason": "breakout | watch volume"},
        ],
    }
    out = _section_purchase_plan(plan)
    assert "| 0 | **PTT** | — | — | — | — | — | — | — | breakout \\| watch volume |\n" in out


def test_purchase_plan_reason_with_embedded_newline_stays_on_one_row():
    """An embedded newline in 'reason' must not split the table row in two."""
    plan = {
        "name": "P1", "notes": None, "set_analysis": None, "ai_recommend": None,
        "items": [
            {"sort_order": 0, "stock": "PTT", "strategy": None, "buy_price": None,
             "tp": None, "sl": None, "size": None, "current_price": None,
             "triggered": False, "reason": "line one\nline two"},
        ],
    }
    out = _section_purchase_plan(plan)
    assert "| 0 | **PTT** | — | — | — | — | — | — | — | line one line two |\n" in out
    assert "line one\nline two" not in out


def test_purchase_plan_notes_and_ai_recommend_with_pipe_are_escaped():
    plan = {
        "name": "P1",
        "notes": "Watch SET | avoid financials",
        "set_analysis": "Bullish | cautious",
        "ai_recommend": "Trim | hold",
        "items": [
            {"sort_order": 0, "stock": "PTT", "strategy": None, "buy_price": None,
             "tp": None, "sl": None, "size": None, "current_price": None,
             "triggered": False, "reason": ""},
        ],
    }
    out = _section_purchase_plan(plan)
    assert "**Notes:** Watch SET \\| avoid financials  \n\n" in out
    assert "**Market Analysis:** Bullish \\| cautious  \n\n" in out
    assert "\n**AI Recommendation:** Trim \\| hold\n" in out


def test_positions_section_remarks_with_pipe_and_crlf_escaped_and_flattened():
    positions = [
        {"symbol": "AAA", "direction": "LONG", "entryDate": "2026-01-01", "entryPrice": 10.0,
         "currentPrice": 9.0, "netPnl": 100, "pnlPct": 10.0, "tp": 8.0, "sl": 11.0,
         "remarks": "partial | sell\r\nwatch again"},
    ]
    out = _section_positions(positions)
    assert "| partial \\| sell watch again |\n" in out


def test_weekly_scan_remark_with_pipe_is_escaped():
    scan = {
        "name": "S1", "monday": date(2026, 1, 5), "sunday": date(2026, 1, 11), "week_number": 2,
        "items": [
            {"symbol": "AAA", "list_name": "L1", "strategy": None, "buy_price": None,
             "tp": None, "sl": None, "size": None, "remark": "buy | watch", "color_mark": "GREEN"},
        ],
    }
    out = _section_weekly_scan(scan)
    assert "buy \\| watch |\n" in out


def test_review_section_free_text_columns_with_pipes_and_newlines_escaped():
    """All four free-text columns in section 4 (reason, feel, sell_reason,
    remarks) are escaped independently in the same row."""
    review_items = [
        {"symbol": "AAA", "direction": "LONG", "status": "closed",
         "entry_date": date(2026, 1, 1), "entry_price": 10.0,
         "exit_date": date(2026, 1, 5), "exit_price": 12.0, "position_size": 100,
         "tp": 14.0, "sl": 9.0,
         "reason": "a | b", "feel": "ok\nish",
         "sell_reason": "target | hit", "remarks": "note\r\nhere"},
    ]
    out = _section_review(review_items)
    assert (
        "| **AAA** | ↑ L | closed | 1 Jan 2026 | 10.00 | 5 Jan 2026 | 12.00 | 100 | 14.00 | 9.00 "
        "| a \\| b | ok ish | target \\| hit | note here |\n"
    ) in out


def test_symbol_with_pipe_is_escaped_defense_in_depth():
    """Ticker symbols are structured (not free text), but the same helper is
    applied defensively so a pathological symbol value can't break the table."""
    positions = [
        {"symbol": "A|B", "direction": "LONG", "entryDate": "2026-01-01", "entryPrice": 10.0,
         "currentPrice": 9.0, "netPnl": 100, "pnlPct": 10.0, "tp": 8.0, "sl": 11.0, "remarks": ""},
    ]
    out = _section_positions(positions)
    assert "| **A\\|B** |" in out


def test_normal_values_remain_byte_identical_after_escaping_change():
    """Regression guard: values with no '|' or newline characters must render
    exactly as before _md_cell escaping was introduced (mirrors TC-MD-01/04/09
    ground-truth strings, using different field combinations)."""
    positions = [
        {"symbol": "AAA", "direction": "LONG", "entryDate": "2026-01-01", "entryPrice": 10.0,
         "currentPrice": 9.0, "netPnl": 100, "pnlPct": 10.0, "tp": 8.0, "sl": 11.0, "remarks": "note"},
    ]
    out = _section_positions(positions)
    assert "| **AAA** | ↑ L | 1 Jan 2026 | 10.00 | 9.00 | +100 | +10.00% | 8.00 | 11.00 | note |\n" in out
