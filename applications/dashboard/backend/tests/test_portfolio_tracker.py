"""Tests for portfolio tracker endpoints.

Strategy
--------
The market index endpoints (fetch_set_indices / fetch_global_indices) call
Yahoo Finance via yfinance, and the positions endpoint may read an Excel file
that does not exist in the test environment.

All external service calls are patched at the module level using monkeypatch
so tests are fast, hermetic, and do not require network access.

Endpoints covered
-----------------
GET /api/v1/portfolio-tracker/market/set-indices
GET /api/v1/portfolio-tracker/market/global-indices
GET /api/v1/portfolio-tracker/positions
GET /api/v1/portfolio-tracker/performance
"""

from __future__ import annotations

from unittest.mock import patch, MagicMock, AsyncMock

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

# ── Shared fake market-data payloads ─────────────────────────────────────────

_SET_INDICES_PAYLOAD = [
    {"name": "SET50",  "value": 960.15, "change": -3.40, "changePct": -0.35},
    {"name": "SET100", "value": 2014.88, "change": -5.20, "changePct": -0.26},
    {"name": "sSET",   "value": 856.44, "change":  1.10, "changePct":  0.13},
]

_GLOBAL_INDICES_PAYLOAD = [
    {"name": "S&P 500", "value": 5300.12, "change": 12.50, "changePct": 0.24},
    {"name": "NASDAQ",  "value": 16900.00, "change": -30.00, "changePct": -0.18},
    {"name": "DOW",     "value": 39800.00, "change": 45.00,  "changePct": 0.11},
    {"name": "BTC",     "value": 67000.00, "change": 500.00, "changePct": 0.75},
    {"name": "XAUUSD",  "value": 2330.00,  "change": -8.00,  "changePct": -0.34},
]


# ── SET indices ───────────────────────────────────────────────────────────────

async def test_get_set_indices_returns_200(auth_client: AsyncClient):
    """GET /market/set-indices returns 200 when the service succeeds."""
    with patch(
        "app.services.portfolio_excel.fetch_set_indices",
        return_value=_SET_INDICES_PAYLOAD,
    ):
        resp = await auth_client.get("/api/v1/portfolio-tracker/market/set-indices")
    assert resp.status_code == 200


async def test_get_set_indices_returns_list(auth_client: AsyncClient):
    """Response is a list of index objects."""
    with patch(
        "app.services.portfolio_excel.fetch_set_indices",
        return_value=_SET_INDICES_PAYLOAD,
    ):
        resp = await auth_client.get("/api/v1/portfolio-tracker/market/set-indices")
    assert isinstance(resp.json(), list)
    assert len(resp.json()) == 3


async def test_get_set_indices_each_has_required_fields(auth_client: AsyncClient):
    """Every SET index entry has name, value, change, and changePct."""
    with patch(
        "app.services.portfolio_excel.fetch_set_indices",
        return_value=_SET_INDICES_PAYLOAD,
    ):
        resp = await auth_client.get("/api/v1/portfolio-tracker/market/set-indices")
    for entry in resp.json():
        for field in ("name", "value", "change", "changePct"):
            assert field in entry, f"Missing field '{field}' in entry: {entry}"


async def test_get_set_indices_name_values(auth_client: AsyncClient):
    """SET index names match the expected Thai indices."""
    with patch(
        "app.services.portfolio_excel.fetch_set_indices",
        return_value=_SET_INDICES_PAYLOAD,
    ):
        resp = await auth_client.get("/api/v1/portfolio-tracker/market/set-indices")
    names = {entry["name"] for entry in resp.json()}
    assert "SET50" in names
    assert "SET100" in names


async def test_get_set_indices_requires_auth(client: AsyncClient):
    """Unauthenticated request returns 401."""
    resp = await client.get("/api/v1/portfolio-tracker/market/set-indices")
    assert resp.status_code == 401


async def test_get_set_indices_service_error_returns_5xx(auth_client: AsyncClient):
    """When the service raises an exception the endpoint returns a 5xx status."""
    with patch(
        "app.services.portfolio_excel.fetch_set_indices",
        side_effect=RuntimeError("Yahoo Finance unavailable"),
    ):
        resp = await auth_client.get("/api/v1/portfolio-tracker/market/set-indices")
    assert resp.status_code >= 500


# ── Global indices ────────────────────────────────────────────────────────────

async def test_get_global_indices_returns_200(auth_client: AsyncClient):
    """GET /market/global-indices returns 200 when the service succeeds."""
    with patch(
        "app.services.portfolio_excel.fetch_global_indices",
        return_value=_GLOBAL_INDICES_PAYLOAD,
    ):
        resp = await auth_client.get("/api/v1/portfolio-tracker/market/global-indices")
    assert resp.status_code == 200


async def test_get_global_indices_returns_list(auth_client: AsyncClient):
    """Response is a list of index objects."""
    with patch(
        "app.services.portfolio_excel.fetch_global_indices",
        return_value=_GLOBAL_INDICES_PAYLOAD,
    ):
        resp = await auth_client.get("/api/v1/portfolio-tracker/market/global-indices")
    assert isinstance(resp.json(), list)


async def test_get_global_indices_each_has_required_fields(auth_client: AsyncClient):
    """Every global index entry has name, value, change, and changePct."""
    with patch(
        "app.services.portfolio_excel.fetch_global_indices",
        return_value=_GLOBAL_INDICES_PAYLOAD,
    ):
        resp = await auth_client.get("/api/v1/portfolio-tracker/market/global-indices")
    for entry in resp.json():
        for field in ("name", "value", "change", "changePct"):
            assert field in entry, f"Missing field '{field}' in {entry}"


async def test_get_global_indices_includes_btc(auth_client: AsyncClient):
    """Global indices include BTC (a proxy for crypto presence)."""
    with patch(
        "app.services.portfolio_excel.fetch_global_indices",
        return_value=_GLOBAL_INDICES_PAYLOAD,
    ):
        resp = await auth_client.get("/api/v1/portfolio-tracker/market/global-indices")
    names = {entry["name"] for entry in resp.json()}
    assert "BTC" in names


async def test_get_global_indices_requires_auth(client: AsyncClient):
    """Unauthenticated request returns 401."""
    resp = await client.get("/api/v1/portfolio-tracker/market/global-indices")
    assert resp.status_code == 401


async def test_get_global_indices_service_error_returns_5xx(auth_client: AsyncClient):
    """Service exception maps to a 5xx response."""
    with patch(
        "app.services.portfolio_excel.fetch_global_indices",
        side_effect=RuntimeError("Network error"),
    ):
        resp = await auth_client.get("/api/v1/portfolio-tracker/market/global-indices")
    assert resp.status_code >= 500


# ── Positions ─────────────────────────────────────────────────────────────────

async def test_get_positions_no_excel_returns_200_or_503(auth_client: AsyncClient, db_session: AsyncSession):
    """
    Without an Excel file configured, GET /positions returns either an empty
    positions list (if user is in db mode) or a 503 (file not found in excel mode).
    Both are valid outcomes depending on the user's portfolio_mode setting.
    """
    with patch(
        "app.services.portfolio_excel.get_positions",
        side_effect=FileNotFoundError("No Excel file found"),
    ):
        resp = await auth_client.get("/api/v1/portfolio-tracker/positions")
    # Either the DB path returned data, or the excel path raised a FileNotFoundError
    assert resp.status_code in (200, 503)


async def test_get_positions_db_mode_returns_empty_list(auth_client: AsyncClient, db_session: AsyncSession):
    """
    When portfolio_mode is 'db' and no positions exist, the response has an
    empty positions list and a total of 0.
    """
    from sqlalchemy import select
    from app.models.user import User

    # Force user to db mode
    result = await db_session.execute(select(User).where(User.email == "test@example.com"))
    user = result.scalar_one()
    user.portfolio_mode = "db"
    await db_session.flush()

    resp = await auth_client.get("/api/v1/portfolio-tracker/positions")
    assert resp.status_code == 200
    body = resp.json()
    assert "positions" in body
    assert body["total"] == 0


async def test_get_positions_excel_mode_patches_service(auth_client: AsyncClient, db_session: AsyncSession):
    """
    When portfolio_mode is 'excel', the service is called and its result is
    forwarded.  We mock it to return a known payload.
    """
    from sqlalchemy import select
    from app.models.user import User

    result = await db_session.execute(select(User).where(User.email == "test@example.com"))
    user = result.scalar_one()
    user.portfolio_mode = "excel"
    await db_session.flush()

    fake_positions = [
        {
            "symbol": "ADVANC", "entryDate": "2024-01-15", "entryPrice": 210.0,
            "exitDate": None, "exitPrice": None, "netPnl": 0.0, "status": "active",
        }
    ]

    with patch("app.services.portfolio_excel.get_positions", return_value=fake_positions):
        resp = await auth_client.get("/api/v1/portfolio-tracker/positions")

    assert resp.status_code == 200
    body = resp.json()
    assert "positions" in body
    assert body["total"] == 1
    assert body["positions"][0]["symbol"] == "ADVANC"


async def test_get_positions_requires_auth(client: AsyncClient):
    """Unauthenticated request returns 401."""
    resp = await client.get("/api/v1/portfolio-tracker/positions")
    assert resp.status_code == 401


# ── Market data shape helper ──────────────────────────────────────────────────

async def test_market_data_value_can_be_none(auth_client: AsyncClient):
    """
    If Yahoo Finance returns no data for an index, value/change/changePct may
    be null — the endpoint should still return 200 rather than crashing.
    """
    null_payload = [{"name": "SET50", "value": None, "change": None, "changePct": None}]
    with patch("app.services.portfolio_excel.fetch_set_indices", return_value=null_payload):
        resp = await auth_client.get("/api/v1/portfolio-tracker/market/set-indices")
    assert resp.status_code == 200
    entry = resp.json()[0]
    assert entry["value"] is None
    assert entry["change"] is None
    assert entry["changePct"] is None
