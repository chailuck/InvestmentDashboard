"""Tests for action plan endpoints.

Endpoints covered
-----------------
GET  /api/v1/action-plans/suggest-name?plan_type=purchase
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
"""

from __future__ import annotations

import re
import uuid

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
