"""Tests for action plan endpoints.

Endpoints covered
-----------------
GET  /api/v1/action-plans/suggest-name?plan_type=purchase
GET  /api/v1/action-plans/stock-price?symbol=<SYMBOL>
GET  /api/v1/action-plans?plan_type=purchase
POST /api/v1/action-plans
GET  /api/v1/action-plans/{id}
PUT  /api/v1/action-plans/{id}
DELETE /api/v1/action-plans/{id}
POST /api/v1/action-plans/{id}/duplicate

Notes
-----
* All endpoints require authentication (auth_client fixture).
* plan_type must be 'purchase' or 'portfolio'.
* suggest-name returns a date-based name (YYYY-MM-DD or YYYY-MM-DD-NN).
* stock-price proxies yfinance; must be patched in tests to avoid live network calls.
"""

from __future__ import annotations

import re
import uuid
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest
from httpx import AsyncClient


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _create_plan(
    client: AsyncClient,
    plan_type: str = "purchase",
    name: str | None = None,
) -> dict:
    """Create an action plan and return the response body."""
    if name is None:
        name = f"Test Plan {uuid.uuid4().hex[:6]}"
    resp = await client.post(
        "/api/v1/action-plans",
        json={"name": name, "plan_type": plan_type},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


# ── Suggest name ──────────────────────────────────────────────────────────────

async def test_suggest_plan_name_purchase(auth_client: AsyncClient):
    """GET /suggest-name?plan_type=purchase returns a YYYY-MM-DD pattern."""
    resp = await auth_client.get("/api/v1/action-plans/suggest-name?plan_type=purchase")
    assert resp.status_code == 200
    name = resp.json()["name"]
    assert re.match(r"^\d{4}-\d{2}-\d{2}(-\d{2})?$", name), (
        f"Name '{name}' does not match expected YYYY-MM-DD[-NN] pattern"
    )


async def test_suggest_plan_name_portfolio(auth_client: AsyncClient):
    """GET /suggest-name?plan_type=portfolio also returns a valid date pattern."""
    resp = await auth_client.get("/api/v1/action-plans/suggest-name?plan_type=portfolio")
    assert resp.status_code == 200
    name = resp.json()["name"]
    assert re.match(r"^\d{4}-\d{2}-\d{2}(-\d{2})?$", name)


async def test_suggest_plan_name_missing_plan_type_returns_422(auth_client: AsyncClient):
    """Omitting plan_type query parameter returns 422."""
    resp = await auth_client.get("/api/v1/action-plans/suggest-name")
    assert resp.status_code == 422


async def test_suggest_plan_name_unique_on_second_call(auth_client: AsyncClient):
    """Two plans created with today's base name cause suggest-name to return a suffix."""
    # First plan takes the base date slot
    resp1 = await auth_client.get("/api/v1/action-plans/suggest-name?plan_type=purchase")
    name1 = resp1.json()["name"]
    await _create_plan(auth_client, name=name1)

    # Second call must return a different (suffixed) name
    resp2 = await auth_client.get("/api/v1/action-plans/suggest-name?plan_type=purchase")
    name2 = resp2.json()["name"]
    assert name2 != name1
    assert re.match(r"^\d{4}-\d{2}-\d{2}-\d{2}$", name2)


# ── Create ────────────────────────────────────────────────────────────────────

async def test_create_purchase_plan_returns_201(auth_client: AsyncClient):
    """POST /action-plans with plan_type=purchase returns 201."""
    resp = await auth_client.post(
        "/api/v1/action-plans",
        json={"name": "My Purchase Plan", "plan_type": "purchase"},
    )
    assert resp.status_code == 201


async def test_create_portfolio_plan_returns_201(auth_client: AsyncClient):
    """POST /action-plans with plan_type=portfolio returns 201."""
    resp = await auth_client.post(
        "/api/v1/action-plans",
        json={"name": "My Portfolio Plan", "plan_type": "portfolio"},
    )
    assert resp.status_code == 201


async def test_create_plan_returns_id_and_type(auth_client: AsyncClient):
    """Created plan body contains id, name, and plan_type."""
    body = await _create_plan(auth_client, plan_type="purchase", name="Plan A")
    assert "id" in body
    assert body["name"] == "Plan A"
    assert body["plan_type"] == "purchase"


async def test_create_plan_invalid_type_returns_400(auth_client: AsyncClient):
    """plan_type values other than 'purchase'/'portfolio' return 400."""
    resp = await auth_client.post(
        "/api/v1/action-plans",
        json={"name": "Bad Plan", "plan_type": "watchlist"},
    )
    assert resp.status_code == 400


async def test_create_plan_requires_auth(client: AsyncClient):
    """Unauthenticated POST /action-plans returns 401."""
    resp = await client.post(
        "/api/v1/action-plans",
        json={"name": "Anon Plan", "plan_type": "purchase"},
    )
    assert resp.status_code == 401


# ── List ──────────────────────────────────────────────────────────────────────

async def test_list_plans_contains_created_plan(auth_client: AsyncClient):
    """GET /action-plans?plan_type=purchase includes a plan we just created."""
    created = await _create_plan(auth_client, plan_type="purchase", name="Listable Plan")
    resp = await auth_client.get("/api/v1/action-plans?plan_type=purchase")
    assert resp.status_code == 200
    ids = [p["id"] for p in resp.json()]
    assert created["id"] in ids


async def test_list_plans_filtered_by_type(auth_client: AsyncClient):
    """GET /action-plans?plan_type=portfolio only returns portfolio plans."""
    await _create_plan(auth_client, plan_type="purchase", name="Purchase1")
    await _create_plan(auth_client, plan_type="portfolio", name="Portfolio1")

    resp = await auth_client.get("/api/v1/action-plans?plan_type=portfolio")
    types = [p["plan_type"] for p in resp.json()]
    assert all(t == "portfolio" for t in types)


async def test_list_plans_missing_type_returns_422(auth_client: AsyncClient):
    """GET /action-plans without plan_type returns 422."""
    resp = await auth_client.get("/api/v1/action-plans")
    assert resp.status_code == 422


# ── Get detail ────────────────────────────────────────────────────────────────

async def test_get_plan_detail_returns_items_arrays(auth_client: AsyncClient):
    """GET /action-plans/{id} includes purchase_items and portfolio_items arrays."""
    created = await _create_plan(auth_client, plan_type="purchase")
    resp = await auth_client.get(f"/api/v1/action-plans/{created['id']}")
    assert resp.status_code == 200
    body = resp.json()
    assert "purchase_items" in body
    assert "portfolio_items" in body
    assert isinstance(body["purchase_items"], list)
    assert isinstance(body["portfolio_items"], list)


async def test_get_plan_detail_not_found(auth_client: AsyncClient):
    """GET /action-plans/{unknown_id} returns 404."""
    resp = await auth_client.get(f"/api/v1/action-plans/{uuid.uuid4()}")
    assert resp.status_code == 404


async def test_get_plan_detail_contains_metadata(auth_client: AsyncClient):
    """Plan detail includes id, name, plan_type, created_at, updated_at."""
    created = await _create_plan(auth_client, name="Detail Plan")
    resp = await auth_client.get(f"/api/v1/action-plans/{created['id']}")
    body = resp.json()
    for field in ("id", "name", "plan_type", "created_at", "updated_at"):
        assert field in body, f"Missing field: {field}"


# ── Update (PUT replaces items) ───────────────────────────────────────────────

async def test_update_plan_items_persisted(auth_client: AsyncClient):
    """PUT /action-plans/{id} with purchase_items replaces and persists them."""
    created = await _create_plan(auth_client, plan_type="purchase")
    plan_id = created["id"]

    items = [
        {"sort_order": 0, "stock": "ADVANC", "buy_price": 210.0, "size": 100},
        {"sort_order": 1, "stock": "BBL",    "buy_price": 135.0, "size": 200},
    ]
    put_resp = await auth_client.put(
        f"/api/v1/action-plans/{plan_id}",
        json={"purchase_items": items},
    )
    assert put_resp.status_code == 200

    get_resp = await auth_client.get(f"/api/v1/action-plans/{plan_id}")
    purchase_items = get_resp.json()["purchase_items"]
    stocks = [it["stock"] for it in purchase_items]
    assert "ADVANC" in stocks
    assert "BBL" in stocks


async def test_update_plan_name(auth_client: AsyncClient):
    """PUT /action-plans/{id} can rename the plan."""
    created = await _create_plan(auth_client, name="Old Name")
    plan_id = created["id"]

    await auth_client.put(f"/api/v1/action-plans/{plan_id}", json={"name": "New Name"})

    resp = await auth_client.get(f"/api/v1/action-plans/{plan_id}")
    assert resp.json()["name"] == "New Name"


async def test_update_plan_replaces_items_not_appends(auth_client: AsyncClient):
    """Second PUT completely replaces items (no appending)."""
    created = await _create_plan(auth_client, plan_type="purchase")
    plan_id = created["id"]

    await auth_client.put(
        f"/api/v1/action-plans/{plan_id}",
        json={"purchase_items": [{"stock": "ADVANC", "sort_order": 0}]},
    )
    await auth_client.put(
        f"/api/v1/action-plans/{plan_id}",
        json={"purchase_items": [{"stock": "PTT", "sort_order": 0}]},
    )
    resp = await auth_client.get(f"/api/v1/action-plans/{plan_id}")
    stocks = [it["stock"] for it in resp.json()["purchase_items"]]
    assert stocks == ["PTT"]
    assert "ADVANC" not in stocks


# ── Delete ────────────────────────────────────────────────────────────────────

async def test_delete_plan_returns_204(auth_client: AsyncClient):
    """DELETE /action-plans/{id} returns 204."""
    created = await _create_plan(auth_client)
    resp = await auth_client.delete(f"/api/v1/action-plans/{created['id']}")
    assert resp.status_code == 204


async def test_delete_plan_removes_from_list(auth_client: AsyncClient):
    """Deleted plan no longer appears in GET /action-plans."""
    created = await _create_plan(auth_client, plan_type="purchase")
    plan_id = created["id"]
    await auth_client.delete(f"/api/v1/action-plans/{plan_id}")

    resp = await auth_client.get("/api/v1/action-plans?plan_type=purchase")
    ids = [p["id"] for p in resp.json()]
    assert plan_id not in ids


async def test_delete_nonexistent_plan_returns_404(auth_client: AsyncClient):
    """Deleting an unknown plan returns 404."""
    resp = await auth_client.delete(f"/api/v1/action-plans/{uuid.uuid4()}")
    assert resp.status_code == 404


# ── Duplicate ─────────────────────────────────────────────────────────────────

async def test_duplicate_plan_creates_new_plan(auth_client: AsyncClient):
    """POST /action-plans/{id}/duplicate creates a new plan with the given name."""
    src = await _create_plan(auth_client, plan_type="purchase", name="Source Plan")
    # Add an item so it gets copied
    await auth_client.put(
        f"/api/v1/action-plans/{src['id']}",
        json={"purchase_items": [{"stock": "ADVANC", "sort_order": 0}]},
    )

    resp = await auth_client.post(
        f"/api/v1/action-plans/{src['id']}/duplicate?new_name=Copied+Plan"
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "Copied Plan"
    assert body["id"] != src["id"]


async def test_duplicate_plan_copies_items(auth_client: AsyncClient):
    """Duplicated plan contains the same purchase items as the source."""
    src = await _create_plan(auth_client, plan_type="purchase")
    await auth_client.put(
        f"/api/v1/action-plans/{src['id']}",
        json={"purchase_items": [{"stock": "PTT", "sort_order": 0, "buy_price": 35.0}]},
    )

    dup = await auth_client.post(
        f"/api/v1/action-plans/{src['id']}/duplicate?new_name=Dup"
    )
    dup_id = dup.json()["id"]

    detail = await auth_client.get(f"/api/v1/action-plans/{dup_id}")
    stocks = [it["stock"] for it in detail.json()["purchase_items"]]
    assert "PTT" in stocks


# ── Stock price ───────────────────────────────────────────────────────────────
#
# The endpoint calls yfinance at runtime.  We patch the module path that
# FastAPI imports — `yfinance` inside the action_plan endpoint module — so no
# live network requests are made.  The patch target must match the import
# statement in the endpoint: `import yfinance as yf` inside the function body,
# which resolves to the top-level `yfinance` module.
#
# TC-BE-01: valid symbol returns 200 with symbol/ticker/price fields
# TC-BE-02: unknown / delisted symbol (empty history) returns 404
# TC-BE-03: missing symbol query parameter returns 422
# TC-BE-04: unauthenticated request returns 401
# TC-BE-05: yfinance raises an exception — endpoint falls through and returns 404
# TC-BE-06: symbol is normalised to upper-case in the response
# TC-BE-07: price is rounded to 2 decimal places in the response
#
# Patch strategy
# --------------
# The endpoint does `import yfinance as yf` inside the function body, so there
# is no module-level `yf` attribute to patch.  The correct patch target is
# `yfinance.Ticker` — the attribute that the local `yf` alias will resolve to
# at call time.  Using `patch("yfinance.Ticker")` replaces the class on the
# module object itself before the local import runs, so the local `yf.Ticker`
# call picks up the mock.


def _make_history_df(price: float) -> "pd.DataFrame":
    """Single-row Close DataFrame mimicking yfinance Ticker.history() output."""
    close_series = pd.Series([price])
    return pd.DataFrame({"Close": close_series})


async def test_stock_price_valid_symbol(auth_client: AsyncClient):
    """TC-BE-01: GET /stock-price?symbol=BH returns 200 with symbol, ticker, price."""
    mock_ticker = MagicMock()
    mock_ticker.history.return_value = _make_history_df(150.25)

    with patch("yfinance.Ticker", return_value=mock_ticker):
        resp = await auth_client.get("/api/v1/action-plans/stock-price?symbol=BH")

    assert resp.status_code == 200
    body = resp.json()
    assert body["symbol"] == "BH"
    assert body["price"] == 150.25
    assert "ticker" in body
    assert "change_pct" in body
    assert body["change_pct"] is None  # single-row mock — no previous close available


async def test_stock_price_unknown_symbol_returns_404(auth_client: AsyncClient):
    """TC-BE-02: Symbol with no historical data (empty DataFrame) returns 404."""
    mock_ticker = MagicMock()
    mock_ticker.history.return_value = pd.DataFrame()

    with patch("yfinance.Ticker", return_value=mock_ticker):
        resp = await auth_client.get("/api/v1/action-plans/stock-price?symbol=FAKEXYZ")

    assert resp.status_code == 404
    assert "FAKEXYZ" in resp.json()["detail"]


async def test_stock_price_missing_symbol_returns_422(auth_client: AsyncClient):
    """TC-BE-03: Omitting the symbol query parameter returns 422 (FastAPI validation)."""
    resp = await auth_client.get("/api/v1/action-plans/stock-price")
    assert resp.status_code == 422


async def test_stock_price_unauthenticated(client: AsyncClient):
    """TC-BE-04: Request without a JWT token returns 401."""
    resp = await client.get("/api/v1/action-plans/stock-price?symbol=BH")
    assert resp.status_code == 401


async def test_stock_price_yfinance_exception_returns_404(auth_client: AsyncClient):
    """TC-BE-05: When yfinance raises, the endpoint catches and returns 404, not 500."""
    mock_ticker = MagicMock()
    mock_ticker.history.side_effect = Exception("yfinance network error")

    with patch("yfinance.Ticker", return_value=mock_ticker):
        resp = await auth_client.get("/api/v1/action-plans/stock-price?symbol=ERR")

    assert resp.status_code == 404


async def test_stock_price_symbol_normalised_to_uppercase(auth_client: AsyncClient):
    """TC-BE-06: Lower-case input symbol is returned as upper-case in the response."""
    mock_ticker = MagicMock()
    mock_ticker.history.return_value = _make_history_df(75.0)

    with patch("yfinance.Ticker", return_value=mock_ticker):
        resp = await auth_client.get("/api/v1/action-plans/stock-price?symbol=advanc")

    assert resp.status_code == 200
    assert resp.json()["symbol"] == "ADVANC"


async def test_stock_price_rounded_to_two_decimal_places(auth_client: AsyncClient):
    """TC-BE-07: Price with many decimal places is rounded to 2dp in the response."""
    mock_ticker = MagicMock()
    mock_ticker.history.return_value = _make_history_df(123.456789)

    with patch("yfinance.Ticker", return_value=mock_ticker):
        resp = await auth_client.get("/api/v1/action-plans/stock-price?symbol=PTT")

    assert resp.status_code == 200
    assert resp.json()["price"] == round(123.456789, 2)
    assert "change_pct" in resp.json()
    assert resp.json()["change_pct"] is None  # single-row mock — no previous close available


# ── Price history ─────────────────────────────────────────────────────────────
#
# Endpoint: GET /api/v1/action-plans/price-history
#
# Patch strategy: same as stock-price tests — patch "yfinance.Ticker" so that
# the local `import yfinance as yf` inside _fetch_week_closes picks up the mock.
# The mock history() return value must be a pd.DataFrame with a DatetimeIndex
# and a "Close" column so that the endpoint can iterate over the index and look
# up hist.loc[dt, "Close"].
#
# TC-PH-01: single symbol, 5 rows → 200, prices["BH"] has 5 date keys
# TC-PH-02: two symbols → both present in prices map
# TC-PH-03: date_to - date_from is 3 days (not 4) → 400
# TC-PH-04: 21 symbols → 400
# TC-PH-05: symbol with invalid chars → 400
# TC-PH-06: yfinance raises exception → 200, prices[symbol] is {}
# TC-PH-07: yfinance returns empty DataFrame → 200, prices[symbol] is {}


def _make_week_history_df(
    date_strings: list[str],
    prices: list[float] | None = None,
) -> pd.DataFrame:
    """Build a yfinance-style history DataFrame with a tz-aware DatetimeIndex.

    The real yfinance history() returns an index in Asia/Bangkok timezone for
    .BK tickers.  We simulate that here so the endpoint's tz_localize(None) call
    has realistic input to normalise.
    """
    if prices is None:
        prices = [100.0 + i for i in range(len(date_strings))]
    index = pd.DatetimeIndex(
        [pd.Timestamp(d, tz="Asia/Bangkok") for d in date_strings]
    )
    return pd.DataFrame({"Close": prices}, index=index)


async def test_price_history_single_symbol_returns_five_dates(auth_client: AsyncClient):
    """TC-PH-01: Single symbol with 5 trading days returns 200 and 5 date keys."""
    dates = [
        "2026-06-16",
        "2026-06-17",
        "2026-06-18",
        "2026-06-19",
        "2026-06-20",
    ]
    close_prices = [122.50, 124.00, 123.75, 125.00, 126.25]
    mock_ticker = MagicMock()
    mock_ticker.history.return_value = _make_week_history_df(dates, close_prices)

    with patch("yfinance.Ticker", return_value=mock_ticker):
        resp = await auth_client.get(
            "/api/v1/action-plans/price-history"
            "?symbols=BH&date_from=2026-06-16&date_to=2026-06-20"
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["date_from"] == "2026-06-16"
    assert body["date_to"] == "2026-06-20"
    assert "BH" in body["prices"]
    bh_prices = body["prices"]["BH"]
    assert len(bh_prices) == 5
    for d in dates:
        assert d in bh_prices
        assert isinstance(bh_prices[d], float)


async def test_price_history_two_symbols_both_present(auth_client: AsyncClient):
    """TC-PH-02: Two symbols → both keys present in the prices map."""
    dates = ["2026-06-16", "2026-06-17", "2026-06-18", "2026-06-19", "2026-06-20"]
    mock_ticker = MagicMock()
    mock_ticker.history.return_value = _make_week_history_df(dates)

    with patch("yfinance.Ticker", return_value=mock_ticker):
        resp = await auth_client.get(
            "/api/v1/action-plans/price-history"
            "?symbols=BH,KBANK&date_from=2026-06-16&date_to=2026-06-20"
        )

    assert resp.status_code == 200
    prices = resp.json()["prices"]
    assert "BH" in prices
    assert "KBANK" in prices


async def test_price_history_date_range_not_four_days_returns_400(auth_client: AsyncClient):
    """TC-PH-03: date_to - date_from = 3 days (not 4) → 400."""
    resp = await auth_client.get(
        "/api/v1/action-plans/price-history"
        "?symbols=BH&date_from=2026-06-16&date_to=2026-06-19"
    )
    assert resp.status_code == 400


async def test_price_history_too_many_symbols_returns_400(auth_client: AsyncClient):
    """TC-PH-04: 21 symbols in request → 400."""
    symbols = ",".join([f"S{i:02d}" for i in range(21)])
    resp = await auth_client.get(
        f"/api/v1/action-plans/price-history"
        f"?symbols={symbols}&date_from=2026-06-16&date_to=2026-06-20"
    )
    assert resp.status_code == 400


async def test_price_history_invalid_symbol_chars_returns_400(auth_client: AsyncClient):
    """TC-PH-05: Symbol with invalid characters (BH$$) → 400."""
    resp = await auth_client.get(
        "/api/v1/action-plans/price-history"
        "?symbols=BH$$&date_from=2026-06-16&date_to=2026-06-20"
    )
    assert resp.status_code == 400


async def test_price_history_yfinance_exception_returns_200_with_empty_map(auth_client: AsyncClient):
    """TC-PH-06: yfinance raises an exception → 200 with prices[symbol] = {}."""
    mock_ticker = MagicMock()
    mock_ticker.history.side_effect = Exception("network error")

    with patch("yfinance.Ticker", return_value=mock_ticker):
        resp = await auth_client.get(
            "/api/v1/action-plans/price-history"
            "?symbols=BH&date_from=2026-06-16&date_to=2026-06-20"
        )

    assert resp.status_code == 200
    assert resp.json()["prices"]["BH"] == {}


async def test_price_history_empty_dataframe_returns_200_with_empty_map(auth_client: AsyncClient):
    """TC-PH-07: yfinance returns empty DataFrame → 200 with prices[symbol] = {}."""
    mock_ticker = MagicMock()
    mock_ticker.history.return_value = pd.DataFrame()

    with patch("yfinance.Ticker", return_value=mock_ticker):
        resp = await auth_client.get(
            "/api/v1/action-plans/price-history"
            "?symbols=PTT&date_from=2026-06-16&date_to=2026-06-20"
        )

    assert resp.status_code == 200
    assert resp.json()["prices"]["PTT"] == {}


async def test_price_history_unauthenticated_returns_401(client: AsyncClient):
    """TC-PH-14: Unauthenticated request returns 401."""
    resp = await client.get(
        "/api/v1/action-plans/price-history"
        "?symbols=BH&date_from=2026-06-16&date_to=2026-06-20"
    )
    assert resp.status_code == 401
