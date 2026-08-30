"""Unit matrix for `app/services/profit_math.py::compute_profit` — the sole
home of the profit / profit-% formula and its zero/negative-denominator
guard. Pure function, no DB / HTTP, so these run as plain (non-async) tests.

Matrix: net original investment in {None, <0, ==0, >0} crossed with current
value in {None, present}. Asserted invariants:
  - profit is None unless BOTH inputs are present
  - profit_percent is None unless net > 0 AND value present
  - is_covered == (net is not None AND value is not None)   (net > 0 NOT required)
  - never raises (no ZeroDivisionError at net == 0)
  - Decimal in -> Decimal out, exact
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from app.services.profit_math import compute_profit

_NETS = {
    "none": None,
    "negative": Decimal("-500"),
    "zero": Decimal("0"),
    "positive": Decimal("1000"),
}
_VALUES = {
    "none": None,
    "present": Decimal("1200"),
}


@pytest.mark.parametrize("net_key", list(_NETS))
@pytest.mark.parametrize("value_key", list(_VALUES))
def test_compute_profit_matrix(net_key: str, value_key: str) -> None:
    net = _NETS[net_key]
    value = _VALUES[value_key]

    figs = compute_profit(net_original_investment=net, current_value=value)

    both_present = net is not None and value is not None

    # is_covered — does NOT require net > 0
    assert figs.is_covered is both_present

    # profit — only when both present
    if both_present:
        assert figs.profit == value - net
        assert isinstance(figs.profit, Decimal)
    else:
        assert figs.profit is None

    # profit_percent — only when net > 0 AND value present
    if both_present and net > 0:
        assert figs.profit_percent == (value - net) / net * Decimal(100)
        assert isinstance(figs.profit_percent, Decimal)
    else:
        assert figs.profit_percent is None

    # inputs echoed back untouched
    assert figs.net_original_investment == net
    assert figs.current_value == value


def test_compute_profit_zero_net_does_not_raise_and_suppresses_percent() -> None:
    figs = compute_profit(net_original_investment=Decimal("0"), current_value=Decimal("50"))
    assert figs.profit == Decimal("50")
    assert figs.profit_percent is None
    assert figs.is_covered is True


def test_compute_profit_positive_case_is_exact() -> None:
    figs = compute_profit(
        net_original_investment=Decimal("1000.00"), current_value=Decimal("1250.00")
    )
    assert figs.profit == Decimal("250.00")
    assert figs.profit_percent == Decimal("25")


def test_compute_profit_negative_net_reports_profit_but_null_percent() -> None:
    figs = compute_profit(
        net_original_investment=Decimal("-300"), current_value=Decimal("100")
    )
    assert figs.profit == Decimal("400")
    assert figs.profit_percent is None
    assert figs.is_covered is True


def test_compute_profit_loss_is_negative_profit() -> None:
    figs = compute_profit(
        net_original_investment=Decimal("1000"), current_value=Decimal("600")
    )
    assert figs.profit == Decimal("-400")
    assert figs.profit_percent == Decimal("-40")
