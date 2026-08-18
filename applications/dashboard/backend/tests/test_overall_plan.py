"""Integration tests for POST /api/v1/overall-plan/generate.

Endpoint covered
----------------
POST /api/v1/overall-plan/generate — aggregates a purchase action plan,
active portfolio-DB positions (default portfolio), a weekly scan, and the
last-2-weeks Objective review into a single markdown file written to disk.

Test isolation
--------------
* VAULT_WEEKLYPLAN_DIR is monkeypatched to pytest's tmp_path for every test
  in this module — the real host-mounted vault directory is never touched.
* yfinance.Ticker is patched so list_positions_db()'s live price lookup for
  active positions never makes a network call.
* The "no default portfolio" test uses a brand-new, randomly-emailed user
  (via the shared _get_or_create_user helper from conftest) rather than the
  session-shared `auth_client` user, because other tests in this session may
  have already given that user a default portfolio.
"""

from __future__ import annotations

import calendar
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy import select
from sqlalchemy import update as sa_update

import app.api.v1.endpoints.overall_plan as overall_plan_module
from app.auth.jwt import create_access_token
from app.database.session import get_db
from app.models.daily_performance import DailyPerformance
from app.models.portfolio import Portfolio
from app.models.portfolio_db import PortfolioDbPosition
from app.models.user import User
from app.models.weekly_scan import WeeklyScan, WeeklyScanItem
from main import fastapi_app
from tests.conftest import _get_or_create_user, _make_db_override

# Must match conftest.py's default emails for auth_client / auth_client_b.
AUTH_CLIENT_EMAIL = "test@example.com"
AUTH_CLIENT_B_EMAIL = "user_b@example.com"


# ── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def _vault_dir_in_tmp(tmp_path, monkeypatch):
    """Redirect the module's file-write target to a pytest tmp_path so tests
    never touch the real host-mounted vault directory."""
    monkeypatch.setattr(overall_plan_module, "VAULT_WEEKLYPLAN_DIR", tmp_path)
    return tmp_path


@pytest.fixture(autouse=True)
def _mock_yfinance():
    """list_positions_db() fetches a live price per active symbol via
    yfinance; patch it so tests never hit the network."""
    mock_ticker = MagicMock()
    mock_ticker.history.return_value = pd.DataFrame({"Close": pd.Series([100.0, 105.0])})
    with patch("yfinance.Ticker", return_value=mock_ticker):
        yield


@pytest_asyncio.fixture
async def fresh_user_client(engine) -> AsyncClient:
    """A client for a brand-new, never-before-seen user — guaranteed to have
    zero portfolios. Needed for the 422 'no default portfolio' test, since
    the shared `auth_client` user may already have a default portfolio from
    other tests in this session-scoped test database."""
    email = f"overall-plan-{uuid.uuid4().hex[:12]}@example.com"
    user = await _get_or_create_user(engine, email=email, name="Fresh Overall-Plan User", password="FreshPass123!")
    token, _ = create_access_token(str(user.id), extra={"role": user.role, "email": user.email})
    fastapi_app.dependency_overrides[get_db] = _make_db_override(engine)
    async with AsyncClient(
        transport=ASGITransport(app=fastapi_app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {token}"},
    ) as c:
        c.test_user_id = user.id  # stashed for tests — no GET /users/me endpoint exists
        yield c
    fastapi_app.dependency_overrides.clear()


# ── Helpers ──────────────────────────────────────────────────────────────────

async def _create_purchase_plan(client: AsyncClient, *, name: str | None = None) -> dict:
    if name is None:
        name = f"Purchase {uuid.uuid4().hex[:8]}"
    resp = await client.post("/api/v1/action-plans", json={"name": name, "plan_type": "purchase"})
    assert resp.status_code == 201, resp.text
    plan = resp.json()
    put_resp = await client.put(
        f"/api/v1/action-plans/{plan['id']}",
        json={
            "purchase_items": [
                {"sort_order": 0, "stock": "PTT", "strategy": "BREAK OUT",
                 "buy_price": 35.0, "tp": 40.0, "sl": 33.0, "size": 1000,
                 "current_price": 34.5, "triggered": False, "reason": ""},
            ],
        },
    )
    assert put_resp.status_code == 200, put_resp.text
    return plan


async def _create_portfolio_plan(client: AsyncClient, *, name: str | None = None) -> dict:
    if name is None:
        name = f"Portfolio Plan {uuid.uuid4().hex[:8]}"
    resp = await client.post("/api/v1/action-plans", json={"name": name, "plan_type": "portfolio"})
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _ensure_default_portfolio(
    db: AsyncSession, user_id: uuid.UUID, *, name: str | None = None,
) -> Portfolio:
    """Insert a Portfolio row directly and mark it the user's default.

    Deliberately bypasses POST /api/v1/portfolios: that endpoint's
    create_portfolio() has a pre-existing bug where
    `count_result.scalar_one_or_none()` raises MultipleResultsFound once a
    user already has 2+ portfolios (it's only meant to check "does at least
    one exist"). The shared, session-scoped `auth_client` user easily
    accumulates that many portfolios across this file's own tests, let
    alone the rest of the suite. That bug is out of scope for this feature
    (untouched pre-existing endpoint) — inserting directly sidesteps it
    while still exercising the real overall_plan code path under test,
    which only reads via get_default_portfolio().
    """
    if name is None:
        name = f"Portfolio {uuid.uuid4().hex[:8]}"
    await db.execute(sa_update(Portfolio).where(Portfolio.user_id == user_id).values(is_default=False))
    portfolio = Portfolio(user_id=user_id, name=name, is_default=True, portfolio_mode="db")
    db.add(portfolio)
    await db.commit()
    await db.refresh(portfolio)
    return portfolio


async def _create_active_position(
    db: AsyncSession, user_id: uuid.UUID, portfolio_id: uuid.UUID, *, symbol: str = "AOT",
) -> PortfolioDbPosition:
    pos = PortfolioDbPosition(
        user_id=user_id,
        portfolio_id=portfolio_id,
        symbol=symbol,
        direction="LONG",
        entry_date=date.today() - timedelta(days=5),
        entry_price=50.0,
        position_size=100,
        tp=60.0,
        sl=45.0,
        status="active",
    )
    db.add(pos)
    await db.commit()
    await db.refresh(pos)
    return pos


async def _create_weekly_scan(
    db: AsyncSession, user_id: uuid.UUID, *, name: str | None = None,
    created_at: datetime | None = None,
) -> WeeklyScan:
    if name is None:
        name = f"WEEKLY_SCAN_{uuid.uuid4().hex[:8]}"
    scan = WeeklyScan(user_id=user_id, name=name)
    if created_at is not None:
        scan.created_at = created_at
    db.add(scan)
    await db.flush()
    db.add(WeeklyScanItem(
        scan_id=scan.id, symbol="OSP", sort_order=0, list_name="SET100",
        market="SET", color_mark="CYAN", strategy="BREAK OUT",
        buy_price=17.90, tp=20.00, sl=16.90, size=1200,
    ))
    await db.commit()
    await db.refresh(scan)
    return scan


async def _create_daily_performance(
    db: AsyncSession, user_id: uuid.UUID, portfolio_id: uuid.UUID, *,
    snapshot_date: date | None = None, symbol: str = "AOT",
) -> DailyPerformance:
    """Insert a DailyPerformance snapshot row directly, matching the same
    direct-ORM-insert pattern used by _ensure_default_portfolio /
    _create_active_position / _create_weekly_scan in this file."""
    if snapshot_date is None:
        snapshot_date = date.today()
    rec = DailyPerformance(
        user_id=user_id,
        portfolio_id=portfolio_id,
        date=snapshot_date,
        investment=100000.0,
        closed_pnl=0.0,
        closed_pnl_pct=0.0,
        open_pnl=1500.0,
        open_pnl_pct=1.5,
        open_positions=[
            {"symbol": symbol, "size": 100, "buy_price": 50.0, "close_price": 65.0,
             "pnl": 1500.0, "pnl_pct": 30.0, "entry_date": (snapshot_date - timedelta(days=5)).isoformat()},
        ],
        purchased_positions=None,
        sold_positions=None,
        acc_pnl=1500.0,
    )
    db.add(rec)
    await db.commit()
    await db.refresh(rec)
    return rec


async def _get_user_id_by_email(db: AsyncSession, email: str) -> uuid.UUID:
    """Look up a user's id directly via the DB.

    There is no GET /api/v1/users/me endpoint in this codebase — the only
    self-lookup route is GET /users/{user_id}, which requires already
    knowing your own id — so tests that need the id behind `auth_client` /
    `auth_client_b` (whose emails are fixed in conftest.py) resolve it
    directly instead.
    """
    result = await db.execute(select(User.id).where(User.email == email))
    uid = result.scalar_one_or_none()
    assert uid is not None, f"User {email} not found in test DB"
    return uid


# ── Happy path ───────────────────────────────────────────────────────────────

async def test_generate_overall_plan_returns_200_and_expected_fields(
    auth_client: AsyncClient, db_session: AsyncSession, tmp_path,
):
    """TC-OP-01: Full happy path — 200 with all documented response fields,
    and a file actually written under the (monkeypatched) vault directory."""
    uid = await _get_user_id_by_email(db_session, AUTH_CLIENT_EMAIL)
    plan = await _create_purchase_plan(auth_client)
    portfolio = await _ensure_default_portfolio(db_session, uid)
    await _create_active_position(db_session, uid, portfolio.id)
    scan = await _create_weekly_scan(db_session, uid)
    await _create_daily_performance(db_session, uid, portfolio.id, symbol="XYZ")

    resp = await auth_client.post(
        "/api/v1/overall-plan/generate",
        json={"action_plan_id": plan["id"], "weekly_scan_id": str(scan.id)},
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    for field in (
        "filename", "path", "written_at", "action_plan_id", "action_plan_name",
        "weekly_scan_id", "weekly_scan_name", "portfolio_id", "portfolio_name",
    ):
        assert field in body, f"Missing field: {field}"

    assert body["filename"].startswith("OVERALL PLAN ")
    assert body["filename"].endswith(".md")
    assert body["action_plan_id"] == plan["id"]
    assert body["action_plan_name"] == plan["name"]
    assert body["weekly_scan_id"] == str(scan.id)
    assert body["weekly_scan_name"] == scan.name
    assert body["portfolio_id"] == str(portfolio.id)
    assert body["portfolio_name"] == portfolio.name

    # File actually exists under the monkeypatched vault dir with matching content
    written_files = list(tmp_path.glob("OVERALL PLAN *.md"))
    assert len(written_files) == 1
    content = written_files[0].read_text(encoding="utf-8")
    assert f"# OVERALL PLAN {body['filename'].removeprefix('OVERALL PLAN ').removesuffix('.md')}" in content
    assert plan["name"] in content
    assert "AOT" in content
    assert scan.name in content
    # Section 5 (Daily Performance) is present and includes the seeded snapshot
    assert "## 5. Daily Performance" in content
    assert "XYZ" in content


def _fmt_date_like_markdown_module(d: date) -> str:
    """Reproduce overall_plan_markdown._fmt_date()'s output (day not
    zero-padded, 3-letter month, 4-digit year) without importing a private
    function across modules — e.g. date(2026, 8, 1) -> '1 Aug 2026'."""
    return f"{d.day} {calendar.month_abbr[d.month]} {d.year}"


async def test_generate_overall_plan_daily_performance_keeps_last_10_of_12_in_chronological_order(
    auth_client: AsyncClient, db_session: AsyncSession, tmp_path,
):
    """TC-OP-13: Seeds 12 DailyPerformance rows with 12 distinct ascending
    dates (more than the endpoint's `[-10:]` slice keeps). Verifies, through
    the real endpoint code path (list_daily_performance -> `[-10:]` ->
    _section_daily_performance), that Section 5's day-level summary table
    ends up with exactly the 10 most recent dates, the 2 oldest seeded dates
    are absent, and the surviving 10 appear in ascending chronological order.

    This is the QA-flagged P2 gap: no prior test constructed >=10 daily
    performance records, so the "10 most recent, chronological order"
    contract of Section 5 / the endpoint's [-10:] slice was previously
    unverified.
    """
    uid = await _get_user_id_by_email(db_session, AUTH_CLIENT_EMAIL)
    plan = await _create_purchase_plan(auth_client)
    portfolio = await _ensure_default_portfolio(db_session, uid)
    scan = await _create_weekly_scan(db_session, uid)

    # 12 distinct ascending dates ending today: today-11 (oldest) .. today (newest).
    all_dates = [date.today() - timedelta(days=(11 - i)) for i in range(12)]
    for i, d in enumerate(all_dates):
        await _create_daily_performance(db_session, uid, portfolio.id, snapshot_date=d, symbol=f"SYM{i}")

    dropped_dates = all_dates[:2]  # the 2 oldest — must NOT survive the [-10:] slice
    kept_dates = all_dates[2:]  # the 10 most recent — must survive, in ascending order

    resp = await auth_client.post(
        "/api/v1/overall-plan/generate",
        json={"action_plan_id": plan["id"], "weekly_scan_id": str(scan.id)},
    )
    assert resp.status_code == 200, resp.text

    written_files = list(tmp_path.glob("OVERALL PLAN *.md"))
    assert len(written_files) == 1
    content = written_files[0].read_text(encoding="utf-8")

    section5 = content[content.index("## 5. Daily Performance"):]
    # Restrict to the day-level *summary* table (before any per-day "### "
    # sub-tables), which is the table whose row count/order is under test.
    summary_table = section5.split("\n### ", 1)[0]

    # (a) Exactly 10 date rows in the summary table — not 12, not fewer.
    date_row_pattern = re.compile(r"^\| \d{1,2} \w{3} \d{4} \|", re.MULTILINE)
    matched_rows = date_row_pattern.findall(summary_table)
    assert len(matched_rows) == 10, (
        f"Expected exactly 10 date rows in the summary table, found {len(matched_rows)}:\n{summary_table}"
    )

    # (b) The 2 oldest seeded dates are absent.
    for d in dropped_dates:
        date_str = _fmt_date_like_markdown_module(d)
        assert f"| {date_str} |" not in summary_table, (
            f"Oldest date {date_str} should have been dropped by the [-10:] slice but is present"
        )

    # (b continued) The 10 most recent dates are all present...
    # (c) ...and appear in ascending chronological order.
    found_indices = []
    for d in kept_dates:
        date_str = _fmt_date_like_markdown_module(d)
        idx = summary_table.index(f"| {date_str} |")
        found_indices.append(idx)
    assert found_indices == sorted(found_indices), "Kept dates are not in ascending chronological order"


async def test_generate_overall_plan_written_at_has_bangkok_offset(
    auth_client: AsyncClient, db_session: AsyncSession,
):
    """TC-OP-02: written_at is an ISO8601 timestamp with a +07:00 offset."""
    uid = await _get_user_id_by_email(db_session, AUTH_CLIENT_EMAIL)
    plan = await _create_purchase_plan(auth_client)
    await _ensure_default_portfolio(db_session, uid)
    scan = await _create_weekly_scan(db_session, uid)

    resp = await auth_client.post(
        "/api/v1/overall-plan/generate",
        json={"action_plan_id": plan["id"], "weekly_scan_id": str(scan.id)},
    )
    assert resp.status_code == 200
    written_at = resp.json()["written_at"]
    parsed = datetime.fromisoformat(written_at)
    assert parsed.utcoffset() == timedelta(hours=7)


async def test_generate_overall_plan_overwrites_not_duplicates_same_day(
    auth_client: AsyncClient, db_session: AsyncSession, tmp_path,
):
    """TC-OP-03: Calling the endpoint twice on the same (server) day
    overwrites the existing file rather than creating a second one."""
    uid = await _get_user_id_by_email(db_session, AUTH_CLIENT_EMAIL)
    plan = await _create_purchase_plan(auth_client)
    await _ensure_default_portfolio(db_session, uid)
    scan = await _create_weekly_scan(db_session, uid)

    payload = {"action_plan_id": plan["id"], "weekly_scan_id": str(scan.id)}
    resp1 = await auth_client.post("/api/v1/overall-plan/generate", json=payload)
    resp2 = await auth_client.post("/api/v1/overall-plan/generate", json=payload)

    assert resp1.status_code == 200
    assert resp2.status_code == 200
    assert resp1.json()["filename"] == resp2.json()["filename"]

    written_files = list(tmp_path.glob("OVERALL PLAN *.md"))
    assert len(written_files) == 1
    # No leftover temp files from the atomic write
    tmp_files = list(tmp_path.glob("*.tmp-*"))
    assert tmp_files == []


# ── 404: purchase plan ───────────────────────────────────────────────────────

async def test_generate_overall_plan_unknown_action_plan_returns_404(
    auth_client: AsyncClient, db_session: AsyncSession,
):
    """TC-OP-04: Nonexistent action_plan_id → 404 'Purchase plan not found'."""
    uid = await _get_user_id_by_email(db_session, AUTH_CLIENT_EMAIL)
    scan = await _create_weekly_scan(db_session, uid)

    resp = await auth_client.post(
        "/api/v1/overall-plan/generate",
        json={"action_plan_id": str(uuid.uuid4()), "weekly_scan_id": str(scan.id)},
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Purchase plan not found"


async def test_generate_overall_plan_wrong_plan_type_returns_404(
    auth_client: AsyncClient, db_session: AsyncSession,
):
    """TC-OP-05: action_plan_id referencing a plan_type='portfolio' plan →
    404 (only purchase plans are valid for section 1)."""
    uid = await _get_user_id_by_email(db_session, AUTH_CLIENT_EMAIL)
    wrong_type_plan = await _create_portfolio_plan(auth_client)
    scan = await _create_weekly_scan(db_session, uid)

    resp = await auth_client.post(
        "/api/v1/overall-plan/generate",
        json={"action_plan_id": wrong_type_plan["id"], "weekly_scan_id": str(scan.id)},
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Purchase plan not found"


async def test_generate_overall_plan_foreign_action_plan_returns_404(
    auth_client: AsyncClient, auth_client_b: AsyncClient, db_session: AsyncSession,
):
    """TC-OP-06: action_plan_id owned by a different user → 404 (ownership
    isolation), not leaked as e.g. a 403."""
    uid = await _get_user_id_by_email(db_session, AUTH_CLIENT_EMAIL)
    foreign_plan = await _create_purchase_plan(auth_client_b)
    scan = await _create_weekly_scan(db_session, uid)

    resp = await auth_client.post(
        "/api/v1/overall-plan/generate",
        json={"action_plan_id": foreign_plan["id"], "weekly_scan_id": str(scan.id)},
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Purchase plan not found"


# ── 404: weekly scan ─────────────────────────────────────────────────────────

async def test_generate_overall_plan_unknown_weekly_scan_returns_404(auth_client: AsyncClient):
    """TC-OP-07: Nonexistent weekly_scan_id → 404 'Weekly scan not found'."""
    plan = await _create_purchase_plan(auth_client)

    resp = await auth_client.post(
        "/api/v1/overall-plan/generate",
        json={"action_plan_id": plan["id"], "weekly_scan_id": str(uuid.uuid4())},
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Weekly scan not found"


async def test_generate_overall_plan_foreign_weekly_scan_returns_404(
    auth_client: AsyncClient, auth_client_b: AsyncClient, db_session: AsyncSession,
):
    """TC-OP-08: weekly_scan_id owned by a different user → 404."""
    uid_b = await _get_user_id_by_email(db_session, AUTH_CLIENT_B_EMAIL)
    plan = await _create_purchase_plan(auth_client)
    foreign_scan = await _create_weekly_scan(db_session, uid_b)

    resp = await auth_client.post(
        "/api/v1/overall-plan/generate",
        json={"action_plan_id": plan["id"], "weekly_scan_id": str(foreign_scan.id)},
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Weekly scan not found"


# ── 422: no default portfolio ────────────────────────────────────────────────

async def test_generate_overall_plan_no_default_portfolio_returns_422(
    fresh_user_client: AsyncClient, db_session: AsyncSession,
):
    """TC-OP-09: A user with zero portfolios gets 422 with the documented
    message, checked only after the plan/scan existence checks pass."""
    uid = fresh_user_client.test_user_id
    plan = await _create_purchase_plan(fresh_user_client)
    scan = await _create_weekly_scan(db_session, uid)

    resp = await fresh_user_client.post(
        "/api/v1/overall-plan/generate",
        json={"action_plan_id": plan["id"], "weekly_scan_id": str(scan.id)},
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == (
        "No default portfolio configured. Create a portfolio before generating an overall plan."
    )


# ── 500: filesystem failure (path leakage check) ────────────────────────────

async def test_generate_overall_plan_write_failure_returns_500_without_leaking_path(
    auth_client: AsyncClient, db_session: AsyncSession, tmp_path, monkeypatch,
):
    """TC-OP-10: A filesystem write failure returns a generic 500 message —
    the real filesystem path must never appear in the client-facing response."""
    uid = await _get_user_id_by_email(db_session, AUTH_CLIENT_EMAIL)
    plan = await _create_purchase_plan(auth_client)
    await _ensure_default_portfolio(db_session, uid)
    scan = await _create_weekly_scan(db_session, uid)

    with patch("pathlib.Path.write_text", side_effect=OSError("disk full")):
        resp = await auth_client.post(
            "/api/v1/overall-plan/generate",
            json={"action_plan_id": plan["id"], "weekly_scan_id": str(scan.id)},
        )

    assert resp.status_code == 500
    detail = resp.json()["detail"]
    assert detail == "Failed to write overall plan file"
    assert str(tmp_path) not in detail
    assert "vault_investment_raw" not in detail


# ── Auth ─────────────────────────────────────────────────────────────────────

async def test_generate_overall_plan_requires_auth(client: AsyncClient):
    """TC-OP-11: Unauthenticated request returns 401."""
    resp = await client.post(
        "/api/v1/overall-plan/generate",
        json={"action_plan_id": str(uuid.uuid4()), "weekly_scan_id": str(uuid.uuid4())},
    )
    assert resp.status_code == 401


async def test_generate_overall_plan_malformed_uuid_returns_422(auth_client: AsyncClient):
    """TC-OP-12: Non-UUID identifiers in the request body are rejected by
    Pydantic validation with 422, before any DB lookup happens."""
    resp = await auth_client.post(
        "/api/v1/overall-plan/generate",
        json={"action_plan_id": "not-a-uuid", "weekly_scan_id": "also-not-a-uuid"},
    )
    assert resp.status_code == 422
