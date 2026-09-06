"""Read-time bond status derivation for the BOND register.

`status` is NEVER stored on ``ft_bond`` — it is a pure function of the bond's
``start_date`` / ``expired_date`` and the current date, recomputed on every
read. The endpoints call :func:`compute_bond_status` with a single
``today`` captured once per request (via :func:`bangkok_today`) so every bond
in a list response is evaluated against the same reference date.

Status vocabulary (verbatim — do not re-spell):
  - ``"Pre-order"`` — today is before ``start_date``
  - ``"Active"``    — today is within [start_date, expired_date], inclusive
  - ``"Expire"``    — today is after ``expired_date``
  - ``"Unknown"``   — either date is missing

Both boundaries are inclusive: ``today == start_date`` and
``today == expired_date`` are both ``"Active"``.

Inverted-date determinism: if a caller somehow persists
``start_date > expired_date``, the checks are applied in order — the
``today < start`` test wins first, so such a bond reads ``"Pre-order"`` until
``today >= start`` and ``"Expire"`` once ``today > expired`` (which, given the
inversion, is already true). The function never raises for inverted dates;
this ordering is the documented, deterministic behaviour.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

BondStatus = Literal["Pre-order", "Active", "Expire", "Unknown"]

# Asia/Bangkok is UTC+07:00 year-round (no DST since 1940). This fixed-offset
# tz is only the FALLBACK used when the IANA tz database is unavailable on the
# host (e.g. a Windows dev box without the `tzdata` package); production Linux
# images resolve ``ZoneInfo("Asia/Bangkok")`` from the system zoneinfo.
_BANGKOK_FALLBACK = timezone(timedelta(hours=7), name="Asia/Bangkok")


def _bangkok_tz() -> timezone:
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo("Asia/Bangkok")  # type: ignore[return-value]
    except Exception:  # pragma: no cover - host without tzdata
        return _BANGKOK_FALLBACK


def bangkok_today() -> date:
    """Today's calendar date in Asia/Bangkok — the reference 'now' for status.

    Bangkok is used (not the server's local tz or UTC) so a bond that starts
    or expires 'today' flips status at Bangkok midnight, matching how the
    Financial Tracker's users think about their holdings.
    """
    return datetime.now(_bangkok_tz()).date()


def compute_bond_status(
    start: date | None, expired: date | None, today: date
) -> BondStatus:
    """Derive a bond's status. See module docstring for the full contract."""
    if start is None or expired is None:
        return "Unknown"
    if today < start:
        return "Pre-order"
    if today > expired:
        return "Expire"
    return "Active"


_YEARS_DIVISOR = Decimal("365.25")


def compute_bond_years(start: date | None, expired: date | None) -> int | None:
    """Whole-year term span of a bond, rounded half-up (ties away from zero).

    Pure function of the two term dates — no `today`, unlike compute_bond_status.
    Returns None if either date is missing (mirrors status == "Unknown").
    Negative span (expired < start): the negative day-count passes through the
    division and rounding UNCHANGED — no clamp, no raise. Deterministic, and
    consistent with compute_bond_status's inverted-date posture (D-1).
    Divisor is the fixed nominal year length 365.25; it ignores the actual
    leap-day composition of the span (accepted simplification, D-2).
    Uses decimal.ROUND_HALF_UP — Python's built-in round() (banker's rounding)
    must NOT be used here.
    """
    if start is None or expired is None:
        return None
    days = Decimal((expired - start).days)
    return int((days / _YEARS_DIVISOR).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
