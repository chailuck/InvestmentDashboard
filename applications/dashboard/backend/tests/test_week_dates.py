"""Unit tests for app.services.week_dates.display_week_range().

Ground truth
------------
A weekly scan created Saturday 2026-07-11 (Bangkok local) produced the
report header "Week 29, 13 Jul-19 Jul 2026" in
D:\\Documents\\Pop\\Knowledge\\Vault-Investment\\Investment\\raw\\Weeklyplan\\
OVERALL PLAN 20260712.md — i.e. Monday 2026-07-13, Sunday 2026-07-19, ISO
week 29. This is the load-bearing regression case: it pins the exact
day-of-week arithmetic against a real, previously-generated report.
"""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

from app.services.week_dates import BANGKOK, display_week_range

UTC = ZoneInfo("UTC")


def test_saturday_creation_matches_ground_truth_report():
    """TC-WD-01: Scan created Saturday 2026-07-11 → Mon 2026-07-13 / Sun 2026-07-19 / week 29.

    Regression pin against the real exported file OVERALL PLAN 20260712.md,
    whose header reads "Week 29, 13 Jul-19 Jul 2026".
    """
    created_at = datetime(2026, 7, 11, 10, 0, 0, tzinfo=BANGKOK)
    monday, sunday, week_no = display_week_range(created_at)
    assert monday == date(2026, 7, 13)
    assert sunday == date(2026, 7, 19)
    assert week_no == 29


def test_monday_creation_rolls_forward_a_full_week():
    """TC-WD-02: Scan created ON a Monday still rolls forward to the NEXT
    Monday (a full 7 days later), never returning the same-day Monday.

    This is a known quirk inherited from the existing frontend
    buildOverallMd()/exportMarkdown() implementations and must not be
    "fixed" here — the date_to_monday formula's `or 7` fallback only
    triggers when the naive `(7 - weekday())` computation would be 0,
    which happens precisely when local.weekday() == 0 (Monday).
    """
    created_at = datetime(2026, 7, 13, 9, 0, 0, tzinfo=BANGKOK)  # 2026-07-13 is a Monday
    monday, sunday, week_no = display_week_range(created_at)
    assert monday == date(2026, 7, 20)
    assert sunday == date(2026, 7, 26)
    assert week_no == 30


def test_sunday_creation_rolls_to_the_immediately_following_monday():
    """TC-WD-03: Scan created on a Sunday rolls forward to the very next day
    (Monday), the smallest possible "strictly after" roll-forward."""
    created_at = datetime(2026, 7, 12, 9, 0, 0, tzinfo=BANGKOK)  # 2026-07-12 is a Sunday
    monday, sunday, week_no = display_week_range(created_at)
    assert monday == date(2026, 7, 13)
    assert sunday == date(2026, 7, 19)
    assert week_no == 29


def test_utc_datetime_is_converted_to_bangkok_local_date_before_computing_weekday():
    """TC-WD-04: A UTC timestamp that crosses midnight once shifted to
    Bangkok (+7h) must use the Bangkok calendar date, not the UTC one — the
    function must convert with astimezone() before computing weekday().

    2026-07-11 18:00 UTC == 2026-07-12 01:00 Bangkok, i.e. a Sunday
    local, not the Saturday it would be in UTC.
    """
    created_at_utc = datetime(2026, 7, 11, 18, 0, 0, tzinfo=UTC)
    monday, sunday, week_no = display_week_range(created_at_utc)
    # Local Bangkok date is Sunday 2026-07-12 → rolls to Monday 2026-07-13.
    assert monday == date(2026, 7, 13)
    assert sunday == date(2026, 7, 19)
    assert week_no == 29


def test_returns_a_tuple_of_date_date_int():
    created_at = datetime(2026, 1, 1, 12, 0, 0, tzinfo=BANGKOK)
    result = display_week_range(created_at)
    assert isinstance(result, tuple)
    assert len(result) == 3
    monday, sunday, week_no = result
    assert isinstance(monday, date)
    assert isinstance(sunday, date)
    assert isinstance(week_no, int)


def test_sunday_is_always_six_days_after_monday():
    created_at = datetime(2026, 3, 4, 8, 0, 0, tzinfo=BANGKOK)  # Wednesday
    monday, sunday, _ = display_week_range(created_at)
    assert (sunday - monday).days == 6
    assert monday.weekday() == 0  # Monday
    assert sunday.weekday() == 6  # Sunday
