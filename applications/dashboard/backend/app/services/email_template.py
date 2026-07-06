"""Email template renderer — daily digest.

Replicates WeeklyPlanDashboard "by-date" view:
  rows = Mon-Fri, columns = stocks (5 per chunk)

Cell renderers match PlanCellDisplay.tsx and PortfolioCellDisplay.tsx exactly.
Colours from tailwind.config.ts / globals.css.
All CSS inline — Gmail strips <style> blocks.

Bar implementation notes:
- Uses <table> for the SL←bar→TP row so the bar cell always gets proper width.
  (display:flex / flex:1 is unreliable in Gmail web.)
- Uses margin-top/-left instead of transform: translate* for centering.
  (Some Gmail versions strip transform from inline styles.)
- Uses U+FE0E variation selector after ▶/◀ to prevent emoji rendering.
"""

from __future__ import annotations

from typing import Any

# ── Exact colours from tailwind.config.ts / globals.css ──────────────────────
_BG          = "#0B0F1A"   # surface-base
_CARD        = "#131929"   # surface-card
_OVERLAY     = "#232D45"   # surface-overlay  (bar track background)
_BORDER      = "#2A3450"   # border default
_BRAND_400   = "#60A5FA"   # brand-400 (today row text)
_BRAND_500   = "#3B82F6"
_GAIN        = "#22C55E"   # gain (text-gain / bg-gain)
_YELLOW      = "#f59e0b"   # yellow (text-yellow / bg-yellow)
_LOSS        = "#EF4444"   # loss
_WHITE       = "#FFFFFF"   # text-white (labels inside cells)
_INK_PRI     = "#E2E8F0"   # ink-primary
_INK_SEC     = "#94A3B8"   # ink-secondary
_INK_MUT     = "#64748B"   # ink-muted (← → separators)
_INK_DIS     = "#334155"   # ink-disabled (| dividers)
_YELLOW_400  = "#facc15"   # yellow-400 (★ star)
_PURPLE_400  = "#a855f7"   # purple-400 (entry dot)
# Arrow / coloured line colour — hardcoded in PlanCellDisplay.tsx
_ARROW_GAIN  = "#10b981"   # emerald-500 (current >= buy)
_ARROW_LOSS  = "#ef4444"   # red-500     (current <  buy)
_ARROW_NONE  = "#6b7280"   # gray-500    (no buy reference)

_TODAY_BG    = "rgba(59,130,246,0.05)"   # bg-brand-500/5

_SCAN_COLORS = {
    "CYAN":   "#22d3ee",
    "GREEN":  "#22C55E",
    "YELLOW": "#f59e0b",
    "RED":    "#EF4444",
    "PURPLE": "#a855f7",
}

_STRATEGY_ABBR: dict[str, str] = {
    "BREAK OUT":    "BO",
    "BREAKOUT":     "BO",
    "BUY ON DIP":   "BOD",
    "BUY ON THE DIP": "BOD",
    "แท่งเทียนกลับตัว": "ททกต",
    "ยยจท":  "ยยจท",
    "NEWS":   "NEWS",
    "AJ PAO": "AJPAO",
    "OTHERS": "OTHER",
}

# Unicode text-variation selector — forces ▶/◀ to render as text, not emoji
_VS15 = "︎"
_ARROW_R = f"▶{_VS15}"   # ▶ (text)
_ARROW_L = f"◄{_VS15}"   # ◀ (text)
_STAR    = "★"            # ★ (rarely renders as emoji — safe as-is)

_CHUNK_SIZE = 5
_DATE_W     = 90     # px
_STOCK_W    = 160    # px


# ── Helpers ───────────────────────────────────────────────────────────────────

def _f(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _clamp(val: float) -> float:
    return max(0.0, min(100.0, val))


def _abbr(s: str | None) -> str:
    if not s:
        return ""
    return _STRATEGY_ABBR.get(s.strip(), s.strip())


def _card(content: str) -> str:
    return (
        f'<div style="background:{_CARD};border-radius:8px;padding:16px 18px;'
        f'margin-bottom:20px;border:1px solid {_BORDER};">{content}</div>'
    )


def _heading(title: str) -> str:
    return (
        f'<div style="font-size:13px;font-weight:700;color:{_INK_PRI};'
        f'margin:0 0 12px 0;padding-bottom:10px;border-bottom:1px solid {_BORDER};">'
        f'{title}</div>'
    )


# ── Purchase bar (★ at buy, ▶/◀ at current) ──────────────────────────────────

def _purchase_bar(buy_pct: float, cur_pct: float, arrow_c: str) -> str:
    """Render the SL←TP bar for a purchase cell.

    Container is 20px tall so the 15px ★ fits without clipping.
    Centering uses margin-top (not transform) for Gmail compatibility.
    """
    min_p = min(buy_pct, cur_pct)
    max_p = max(buy_pct, cur_pct)

    is_right = cur_pct >= buy_pct
    arrow_ch = _ARROW_R if is_right else _ARROW_L

    # ▶ tip touches cur_pct → shift left by ~char width (~5px at 7px font)
    # ◀ tip touches cur_pct → no shift needed
    arrow_ml = "margin-left:-5px;" if is_right else "margin-left:0;"

    # ★ 15px font: centre by shifting -7px left and -7px up from top-left
    star_mt = "margin-top:-8px;"
    star_ml = "margin-left:-7px;"

    return (
        # 20px tall, display:block fills the table cell width
        f'<div style="position:relative;height:20px;display:block;width:100%;">'

        # Track — 6px, bg-surface-overlay, border-radius:3px, centred vertically
        f'<div style="position:absolute;left:0;right:0;height:6px;'
        f'background:{_OVERLAY};border-radius:3px;'
        f'top:50%;margin-top:-3px;"></div>'

        # Coloured line — 1px, from min% to max%
        f'<div style="position:absolute;height:1px;background:{arrow_c};'
        f'top:50%;margin-top:0;'
        f'left:{min_p:.1f}%;right:{100-max_p:.1f}%;"></div>'

        # Arrow ▶/◀ at current price — 7px bold, text-variant forced
        f'<span style="position:absolute;font-size:7px;font-weight:700;'
        f'color:{arrow_c};line-height:1;'
        f'top:50%;margin-top:-4px;left:{cur_pct:.1f}%;{arrow_ml}">'
        f'{arrow_ch}</span>'

        # ★ star at buy price — 15px yellow-400, centred on the point
        f'<span style="position:absolute;font-size:15px;color:{_YELLOW_400};'
        f'line-height:1;top:50%;left:{buy_pct:.1f}%;{star_mt}{star_ml}">'
        f'{_STAR}</span>'

        f'</div>'
    )


def _portfolio_bar(buy_pct: float | None, cur_pct: float, dot_c: str) -> str:
    """Render the SL←TP bar for a portfolio cell.

    Track is the container itself (6px h, bg-overlay).
    Dots overflow the track — parent height is 12px to avoid clipping the 8px dot.
    Centering uses margin-top/-left (not transform) for Gmail compatibility.
    """
    entry_dot = ""
    if buy_pct is not None:
        # Purple 6×6 dot, centred: margin-top:-3px, margin-left:-3px
        entry_dot = (
            f'<div style="position:absolute;width:6px;height:6px;'
            f'border-radius:50%;background:{_PURPLE_400};'
            f'top:50%;margin-top:-3px;left:{buy_pct:.1f}%;margin-left:-3px;"></div>'
        )

    # Green/red 8×8 dot, centred: margin-top:-4px, margin-left:-4px
    cur_dot = (
        f'<div style="position:absolute;width:8px;height:8px;'
        f'border-radius:50%;background:{dot_c};'
        f'top:50%;margin-top:-4px;left:{cur_pct:.1f}%;margin-left:-4px;"></div>'
    )

    return (
        # 12px tall container (track is 6px; dots max 8px, so 12px gives 2px clearance)
        f'<div style="position:relative;height:12px;display:block;width:100%;">'

        # Track — 6px, bg-surface-overlay, centred vertically
        f'<div style="position:absolute;left:0;right:0;height:6px;'
        f'background:{_OVERLAY};border-radius:3px;'
        f'top:50%;margin-top:-3px;"></div>'

        + entry_dot + cur_dot +
        f'</div>'
    )


def _sl_tp_row(sl: float | None, tp: float | None, bar_html: str) -> str:
    """Table-based SL ← [bar] → TP row.

    Using <table> (not flex) ensures the bar cell always gets its fair share
    of width — Gmail does not reliably propagate flex:1 to children.
    """
    sl_td = (
        f'<td style="white-space:nowrap;vertical-align:middle;padding:0;">'
        f'<span style="font-size:9px;color:{_LOSS};">{sl:.1f}</span>'
        f'</td>'
        if sl is not None else '<td></td>'
    )
    tp_td = (
        f'<td style="white-space:nowrap;vertical-align:middle;padding:0;">'
        f'<span style="font-size:9px;color:{_GAIN};">{tp:.1f}</span>'
        f'</td>'
        if tp is not None else '<td></td>'
    )
    arrow_style = f'font-size:9px;color:{_INK_MUT};padding:0 2px;vertical-align:middle;'
    return (
        f'<table width="100%" cellpadding="0" cellspacing="0" border="0"'
        f' style="margin-top:2px;">'
        f'<tr>'
        + sl_td
        + f'<td style="{arrow_style}">&#x2190;</td>'
        + f'<td width="100%" style="padding:0 2px;vertical-align:middle;">{bar_html}</td>'
        + f'<td style="{arrow_style}">&#x2192;</td>'
        + tp_td
        + f'</tr></table>'
    )


# ── PlanCellDisplay replication ────────────────────────────────────────────────

def _plan_cell(item: dict, day_price: float | None,
               prev_price: float | None = None) -> str:
    """Replicates PlanCellDisplay.tsx."""
    if day_price is None:
        return ""

    buy   = _f(item.get("buy_price"))
    sl    = _f(item.get("sl"))
    tp    = _f(item.get("tp"))
    strat = _abbr(item.get("strategy"))

    # Change %
    change_pct: float | None = None
    if prev_price and prev_price != 0:
        change_pct = (day_price - prev_price) / prev_price * 100
    change_label: str | None = None
    change_color = _GAIN
    if change_pct is not None:
        change_label = (
            "0.0%" if abs(change_pct) < 0.005
            else f"+{change_pct:.1f}%" if change_pct > 0
            else f"{change_pct:.1f}%"
        )
        change_color = _GAIN if change_pct >= 0 else _LOSS

    # ── Line 1 ───────────────────────────────────────────────────────────────
    SEP = f'<span style="color:{_INK_DIS};">&nbsp;|&nbsp;</span>'
    parts: list[str] = []
    parts.append(
        f'<span style="font-size:10px;color:{_WHITE};">BUY:</span>'
        f'&nbsp;<span style="font-size:10px;color:{_WHITE};font-weight:500;">'
        + (f'{buy:.1f}' if buy is not None else '&#8212;')
        + '</span>'
    )
    parts.append(
        f'<span style="font-size:10px;color:{_WHITE};">CURR:</span>'
        f'&nbsp;<span style="font-size:10px;color:{_WHITE};font-weight:500;">{day_price:.1f}</span>'
    )
    if change_label is not None:
        parts.append(
            f'<br><span style="font-size:10px;color:{_WHITE};">CHANGE:</span>'
            f'&nbsp;<span style="font-size:10px;color:{change_color};font-weight:500;">{change_label}</span>'
        )
    if strat:
        parts.append(f'<span style="font-size:10px;color:{_WHITE};">{strat}</span>')

    line1 = (
        f'<div style="font-size:12px;line-height:1.5;white-space:nowrap;overflow:hidden;">'
        + SEP.join(parts)
        + '</div>'
    )

    return line1


# ── PortfolioCellDisplay replication ──────────────────────────────────────────

def _portfolio_cell(item: dict, day_price: float | None,
                    prev_price: float | None = None) -> str:
    """Replicates PortfolioCellDisplay.tsx."""
    if day_price is None:
        return ""

    entry = _f(item.get("entryPrice") or item.get("entry_price"))
    sl    = _f(item.get("sl"))
    tp    = _f(item.get("tp"))

    is_profit = (day_price >= entry) if entry is not None else None
    cur_color = _GAIN if is_profit else _LOSS

    pnl_pct: float | None = None
    if entry and entry != 0:
        pnl_pct = (day_price - entry) / entry * 100

    change_pct: float | None = None
    if prev_price and prev_price != 0:
        change_pct = (day_price - prev_price) / prev_price * 100
    change_label: str | None = None
    change_color = _GAIN
    if change_pct is not None:
        change_label = (
            "0.0%" if abs(change_pct) < 0.005
            else f"+{change_pct:.1f}%" if change_pct > 0
            else f"{change_pct:.1f}%"
        )
        change_color = _GAIN if change_pct >= 0 else _LOSS

    # ── Line 1 ───────────────────────────────────────────────────────────────
    SEP = f'<span style="color:{_INK_DIS};">&nbsp;|&nbsp;</span>'
    parts: list[str] = []

    if pnl_pct is not None:
        pnl_c = _GAIN if pnl_pct >= 0 else _LOSS
        sign  = "+" if pnl_pct >= 0 else ""
        parts.append(
            f'<span style="font-size:10px;color:{_WHITE};">P&amp;L%:</span>'
            f'&nbsp;<span style="font-size:10px;color:{pnl_c};font-weight:500;">{sign}{pnl_pct:.1f}%</span>'
        )
    if change_label is not None:
        parts.append(
            f'<span style="font-size:10px;color:{_WHITE};">CHG%:</span>'
            f'&nbsp;<span style="font-size:10px;color:{change_color};font-weight:500;">{change_label}</span>'
        )
    if entry is not None:
        parts.append(
            f'<br><span style="font-size:10px;color:{_WHITE};">ENTRY:</span>'
            f'&nbsp;<span style="font-size:10px;color:{_YELLOW};font-weight:500;">{entry:.2f}</span>'
        )
    parts.append(
        f'<span style="font-size:10px;color:{_WHITE};">CURR:</span>'
        f'&nbsp;<span style="font-size:10px;color:{cur_color};font-weight:500;">{day_price:.2f}</span>'
    )
    
    line1 = (
        f'<div style="font-size:12px;line-height:1.5;white-space:nowrap;overflow:hidden;">'
        + SEP.join(parts)
        + '</div>'
    )

    return line1


# ── By-date table (dates = rows, stocks = columns, 5 per chunk) ───────────────

def _by_date_table(
    variant: str,
    items: list[dict],
    price_history: dict[str, dict[str, float]],
    week_days: list[dict],
) -> str:
    """Matches WeeklyPlanTable.tsx by-date view exactly."""
    if not items:
        return ""

    table_min = _DATE_W + _CHUNK_SIZE * _STOCK_W   # 890 px

    chunks = [items[i:i + _CHUNK_SIZE] for i in range(0, len(items), _CHUNK_SIZE)]
    out: list[str] = []

    for chunk in chunks:
        pad = _CHUNK_SIZE - len(chunk)

        # ── Column headers ────────────────────────────────────────────────────
        hdr = (
            f'<th style="padding:8px 12px;text-align:left;font-size:10px;'
            f'font-weight:500;color:{_INK_SEC};width:{_DATE_W}px;'
            f'border-bottom:1px solid rgba(42,52,80,0.5);">Date</th>'
        )
        for it in chunk:
            if variant == "purchase":
                sym   = it.get("stock") or ""
                trig  = it.get("triggered", False)
                sl    = _f(it.get("sl"))
                tp    = _f(it.get("tp"))
                sym_c = _GAIN if trig else _INK_SEC
                mark  = "&#x2713;" if trig else ""   # ✓
            else:
                sym   = it.get("symbol") or ""
                sl    = _f(it.get("sl"))
                tp    = _f(it.get("tp"))
                sym_c = _INK_SEC
                mark  = ""

            sub = ""
            if tp is not None or sl is not None:
                tp_s = f'<span style="color:{_GAIN};">TP:&nbsp;{tp:.1f}</span>' if tp is not None else ""
                sep  = "&nbsp;/&nbsp;" if (tp is not None and sl is not None) else ""
                sl_s = f'<span style="color:{_LOSS};">SL:&nbsp;{sl:.1f}</span>' if sl is not None else ""
                sub  = (
                    f'<div style="font-size:9px;color:{_INK_DIS};'
                    f'font-weight:400;margin-top:1px;">'
                    + tp_s + sep + sl_s + '</div>'
                )

            hdr += (
                f'<th style="padding:8px 12px;text-align:center;font-size:10px;'
                f'font-weight:500;color:{_INK_SEC};width:{_STOCK_W}px;'
                f'border-bottom:1px solid rgba(42,52,80,0.5);">'
                f'<span style="font-family:monospace;font-weight:700;color:{sym_c};">'
                f'{sym}{mark}</span>{sub}</th>'
            )
        for _ in range(pad):
            hdr += (
                f'<th style="width:{_STOCK_W}px;'
                f'border-bottom:1px solid rgba(42,52,80,0.5);"></th>'
            )

        # ── Data rows (Mon – Fri) ─────────────────────────────────────────────
        rows = ""
        for day_idx, day in enumerate(week_days):
            is_today = day.get("is_today", False)
            row_bg   = f"background:{_TODAY_BG};" if is_today else ""
            date_c   = _BRAND_400 if is_today else _INK_MUT

            date_td = (
                f'<th scope="row" style="padding:8px 12px;text-align:left;'
                f'font-weight:500;white-space:nowrap;vertical-align:top;'
                f'width:{_DATE_W}px;border-bottom:1px solid rgba(42,52,80,0.25);'
                f'{row_bg}">'
                f'<span style="display:block;font-size:12px;color:{date_c};">'
                f'{day.get("label","")}</span>'
                f'<span style="display:block;font-size:10px;color:{_INK_DIS};'
                f'font-weight:400;">{day.get("date_label","")}</span>'
                f'</th>'
            )

            cells = ""
            for it in chunk:
                sym         = it.get("stock") or it.get("symbol") or ""
                sym_history = price_history.get(sym, {})

                if is_today:
                    raw = (
                        _f(it.get("current_price")) if variant == "purchase"
                        else _f(it.get("currentPrice"))
                    )
                    day_price = raw or sym_history.get(day.get("iso", ""))
                else:
                    day_price = sym_history.get(day.get("iso", ""))

                prev_price: float | None = None
                if day_idx > 0:
                    prev_iso   = week_days[day_idx - 1].get("iso", "")
                    prev_price = sym_history.get(prev_iso)

                cell = (
                    _plan_cell(it, day_price, prev_price)
                    if variant == "purchase"
                    else _portfolio_cell(it, day_price, prev_price)
                )
                cells += (
                    f'<td style="padding:8px 12px;vertical-align:top;'
                    f'width:{_STOCK_W}px;border-bottom:1px solid rgba(42,52,80,0.25);'
                    f'{row_bg}">{cell}</td>'
                )

            for _ in range(pad):
                cells += (
                    f'<td style="width:{_STOCK_W}px;'
                    f'border-bottom:1px solid rgba(42,52,80,0.25);{row_bg}"></td>'
                )

            rows += f'<tr>{date_td}{cells}</tr>'

        out.append(
            f'<div style="overflow-x:auto;margin-bottom:12px;">'
            f'<table width="100%" cellpadding="0" cellspacing="0" border="0"'
            f' style="border-collapse:collapse;font-size:10px;color:{_INK_PRI};'
            f'min-width:{table_min}px;">'
            f'<thead><tr>{hdr}</tr></thead>'
            f'<tbody>{rows}</tbody>'
            f'</table></div>'
        )

    return "".join(out)


# ── Section renderers ──────────────────────────────────────────────────────────

def _render_weekly_scan(data: dict | None) -> str:
    h = _heading("Weekly Scan")
    if data is None:
        return _card(h + f'<p style="color:{_INK_MUT};font-size:11px;">No scan data available.</p>')

    items: list[dict] = data.get("items", [])
    counts = {c: 0 for c in _SCAN_COLORS}
    for item in items:
        c = (item.get("color_mark") or "").upper()
        if c in counts:
            counts[c] += 1

    pills = "".join(
        f'<span style="display:inline-flex;align-items:center;margin:0 8px 6px 0;'
        f'padding:3px 10px;border-radius:20px;background:{hc}22;border:1px solid {hc}55;'
        f'font-size:11px;color:{_INK_PRI};font-weight:600;">'
        f'<span style="display:inline-block;width:7px;height:7px;border-radius:50%;'
        f'background:{hc};margin-right:5px;"></span>{lbl}: {counts[c]}</span>'
        for c, hc in _SCAN_COLORS.items()
        for lbl in [c.capitalize()]
    )

    sym_rows = ""
    for color in ("CYAN", "GREEN"):
        syms = [
            i.get("symbol") for i in items
            if (i.get("color_mark") or "").upper() == color and i.get("symbol")
        ]
        if syms:
            hc    = _SCAN_COLORS[color]
            chips = "".join(
                f'<span style="display:inline-block;padding:2px 7px;margin:2px 3px 2px 0;'
                f'border-radius:4px;background:{hc}22;border:1px solid {hc}55;'
                f'font-size:10px;font-family:monospace;color:{hc};font-weight:700;">'
                f'{s}</span>'
                for s in syms
            )
            sym_rows += (
                f'<div style="margin-top:10px;">'
                f'<div style="font-size:10px;font-weight:700;color:{hc};'
                f'margin-bottom:4px;">{color}</div>'
                f'<div>{chips}</div></div>'
            )

    subtitle = (
        f'<p style="margin:0 0 10px 0;font-size:10px;color:{_INK_MUT};">'
        f'{data.get("name","")}</p>'
        if data.get("name") else ""
    )
    return _card(
        h + subtitle
        + f'<div style="margin-bottom:8px;">{pills}</div>'
        + sym_rows
    )


def _render_purchase_plan(
    data: dict | None,
    ph: dict[str, dict[str, float]],
    wd: list[dict],
) -> str:
    h = _heading("Purchase Watchlist")
    if data is None:
        return _card(h + f'<p style="color:{_INK_MUT};font-size:11px;">No purchase plan available.</p>')
    items = [i for i in data.get("purchase_items", []) if i.get("stock")]
    if not items:
        return _card(h + f'<p style="color:{_INK_MUT};font-size:11px;">No items in purchase plan.</p>')

    subtitle = (
        f'<p style="margin:0 0 10px 0;font-size:10px;color:{_INK_MUT};">'
        f'{data.get("name","")}</p>'
        if data.get("name") else ""
    )
    legend = (
        f'<p style="margin:4px 0 0 0;font-size:9px;color:{_INK_MUT};">'
        f'&#x2713;&nbsp;= triggered &nbsp;&#183;&nbsp; '
        f'<span style="color:{_BRAND_400};">blue row</span>&nbsp;= today</p>'
    )
    return _card(h + subtitle + _by_date_table("purchase", items, ph, wd) + legend)


def _render_portfolio_summary_card(summary: dict) -> str:
    """Stats card: investment value, all-time P&L, open P&L, totals, win rate."""
    def _pnl_cell(label: str, value: float, pct: float | None = None,
                  extra_label: str = "", extra_val: str = "") -> str:
        c    = _GAIN if value >= 0 else _LOSS
        sign = "+" if value >= 0 else ""
        pct_html = ""
        if pct is not None:
            pct_c    = _GAIN if pct >= 0 else _LOSS
            pct_sign = "+" if pct >= 0 else ""
            pct_html = (
                f'<div style="font-size:11px;color:{pct_c};font-weight:500;margin-top:2px;">'
                f'{pct_sign}{pct:.2f}%</div>'
            )
        extra_html = ""
        if extra_label:
            extra_html = (
                f'<div style="font-size:10px;color:{_INK_MUT};margin-top:3px;">'
                f'{extra_label}: <span style="color:{_INK_PRI};">{extra_val}</span></div>'
            )
        return (
            f'<td style="padding:10px 14px;vertical-align:top;'
            f'border-right:1px solid {_BORDER};">'
            f'<div style="font-size:10px;color:{_INK_MUT};margin-bottom:4px;">{label}</div>'
            f'<div style="font-size:14px;font-weight:700;color:{c};font-family:monospace;">'
            f'{sign}{value:,.0f}</div>'
            f'{pct_html}{extra_html}</td>'
        )

    def _neutral_cell(label: str, main: str, sub: str = "") -> str:
        sub_html = (
            f'<div style="font-size:10px;color:{_INK_MUT};margin-top:3px;">{sub}</div>'
            if sub else ""
        )
        return (
            f'<td style="padding:10px 14px;vertical-align:top;'
            f'border-right:1px solid {_BORDER};">'
            f'<div style="font-size:10px;color:{_INK_MUT};margin-bottom:4px;">{label}</div>'
            f'<div style="font-size:14px;font-weight:700;color:{_INK_PRI};font-family:monospace;">'
            f'{main}</div>{sub_html}</td>'
        )

    inv_v    = summary.get("investmentValue", 0.0) or 0.0
    cl_pnl   = summary.get("alltimeClosedPnl", 0.0) or 0.0
    cl_pct   = summary.get("alltimeClosedPnlPct", 0.0) or 0.0
    op_pnl   = summary.get("openPnl", 0.0) or 0.0
    op_pct   = summary.get("openPnlPct", 0.0) or 0.0
    tot_val  = summary.get("totalValue", 0.0) or 0.0
    tot_pnl  = summary.get("totalPnl", 0.0) or 0.0
    tot_pct  = summary.get("totalPnlPct", 0.0) or 0.0
    winrate  = summary.get("winrate", 0.0) or 0.0
    t_closed = summary.get("totalClosed", 0) or 0
    w_closed = summary.get("winningClosed", 0) or 0

    wr_c = _GAIN if winrate >= 50 else _LOSS
    tot_val_c = _GAIN if tot_val >= inv_v else _LOSS

    row1 = (
        f'<tr>'
        + _neutral_cell("Investment Value", f'{inv_v:,.0f}', "Capital deployed")
        + _pnl_cell("All-time Closed P&amp;L", cl_pnl, cl_pct)
        + _pnl_cell("Open P&amp;L (Unrealized)", op_pnl, op_pct)
        + (
            f'<td style="padding:10px 14px;vertical-align:top;">'
            f'<div style="font-size:10px;color:{_INK_MUT};margin-bottom:4px;">Win Rate (All-time)</div>'
            f'<div style="font-size:14px;font-weight:700;color:{wr_c};font-family:monospace;">'
            f'{winrate:.1f}%</div>'
            f'<div style="font-size:10px;color:{_INK_MUT};margin-top:3px;">'
            f'{w_closed}W / {t_closed - w_closed}L ({t_closed} trades)</div>'
            f'</td>'
        )
        + f'</tr>'
    )

    tot_sign = "+" if tot_pnl >= 0 else ""
    tot_pct_sign = "+" if tot_pct >= 0 else ""
    tot_pnl_c = _GAIN if tot_pnl >= 0 else _LOSS

    row2 = (
        f'<tr style="background:{_OVERLAY}22;">'
        + (
            f'<td style="padding:10px 14px;vertical-align:top;border-right:1px solid {_BORDER};">'
            f'<div style="font-size:10px;color:{_INK_MUT};margin-bottom:4px;">Total Portfolio Value</div>'
            f'<div style="font-size:15px;font-weight:800;color:{tot_val_c};font-family:monospace;">'
            f'{tot_val:,.0f}</div>'
            f'<div style="font-size:10px;color:{_INK_MUT};margin-top:3px;">'
            f'Investment + Closed P&amp;L + Open P&amp;L</div></td>'
        )
        + (
            f'<td colspan="2" style="padding:10px 14px;vertical-align:top;border-right:1px solid {_BORDER};">'
            f'<div style="font-size:10px;color:{_INK_MUT};margin-bottom:4px;">Total P&amp;L</div>'
            f'<div style="font-size:15px;font-weight:800;color:{tot_pnl_c};font-family:monospace;">'
            f'{tot_sign}{tot_pnl:,.0f}</div>'
            f'<div style="font-size:11px;color:{tot_pnl_c};margin-top:2px;font-weight:500;">'
            f'{tot_pct_sign}{tot_pct:.2f}%</div></td>'
        )
        + f'<td></td></tr>'
    )

    return (
        f'<div style="overflow-x:auto;margin-bottom:14px;">'
        f'<table width="100%" cellpadding="0" cellspacing="0" border="0"'
        f' style="border-collapse:collapse;background:{_CARD};'
        f'border:1px solid {_BORDER};border-radius:6px;">'
        f'<tbody>{row1}{row2}</tbody>'
        f'</table></div>'
    )


def _render_portfolio_detail_table(positions: list[dict], show_open_col: bool = True) -> str:
    """Flat positions table — mirrors PortfolioOverview PositionsTable."""
    if not positions:
        return ""

    TH = (
        f'padding:7px 10px;text-align:left;font-size:10px;font-weight:600;'
        f'color:{_INK_SEC};white-space:nowrap;border-bottom:1px solid {_BORDER};'
        f'background:{_CARD};'
    )
    TD      = f'padding:6px 10px;font-size:11px;vertical-align:top;white-space:nowrap;border-bottom:1px solid rgba(42,52,80,0.3);'
    TD_MONO = TD + 'font-family:monospace;'

    headers = ["Symbol", "Dir", "Entry Date", "Entry ฿", "Exit Date", "Exit ฿",
               "Current ฿", "Size", "Net P&L", "P&L%", "Status"]
    thead = "".join(f'<th style="{TH}">{h}</th>' for h in headers)

    rows_html = ""
    for pos in positions:
        is_short  = str(pos.get("direction", "")).upper() == "SHORT"
        is_closed = pos.get("status", "") != "active"
        status_c  = _INK_MUT if is_closed else _GAIN
        status_lbl = "CLOSED" if is_closed else "OPEN"
        dir_c     = _LOSS if is_short else _GAIN
        dir_lbl   = "↓ S" if is_short else "↑ L"

        net_pnl  = pos.get("netPnl", 0.0) or 0.0
        pnl_pct  = pos.get("pnlPct", 0.0) or 0.0
        pnl_c    = _GAIN if net_pnl >= 0 else _LOSS
        pnl_sign = "+" if net_pnl >= 0 else ""
        pct_sign = "+" if pnl_pct >= 0 else ""

        entry_p = pos.get("entryPrice")
        exit_p  = pos.get("exitPrice")
        cur_p   = pos.get("currentPrice")

        rows_html += (
            f'<tr>'
            f'<td style="{TD_MONO}font-weight:700;color:{_INK_PRI};">{pos.get("symbol", "")}</td>'
            f'<td style="{TD}color:{dir_c};font-weight:600;">{dir_lbl}</td>'
            f'<td style="{TD}color:{_INK_SEC};">{pos.get("entryDate") or "—"}</td>'
            f'<td style="{TD_MONO}color:{_INK_SEC};">{f"{entry_p:.2f}" if entry_p else "—"}</td>'
            f'<td style="{TD}color:{_INK_SEC};">{pos.get("exitDate") or "—"}</td>'
            f'<td style="{TD_MONO}color:{_INK_SEC};">{f"{exit_p:.2f}" if exit_p else "—"}</td>'
            f'<td style="{TD_MONO}color:{_INK_PRI};">{f"{cur_p:.2f}" if (cur_p and not is_closed) else "—"}</td>'
            f'<td style="{TD_MONO}color:{_INK_SEC};">{int(pos.get("positionSize", 0)):,}</td>'
            f'<td style="{TD_MONO}color:{pnl_c};font-weight:600;">{pnl_sign}{net_pnl:,.0f}</td>'
            f'<td style="{TD_MONO}color:{pnl_c};font-weight:600;">{pct_sign}{pnl_pct:.1f}%</td>'
            f'<td style="{TD}"><span style="display:inline-block;padding:1px 7px;border-radius:4px;'
            f'font-size:10px;font-weight:700;background:{status_c}22;color:{status_c};">'
            f'{status_lbl}</span></td>'
            f'</tr>'
        )

    total_pnl  = sum(p.get("netPnl", 0.0) or 0.0 for p in positions)
    total_c    = _GAIN if total_pnl >= 0 else _LOSS
    total_sign = "+" if total_pnl >= 0 else ""
    tfoot = (
        f'<tr style="background:{_OVERLAY};">'
        f'<td colspan="8" style="{TD}font-weight:600;color:{_INK_SEC};text-align:right;">Total</td>'
        f'<td style="{TD_MONO}color:{total_c};font-weight:700;">{total_sign}{total_pnl:,.0f}</td>'
        f'<td colspan="2"></td>'
        f'</tr>'
    )

    return (
        f'<div style="overflow-x:auto;margin-top:14px;">'
        f'<table width="100%" cellpadding="0" cellspacing="0" border="0"'
        f' style="border-collapse:collapse;font-size:11px;color:{_INK_PRI};">'
        f'<thead><tr>{thead}</tr></thead>'
        f'<tbody>{rows_html}</tbody>'
        f'<tfoot>{tfoot}</tfoot>'
        f'</table></div>'
    )


def _render_portfolio(
    data: dict | None,
    ph: dict[str, dict[str, float]],
    wd: list[dict],
) -> str:
    h = _heading("Portfolio Positions")
    if data is None:
        return _card(h + f'<p style="color:{_INK_MUT};font-size:11px;">No portfolio data available.</p>')

    open_positions = data.get("open_positions", [])
    closed_recent  = data.get("closed_recent", [])
    summary        = data.get("summary", {})

    if not open_positions and not closed_recent:
        return _card(h + f'<p style="color:{_INK_MUT};font-size:11px;">No positions.</p>')

    legend = (
        f'<p style="margin:4px 0 0 0;font-size:9px;color:{_INK_MUT};">'
        f'<span style="color:{_BRAND_400};">blue row</span>&nbsp;= today</p>'
    )
    by_date_section = _by_date_table("portfolio", open_positions, ph, wd) + legend if open_positions else ""

    summary_section = _render_portfolio_summary_card(summary) if summary else ""

    open_heading = (
        f'<div style="font-size:11px;font-weight:700;color:{_INK_SEC};'
        f'margin:16px 0 4px 0;padding-top:12px;border-top:1px solid {_BORDER};">'
        f'Open Positions</div>'
    ) if open_positions else ""
    open_table = _render_portfolio_detail_table(open_positions) if open_positions else (
        f'<p style="color:{_INK_MUT};font-size:11px;margin:8px 0;">No open positions.</p>'
    )

    closed_heading = (
        f'<div style="font-size:11px;font-weight:700;color:{_INK_SEC};'
        f'margin:20px 0 4px 0;padding-top:12px;border-top:1px solid {_BORDER};">'
        f'Closed (Last 2 Weeks)</div>'
    )
    closed_table = _render_portfolio_detail_table(closed_recent) if closed_recent else (
        f'<p style="color:{_INK_MUT};font-size:11px;margin:8px 0;">No closed positions in last 2 weeks.</p>'
    )

    return _card(
        h
        + summary_section
        + by_date_section
        + open_heading
        + open_table
        + closed_heading
        + closed_table
    )


# ── Public entry point ─────────────────────────────────────────────────────────

def render_daily_digest(
    weekly_scan: dict | None,
    purchase_plan: dict | None,
    portfolio: dict | None,
    generated_at: str,
    price_history: dict[str, dict[str, float]] | None = None,
    week_days: list[dict] | None = None,
    dashboard_url: str = "",
) -> str:
    """Return a complete HTML email ready to send."""
    ph = price_history or {}
    wd = week_days    or []
    url_btn = (
        f'<a href="{dashboard_url}" target="_blank" '
        f'style="display:inline-block;padding:5px 14px;border-radius:6px;'
        f'background:{_BRAND_500};color:#fff;font-size:11px;font-weight:600;'
        f'text-decoration:none;white-space:nowrap;">Open Dashboard ↗</a>'
        if dashboard_url else ""
    )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>POP Investment Digest</title>
</head>
<body style="margin:0;padding:0;background:{_BG};
     font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
     -webkit-font-smoothing:antialiased;">

<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:{_BG};">
<tr><td align="center" style="padding:24px 8px;">
<table cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:960px;">

  <!-- Header -->
  <tr><td style="background:{_CARD};border-radius:8px 8px 0 0;
                 padding:18px 22px;border:1px solid {_BORDER};border-bottom:none;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td>
        <div style="font-size:18px;font-weight:800;color:{_INK_PRI};">
          POP Investment Dashboard
        </div>
        <div style="font-size:11px;color:{_INK_SEC};margin-top:2px;">Daily Digest</div>
      </td>
      <td align="right" style="vertical-align:top;">
        <div style="font-size:11px;color:{_INK_MUT};margin-bottom:6px;">{generated_at}</div>
        {url_btn}
      </td>
    </tr></table>
  </td></tr>

  <!-- Body -->
  <tr><td style="background:{_BG};padding:16px 0;
                 border-left:1px solid {_BORDER};border-right:1px solid {_BORDER};">
    <div style="padding:0 14px;">

      {_render_weekly_scan(weekly_scan)}

      <div style="height:1px;background:{_BORDER};margin:0 0 18px 0;"></div>

      {_render_purchase_plan(purchase_plan, ph, wd)}

      <div style="height:1px;background:{_BORDER};margin:0 0 18px 0;"></div>

      {_render_portfolio(portfolio, ph, wd)}

    </div>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:{_CARD};border-radius:0 0 8px 8px;
                 padding:12px 22px;border:1px solid {_BORDER};border-top:none;">
    <p style="margin:0;font-size:10px;color:{_INK_MUT};text-align:center;">
      {generated_at} &nbsp;&#183;&nbsp; POP Investment Dashboard
    </p>
    <p style="margin:4px 0 0 0;font-size:9px;color:{_INK_DIS};text-align:center;">
      Prices are indicative. Not financial advice.
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>"""
