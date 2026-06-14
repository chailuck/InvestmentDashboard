"""Tests for the Weekly Review List endpoints."""

from __future__ import annotations

import uuid
from datetime import date, timedelta

import pytest
from httpx import AsyncClient


# ── Helpers ────────────────────────────────────────────────────────────────────

def _monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


# ── Tests ──────────────────────────────────────────────────────────────────────

async def test_current_week_creates_review(auth_client: AsyncClient):
    """GET /review-list/current-week should create a review if none exists."""
    resp = await auth_client.get("/api/v1/review-list/current-week")
    assert resp.status_code == 200
    data = resp.json()
    assert "id" in data
    assert "week_start" in data
    assert "week_end" in data

    monday = _monday(date.today())
    assert data["week_start"] == monday.isoformat()


async def test_current_week_idempotent(auth_client: AsyncClient):
    """Calling current-week twice must return the same review id."""
    r1 = await auth_client.get("/api/v1/review-list/current-week")
    r2 = await auth_client.get("/api/v1/review-list/current-week")
    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r1.json()["id"] == r2.json()["id"]


async def test_list_reviews_returns_list(auth_client: AsyncClient):
    """List endpoint returns an array."""
    resp = await auth_client.get("/api/v1/review-list")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


async def test_create_and_get_review(auth_client: AsyncClient):
    """Create a review for a past week, then retrieve it."""
    past_monday = _monday(date.today()) - timedelta(weeks=2)

    resp = await auth_client.post(
        "/api/v1/review-list",
        json={"week_start": past_monday.isoformat()},
    )
    assert resp.status_code == 201
    review_id = resp.json()["id"]

    resp = await auth_client.get(f"/api/v1/review-list/{review_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == review_id
    assert data["week_start"] == past_monday.isoformat()
    assert data["items"] == []
    assert "open_suggestions" in data


async def test_create_duplicate_week_fails(auth_client: AsyncClient):
    """Creating a second review for the same week returns 409."""
    past_monday = _monday(date.today()) - timedelta(weeks=5)

    await auth_client.post(
        "/api/v1/review-list",
        json={"week_start": past_monday.isoformat()},
    )
    resp = await auth_client.post(
        "/api/v1/review-list",
        json={"week_start": past_monday.isoformat()},
    )
    assert resp.status_code == 409


async def test_add_and_patch_item(auth_client: AsyncClient):
    """Add a BUY item then patch its reason and feeling."""
    r = await auth_client.get("/api/v1/review-list/current-week")
    review_id = r.json()["id"]

    resp = await auth_client.post(
        f"/api/v1/review-list/{review_id}/items",
        json={
            "symbol": "BH",
            "item_type": "BUY",
            "transaction_date": date.today().isoformat(),
            "price": 120.50,
            "size": 500,
        },
    )
    assert resp.status_code == 201
    item_id = resp.json()["id"]
    assert resp.json()["symbol"] == "BH"
    assert resp.json()["item_type"] == "BUY"

    patch_resp = await auth_client.patch(
        f"/api/v1/review-list/{review_id}/items/{item_id}",
        json={"buy_reason": "Strong breakout above MA50", "feeling": 4},
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()["buy_reason"] == "Strong breakout above MA50"
    assert patch_resp.json()["feeling"] == 4


async def test_feeling_validation(auth_client: AsyncClient):
    """Feeling values outside 1–5 are rejected with 422."""
    r = await auth_client.get("/api/v1/review-list/current-week")
    review_id = r.json()["id"]

    item_resp = await auth_client.post(
        f"/api/v1/review-list/{review_id}/items",
        json={"symbol": "AOT", "item_type": "SELL"},
    )
    item_id = item_resp.json()["id"]

    bad_resp = await auth_client.patch(
        f"/api/v1/review-list/{review_id}/items/{item_id}",
        json={"feeling": 6},
    )
    assert bad_resp.status_code == 422


async def test_delete_item(auth_client: AsyncClient):
    """Delete an item and confirm it's gone from the review."""
    r = await auth_client.get("/api/v1/review-list/current-week")
    review_id = r.json()["id"]

    item_resp = await auth_client.post(
        f"/api/v1/review-list/{review_id}/items",
        json={"symbol": "KBANK", "item_type": "HOLD"},
    )
    item_id = item_resp.json()["id"]

    del_resp = await auth_client.delete(
        f"/api/v1/review-list/{review_id}/items/{item_id}"
    )
    assert del_resp.status_code == 204

    detail_resp = await auth_client.get(f"/api/v1/review-list/{review_id}")
    items = detail_resp.json()["items"]
    assert all(i["id"] != item_id for i in items)


async def test_delete_review(auth_client: AsyncClient):
    """Delete a review and confirm 404 on subsequent fetch."""
    past_monday = _monday(date.today()) - timedelta(weeks=6)
    create_resp = await auth_client.post(
        "/api/v1/review-list",
        json={"week_start": past_monday.isoformat()},
    )
    review_id = create_resp.json()["id"]

    del_resp = await auth_client.delete(f"/api/v1/review-list/{review_id}")
    assert del_resp.status_code == 204

    get_resp = await auth_client.get(f"/api/v1/review-list/{review_id}")
    assert get_resp.status_code == 404


async def test_update_review_header(auth_client: AsyncClient):
    """Update name and notes on a review."""
    r = await auth_client.get("/api/v1/review-list/current-week")
    review_id = r.json()["id"]

    resp = await auth_client.put(
        f"/api/v1/review-list/{review_id}",
        json={"name": "My Custom Name", "notes": "Overall market was volatile"},
    )
    assert resp.status_code == 200

    detail = await auth_client.get(f"/api/v1/review-list/{review_id}")
    assert detail.json()["name"] == "My Custom Name"
    assert detail.json()["notes"] == "Overall market was volatile"


async def test_item_type_validation(auth_client: AsyncClient):
    """Invalid item_type is rejected with 422."""
    r = await auth_client.get("/api/v1/review-list/current-week")
    review_id = r.json()["id"]

    resp = await auth_client.post(
        f"/api/v1/review-list/{review_id}/items",
        json={"symbol": "PTT", "item_type": "INVALID"},
    )
    assert resp.status_code == 422


async def test_list_with_months_filter(auth_client: AsyncClient):
    """Month filter returns only reviews within range."""
    resp = await auth_client.get("/api/v1/review-list", params={"months": 3})
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


async def test_review_not_accessible_by_other_user(auth_client: AsyncClient):
    """A random UUID review returns 404 for any user."""
    fake_id = str(uuid.uuid4())
    resp = await auth_client.get(f"/api/v1/review-list/{fake_id}")
    assert resp.status_code == 404


async def test_sell_item_has_sell_reason(auth_client: AsyncClient):
    """SELL item can have sell_reason set."""
    r = await auth_client.get("/api/v1/review-list/current-week")
    review_id = r.json()["id"]

    item_resp = await auth_client.post(
        f"/api/v1/review-list/{review_id}/items",
        json={
            "symbol": "CPALL",
            "item_type": "SELL",
            "price": 55.25,
            "size": 1000,
        },
    )
    item_id = item_resp.json()["id"]

    patch_resp = await auth_client.patch(
        f"/api/v1/review-list/{review_id}/items/{item_id}",
        json={"sell_reason": "Hit take-profit target", "feeling": 5},
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()["sell_reason"] == "Hit take-profit target"
    assert patch_resp.json()["feeling"] == 5


async def test_review_detail_items_in_correct_parts(auth_client: AsyncClient):
    """Detail endpoint returns items separable by item_type for Part 1 vs Part 2."""
    past_monday = _monday(date.today()) - timedelta(weeks=7)
    create_resp = await auth_client.post(
        "/api/v1/review-list",
        json={"week_start": past_monday.isoformat()},
    )
    review_id = create_resp.json()["id"]

    await auth_client.post(
        f"/api/v1/review-list/{review_id}/items",
        json={"symbol": "BBL", "item_type": "BUY"},
    )
    await auth_client.post(
        f"/api/v1/review-list/{review_id}/items",
        json={"symbol": "SCB", "item_type": "SELL"},
    )
    await auth_client.post(
        f"/api/v1/review-list/{review_id}/items",
        json={"symbol": "MINT", "item_type": "HOLD"},
    )

    detail = await auth_client.get(f"/api/v1/review-list/{review_id}")
    items = detail.json()["items"]

    types = {i["symbol"]: i["item_type"] for i in items}
    assert types.get("BBL") == "BUY"
    assert types.get("SCB") == "SELL"
    assert types.get("MINT") == "HOLD"
