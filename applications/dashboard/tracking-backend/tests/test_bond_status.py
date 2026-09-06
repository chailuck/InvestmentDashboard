"""Unit tests for `app.services.bond_status.compute_bond_status` — the
read-time BOND status derivation.

Contract under test (verbatim status spelling):
  - `start` or `expired` missing        -> "Unknown"
  - today <  start                      -> "Pre-order"
  - today >  expired                    -> "Expire"
  - start <= today <= expired           -> "Active"  (BOTH boundaries inclusive)
Plus documented deterministic behaviour for inverted (start > expired) dates.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.services.bond_status import (
    bangkok_today,
    compute_bond_status,
    compute_bond_years,
)

S = date(2026, 6, 1)
E = date(2026, 12, 31)


@pytest.mark.parametrize(
    "start, expired, today, expected",
    [
        # ── Unknown: a missing endpoint dominates everything ──────────────
        pytest.param(None, E, date(2026, 7, 1), "Unknown", id="start-missing"),
        pytest.param(S, None, date(2026, 7, 1), "Unknown", id="expired-missing"),
        pytest.param(None, None, date(2026, 7, 1), "Unknown", id="both-missing"),
        pytest.param(None, None, date(1900, 1, 1), "Unknown", id="both-missing-any-today"),
        # ── Pre-order: strictly before start ─────────────────────────────
        pytest.param(S, E, date(2026, 1, 1), "Pre-order", id="well-before-start"),
        pytest.param(S, E, date(2026, 5, 31), "Pre-order", id="day-before-start"),
        # ── Active: inside [start, expired], both ends inclusive ─────────
        pytest.param(S, E, S, "Active", id="today==start-inclusive"),
        pytest.param(S, E, date(2026, 9, 15), "Active", id="mid-window"),
        pytest.param(S, E, E, "Active", id="today==expired-inclusive"),
        # ── Expire: strictly after expired ──────────────────────────────
        pytest.param(S, E, date(2027, 1, 1), "Expire", id="day-after-expired"),
        pytest.param(S, E, date(2030, 1, 1), "Expire", id="well-after-expired"),
        # ── Single-day bond: start == expired ───────────────────────────
        pytest.param(S, S, S, "Active", id="one-day-bond-on-the-day"),
        pytest.param(S, S, date(2026, 5, 31), "Pre-order", id="one-day-bond-before"),
        pytest.param(S, S, date(2026, 6, 2), "Expire", id="one-day-bond-after"),
    ],
)
def test_compute_bond_status(start, expired, today, expected):
    assert compute_bond_status(start, expired, today) == expected


@pytest.mark.parametrize(
    "today, expected",
    [
        # Inverted window: start (2026-06-01) is AFTER expired (2026-01-01).
        # Checks apply in order: `today < start` wins first, so the bond
        # reads "Pre-order" until today >= start, then "Expire" (today is
        # already past expired by construction). "Active" is unreachable.
        pytest.param(date(2025, 12, 1), "Pre-order", id="inverted-before-start"),
        pytest.param(date(2026, 1, 1), "Pre-order", id="inverted-on-expired-still-preorder"),
        pytest.param(date(2026, 3, 1), "Pre-order", id="inverted-between-expired-and-start"),
        # today == start but already past expired: `today < start` is False,
        # `today > expired` is True -> "Expire". "Active" is unreachable when
        # start > expired.
        pytest.param(date(2026, 6, 1), "Expire", id="inverted-on-start-boundary"),
        pytest.param(date(2026, 7, 1), "Expire", id="inverted-after-start"),
    ],
)
def test_compute_bond_status_inverted_dates_are_deterministic(today, expected):
    assert compute_bond_status(date(2026, 6, 1), date(2026, 1, 1), today) == expected


# ── compute_bond_years — whole-year term span, ROUND_HALF_UP ─────────────────
#
# Contract under test:
#   - start or expired missing            -> None  (mirrors status "Unknown")
#   - pure function of the two dates       -> no `today`, no clock dependency
#   - span_days / 365.25, quantized to an int with decimal.ROUND_HALF_UP
#     (ties away from zero — NOT banker's rounding)
#   - negative span (expired < start)      -> negative int, passed through
#     unchanged: no clamp, no raise (D-1)
#
# Day-count boundaries below were derived against the fixed 365.25 divisor:
#   365.25 * 0.5  = 182.625  -> 182d = 0.4983 (->0),  183d = 0.5010 (->1)
#   365.25 * 2.5  = 913.125  -> 913d = 2.4997 (->2),  914d = 2.5024 (->3)
#   365.25 * 10   = 3652.5   -> 3653d = 10.0014 (->10)

_YSTART = date(2000, 1, 1)


def _years_for_days(n: int) -> int | None:
    """compute_bond_years for a span of exactly ``n`` days (n may be negative)."""
    return compute_bond_years(_YSTART, _YSTART + timedelta(days=n))


@pytest.mark.parametrize(
    "start, expired, expected",
    [
        pytest.param(None, date(2030, 1, 1), None, id="start-missing"),
        pytest.param(date(2020, 1, 1), None, None, id="expired-missing"),
        pytest.param(None, None, None, id="both-missing"),
    ],
)
def test_compute_bond_years_missing_date_returns_none(start, expired, expected):
    assert compute_bond_years(start, expired) == expected


@pytest.mark.parametrize(
    "days, expected",
    [
        # Zero span.
        pytest.param(0, 0, id="same-day-zero"),
        # Near-0.5 boundary pair.
        pytest.param(182, 0, id="182d-rounds-down-to-0"),
        pytest.param(183, 1, id="183d-rounds-up-to-1"),
        # Around one year.
        pytest.param(365, 1, id="365d-is-1"),
        pytest.param(366, 1, id="366d-is-1"),
        # Ten years.
        pytest.param(3653, 10, id="3653d-is-10"),
        # Half-up away from zero: raw 2.4997 -> 2, raw 2.5024 -> 3.
        pytest.param(913, 2, id="913d-raw-just-under-2.5-rounds-to-2"),
        pytest.param(914, 3, id="914d-raw-just-over-2.5-rounds-to-3"),
    ],
)
def test_compute_bond_years_positive_spans(days, expected):
    assert _years_for_days(days) == expected


@pytest.mark.parametrize(
    "start, expired, days, expected",
    [
        # 4-year span that crosses Feb 29 2020: 365 + 366 + 365 + 365 = 1461 days.
        # 1461 / 365.25 = 4.0 exactly -> 4.
        pytest.param(
            date(2019, 1, 1), date(2023, 1, 1), 1461, 4, id="4y-span-crosses-one-feb-29"
        ),
        # 6-year span crossing Feb 29 2020 AND Feb 29 2024:
        # 365+366+365+365+365+366 = 2192 days. 2192 / 365.25 = 6.0014 -> 6.
        pytest.param(
            date(2019, 1, 1), date(2025, 1, 1), 2192, 6, id="6y-span-crosses-two-feb-29"
        ),
        # Exactly 3 calendar years, span includes Feb 29 2020: 365+366+365 = 1096 days.
        # D-2 posture: the divisor is the FIXED nominal 365.25 — the actual leap-day
        # composition of the span is deliberately ignored. 1096 / 365.25 = 3.0006...
        # which ROUND_HALF_UP-quantizes to 3. A calendar-exact divisor could land on
        # a different raw value; this asserts the nominal-divisor result is the one
        # that is quantized.
        pytest.param(
            date(2019, 1, 1), date(2022, 1, 1), 1096, 3, id="3cal-year-leap-span-nominal-divisor"
        ),
    ],
)
def test_compute_bond_years_leap_year_spans_use_nominal_divisor(start, expired, days, expected):
    assert (expired - start).days == days  # guard: the span really is `days` long
    assert compute_bond_years(start, expired) == expected


@pytest.mark.parametrize(
    "days, expected",
    [
        # Negative span (D-1): the negative day-count flows through the
        # division + ROUND_HALF_UP unchanged. Mirror of the positive boundary:
        # -183d = -0.5010 -> -1 (ties-away-from-zero on the -0.5 crossing),
        # -182d = -0.4983 -> 0.
        pytest.param(-183, -1, id="-183d-is-minus-1"),
        pytest.param(-182, 0, id="-182d-is-0"),
        # A large negative span resolves to the expected negative int.
        pytest.param(-3653, -10, id="-3653d-is-minus-10"),
    ],
)
def test_compute_bond_years_negative_spans_pass_through(days, expected):
    assert _years_for_days(days) == expected


def test_compute_bond_years_negative_span_does_not_raise():
    # Explicit: an inverted window must never raise — it returns a negative int.
    result = compute_bond_years(date(2025, 1, 1), date(2015, 1, 1))
    assert result == -10


def test_compute_bond_years_is_deterministic():
    """No clock dependency — repeated calls with identical inputs are identical."""
    a = compute_bond_years(date(2020, 1, 1), date(2025, 1, 1))
    b = compute_bond_years(date(2020, 1, 1), date(2025, 1, 1))
    assert a == b == 5


def test_bangkok_today_returns_a_date():
    """`bangkok_today()` must return a plain `date` and never raise, even on
    a host without the system IANA tz database (fixed-offset fallback)."""
    result = bangkok_today()
    assert isinstance(result, date)


def test_bangkok_today_is_stable_within_a_call_window():
    # Two reads milliseconds apart are the same calendar day except across a
    # midnight tick — assert only that both are dates and non-decreasing.
    a = bangkok_today()
    b = bangkok_today()
    assert a <= b
