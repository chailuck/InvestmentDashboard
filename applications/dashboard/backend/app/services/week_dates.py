"""Trading-week date helpers shared by the Overall Plan report generator.

Kept intentionally tiny and dependency-free (stdlib only) so it can be unit
tested in isolation from any DB/HTTP concerns.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

BANGKOK = ZoneInfo("Asia/Bangkok")


def display_week_range(created_at: datetime) -> tuple[date, date, int]:
    """Monday/Sunday/ISO-week-number of the trading week a scan covers,
    derived from when the scan was created (Bangkok local date). Always
    rolls forward to the next Monday strictly AFTER the creation date,
    even if creation falls on a Monday (matches existing frontend behaviour
    in buildOverallMd()/exportMarkdown() — do not "fix" this quirk).
    """
    local = created_at.astimezone(BANGKOK).date()
    days_to_monday = (7 - local.weekday()) or 7  # date.weekday(): Mon=0..Sun=6
    monday = local + timedelta(days=days_to_monday)
    sunday = monday + timedelta(days=6)
    return monday, sunday, monday.isocalendar()[1]
