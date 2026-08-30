"""The single home of the "profit vs original investment" formula.

Both read-time consumers — the per-item running-total projection
(`app/api/v1/endpoints/tracking_items.py::running_total`) and the
tracking-set rollup (`app/services/original_investment_rollup.py`) — call
`compute_profit` rather than re-deriving profit / profit-% themselves, so
the zero/negative-denominator guard lives in exactly one place.

Pure module: no I/O, no ORM, no framework types. `Decimal` in, `Decimal`
out — never float — so currency math stays exact.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class ProfitFigures:
    net_original_investment: Decimal | None
    current_value: Decimal | None
    profit: Decimal | None
    profit_percent: Decimal | None
    is_covered: bool


def compute_profit(
    *, net_original_investment: Decimal | None, current_value: Decimal | None
) -> ProfitFigures:
    """profit  = current_value - net_original_investment   (only when BOTH present)
    profit_% = profit / net_original_investment * 100     (only when net > 0)

    `is_covered` means "both a net original investment and a current value
    were available" — it does NOT require net > 0, so an item whose entries
    net to zero or a negative figure still counts as covered (its profit is
    reported; only its percentage is suppressed).
    """
    has_entries = net_original_investment is not None
    has_value = current_value is not None
    profit = (
        (current_value - net_original_investment) if (has_entries and has_value) else None
    )
    profit_percent = None
    if has_entries and has_value and net_original_investment > 0:
        profit_percent = (profit / net_original_investment) * Decimal(100)
    return ProfitFigures(
        net_original_investment=net_original_investment,
        current_value=current_value,
        profit=profit,
        profit_percent=profit_percent,
        is_covered=has_entries and has_value,
    )
