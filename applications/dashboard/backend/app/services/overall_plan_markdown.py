"""Pure markdown assembly for the Overall Plan report.

No DB/HTTP concerns live here — every function takes plain Python
dicts/values already fetched by the endpoint (see
``app.api.v1.endpoints.overall_plan``), so the whole module is unit-testable
without a database or an event loop.

Formatting mirrors the existing client-side reference implementation,
``buildOverallMd()`` in
``applications/dashboard/frontend/src/app/(dashboard)/action-plan/page.tsx``
(~line 422), byte-for-byte where practical. Do not change formatting here
without cross-checking that reference and a ground-truth exported file.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

_MONTH_ABBR = [
    "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

# Weekly-scan color grouping — order and labels match EXPORT_COLOR_ORDER /
# EXPORT_COLOR_LABELS in the frontend reference. "" is the unreviewed bucket
# (mirrors the "NONE" bucket in weekly_scan.py's _color_counts()).
_COLOR_ORDER = ["CYAN", "GREEN", "YELLOW", "RED", "PURPLE", ""]
_COLOR_LABELS = {
    "CYAN": "CYAN — Strong Candidate",
    "GREEN": "GREEN — Buy",
    "YELLOW": "YELLOW — Watch",
    "RED": "RED — Avoid / Short",
    "PURPLE": "PURPLE — In Portfolio",
    "": "Unreviewed",
}
_KNOWN_COLORS = {"CYAN", "GREEN", "YELLOW", "RED", "PURPLE"}


# ── Formatting helpers ──────────────────────────────────────────────────────

def _fmt_n(v: Any, dp: int = 2) -> str:
    """Number formatted to *dp* decimals, or an em dash when null/missing."""
    if v is None:
        return "—"
    return f"{float(v):.{dp}f}"


def _fmt_pct(v: Any) -> str:
    if v is None:
        return "—"
    fv = float(v)
    sign = "+" if fv >= 0 else ""
    return f"{sign}{fv:.2f}%"


def _fmt_pnl(v: Any) -> str:
    if v is None:
        return "—"
    rounded = round(float(v))
    sign = "+" if rounded >= 0 else ""
    return f"{sign}{rounded:,}"


def _fmt_date(d: date | None, include_year: bool = True) -> str:
    if d is None:
        return "—"
    if include_year:
        return f"{d.day} {_MONTH_ABBR[d.month]} {d.year}"
    return f"{d.day} {_MONTH_ABBR[d.month]}"


def _fmt_generated_at(dt: datetime) -> str:
    return f"{dt.day} {_MONTH_ABBR[dt.month]} {dt.year} {dt.hour:02d}:{dt.minute:02d}"


def _dir_arrow(direction: str | None) -> str:
    if direction == "LONG":
        return "↑ L"
    if direction == "SHORT":
        return "↓ S"
    return direction or "—"


def _md_cell(v: Any) -> str:
    """Escape a value for safe embedding in a single markdown table cell:
    pipes would shift columns, newlines/carriage-returns would split the row."""
    if v is None:
        return ""
    return str(v).replace("|", "\\|").replace("\r\n", " ").replace("\n", " ").replace("\r", " ")


def _or_dash(v: Any) -> str:
    return _md_cell(v) if v not in (None, "") else "—"


def _or_blank(v: Any) -> str:
    return _md_cell(v) if v is not None else ""


def _parse_date(v: Any) -> date | None:
    """Accept a date/datetime object, an ISO date string, or None."""
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    return date.fromisoformat(str(v)[:10])


# ── Section 1: Purchase Action Plan ─────────────────────────────────────────

def _section_purchase_plan(plan: dict[str, Any] | None) -> str:
    md = "## 1. Purchase Action Plan"
    if plan:
        md += f" — {plan['name']}"
    md += "\n\n"

    items = plan.get("items", []) if plan else []
    if not plan or not items:
        return md + "_No purchase plan items._\n\n"

    if plan.get("notes"):
        md += f"**Notes:** {_md_cell(plan['notes'])}  \n\n"
    if plan.get("set_analysis"):
        md += f"**Market Analysis:** {_md_cell(plan['set_analysis'])}  \n\n"

    md += "| # | Stock | Strategy | Buy | TP | SL | Size | Current | Triggered | Reason |\n"
    md += "|---|-------|----------|-----|----|----|----|---------|-----------|--------|\n"
    for it in items:
        md += (
            f"| {it.get('sort_order', 0)} | **{_md_cell(it['stock'])}** | {_or_dash(it.get('strategy'))} | "
            f"{_fmt_n(it.get('buy_price'))} | {_fmt_n(it.get('tp'))} | {_fmt_n(it.get('sl'))} | "
            f"{_or_dash(it.get('size'))} | {_fmt_n(it.get('current_price'))} | "
            f"{'✓' if it.get('triggered') else '—'} | {_or_blank(it.get('reason'))} |\n"
        )

    if plan.get("ai_recommend"):
        md += f"\n**AI Recommendation:** {_md_cell(plan['ai_recommend'])}\n"
    md += "\n"
    return md


# ── Section 2: Portfolio DB active positions ────────────────────────────────

def _section_positions(positions: list[dict[str, Any]]) -> str:
    md = "## 2. Portfolio DB (Active Positions)\n\n"
    if not positions:
        return md + "_No active positions._\n\n"

    total_pnl = sum(p.get("netPnl") or 0 for p in positions)
    md += f"**{len(positions)} active positions** | **Total P&L:** {_fmt_pnl(total_pnl)}  \n\n"
    md += "| Symbol | Dir | Entry Date | Entry | Current | P&L | P&L% | TP | SL | Remarks |\n"
    md += "|--------|-----|------------|-------|---------|-----|------|----|----|--------|\n"
    for p in sorted(positions, key=lambda x: x["symbol"]):
        entry_date = _parse_date(p.get("entryDate"))
        md += (
            f"| **{_md_cell(p['symbol'])}** | {_dir_arrow(p.get('direction'))} | {_fmt_date(entry_date)} | "
            f"{_fmt_n(p.get('entryPrice'))} | {_fmt_n(p.get('currentPrice'))} | "
            f"{_fmt_pnl(p.get('netPnl'))} | {_fmt_pct(p.get('pnlPct'))} | "
            f"{_fmt_n(p.get('tp'))} | {_fmt_n(p.get('sl'))} | {_or_blank(p.get('remarks'))} |\n"
        )
    md += "\n"
    return md


# ── Section 3: Weekly Scan ───────────────────────────────────────────────────

def _section_weekly_scan(scan: dict[str, Any] | None) -> str:
    md = "## 3. Weekly Scan"
    items = scan.get("items", []) if scan else []
    if scan:
        monday, sunday, week_no = scan["monday"], scan["sunday"], scan["week_number"]
        md += (
            f" — {scan['name']} (Week {week_no}, "
            f"{_fmt_date(monday, include_year=False)}–{_fmt_date(sunday)})"
        )
    md += "\n\n"

    if not items:
        return md + "_No scan items._\n\n"

    groups: dict[str, list[dict[str, Any]]] = {k: [] for k in _COLOR_ORDER}
    for it in sorted(items, key=lambda x: x["symbol"]):
        color = it.get("color_mark") or ""
        key = color if color in _KNOWN_COLORS else ""
        groups[key].append(it)

    md += "| Color | Count |\n|-------|-------|\n"
    for k in _COLOR_ORDER:
        if groups[k]:
            md += f"| {_COLOR_LABELS[k]} | {len(groups[k])} |\n"
    md += "\n"

    for k in _COLOR_ORDER:
        if not groups[k]:
            continue
        md += f"### {_COLOR_LABELS[k]}\n\n"
        md += "| Symbol | List | Strategy | Buy | TP | SL | Size | Remark |\n"
        md += "|--------|------|----------|-----|----|----|----|--------|\n"
        for it in groups[k]:
            md += (
                f"| **{_md_cell(it['symbol'])}** | {_or_dash(it.get('list_name'))} | {_or_dash(it.get('strategy'))} | "
                f"{_fmt_n(it.get('buy_price'))} | {_fmt_n(it.get('tp'))} | {_fmt_n(it.get('sl'))} | "
                f"{_or_dash(it.get('size'))} | {_or_blank(it.get('remark'))} |\n"
            )
        md += "\n"
    return md


# ── Section 4: Portfolio Action Review (latest 2 weeks) ─────────────────────

def _section_review(review_items: list[dict[str, Any]]) -> str:
    md = "## 4. Portfolio Action Review (Latest 2 Weeks)\n\n"
    if not review_items:
        return md + "_No entries or exits in the latest 2 weeks._\n\n"

    md += (
        "| Symbol | Dir | Status | Entry Date | Entry | Exit Date | Exit | Size | TP | SL "
        "| Reason | Feel | Sell Reason | Remarks |\n"
    )
    md += (
        "|--------|-----|--------|------------|-------|-----------|------|------|----|----"
        "|--------|------|-------------|--------|\n"
    )
    for it in review_items:
        entry_date = _parse_date(it.get("entry_date"))
        exit_date = _parse_date(it.get("exit_date"))
        md += (
            f"| **{_md_cell(it['symbol'])}** | {_dir_arrow(it.get('direction'))} | {_or_blank(it.get('status'))} | "
            f"{_fmt_date(entry_date)} | {_fmt_n(it.get('entry_price'))} | "
            f"{_fmt_date(exit_date)} | {_fmt_n(it.get('exit_price'))} | "
            f"{_or_dash(it.get('position_size'))} | {_fmt_n(it.get('tp'))} | {_fmt_n(it.get('sl'))} | "
            f"{_or_blank(it.get('reason'))} | {_or_blank(it.get('feel'))} | "
            f"{_or_blank(it.get('sell_reason'))} | {_or_blank(it.get('remarks'))} |\n"
        )
    md += "\n"
    return md


# ── Public entry point ───────────────────────────────────────────────────────

def build_overall_plan_markdown(
    *,
    date_str: str,
    generated_at: datetime,
    plan: dict[str, Any] | None,
    positions: list[dict[str, Any]],
    scan: dict[str, Any] | None,
    review_items: list[dict[str, Any]],
) -> str:
    """Assemble the full Overall Plan markdown report from already-fetched data.

    Parameters
    ----------
    date_str:
        Server-derived filename date component, e.g. ``"20260801"``.
    generated_at:
        Bangkok-local timestamp to stamp in the report header.
    plan:
        ``{"name", "notes", "set_analysis", "ai_recommend", "items": [...]}``
        or ``None``. Each item: ``{"sort_order", "stock", "strategy",
        "buy_price", "tp", "sl", "size", "current_price", "triggered",
        "reason"}``.
    positions:
        List of dicts shaped like ``list_positions_db()``'s serialized
        output (camelCase keys: symbol, direction, entryDate, entryPrice,
        currentPrice, netPnl, pnlPct, tp, sl, remarks).
    scan:
        ``{"name", "monday", "sunday", "week_number", "items": [...]}`` or
        ``None``. Each item: ``{"symbol", "list_name", "strategy",
        "buy_price", "tp", "sl", "size", "remark", "color_mark"}``.
    review_items:
        List of dicts shaped like the Objective endpoint's response items
        (symbol, direction, status, entry_date, entry_price, exit_date,
        exit_price, position_size, tp, sl, reason, feel, sell_reason,
        remarks).
    """
    md = f"# OVERALL PLAN {date_str}\n\n"
    md += f"**Generated:** {_fmt_generated_at(generated_at)}  \n\n"
    md += "---\n\n"
    md += _section_purchase_plan(plan)
    md += "---\n\n"
    md += _section_positions(positions)
    md += "---\n\n"
    md += _section_weekly_scan(scan)
    md += "---\n\n"
    md += _section_review(review_items)
    return md
