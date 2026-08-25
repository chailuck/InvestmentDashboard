"""Initial Investment Entry CRUD, the initial-investment-tracking gate,
signed-amount validation, ordering, ownership isolation, and running-total
computation correctness."""

from __future__ import annotations

import uuid

PREFIX = "/api/v1/tracking"


async def _make_item(client, *, tracking_enabled: bool, name="Item"):
    set_id = (await client.post(f"{PREFIX}/sets", json={"name": f"Set-{uuid.uuid4()}"})).json()["id"]
    cat_id = (
        await client.post(f"{PREFIX}/sets/{set_id}/categories", json={"name": "Cat"})
    ).json()["id"]
    sub_id = (
        await client.post(f"{PREFIX}/categories/{cat_id}/sub-categories", json={"name": "Sub"})
    ).json()["id"]
    item = (
        await client.post(
            f"{PREFIX}/sub-categories/{sub_id}/items",
            json={
                "name": name,
                "type": "Investment Account",
                "initialInvestmentTracking": tracking_enabled,
            },
        )
    ).json()
    return item["id"]


# ── Gating: entries only allowed when initial_investment_tracking=true ──────

async def test_create_entry_blocked_when_tracking_disabled(auth_client):
    item_id = await _make_item(auth_client, tracking_enabled=False)
    resp = await auth_client.post(
        f"{PREFIX}/items/{item_id}/entries", json={"amount": "100.00", "entryDate": "2026-01-15"}
    )
    assert resp.status_code == 400
    assert "initial_investment_tracking" in resp.json()["detail"]


async def test_create_entry_allowed_when_tracking_enabled(auth_client):
    item_id = await _make_item(auth_client, tracking_enabled=True)
    resp = await auth_client.post(
        f"{PREFIX}/items/{item_id}/entries", json={"amount": "500.00", "entryDate": "2026-01-15"}
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["amount"] == "500.0000"
    assert body["entryDate"] == "2026-01-15"
    assert body["trackingItemId"] == item_id


async def test_running_total_blocked_when_tracking_disabled(auth_client):
    item_id = await _make_item(auth_client, tracking_enabled=False)
    resp = await auth_client.get(f"{PREFIX}/items/{item_id}/running-total")
    assert resp.status_code == 400


# ── Amount validation ─────────────────────────────────────────────────────────

async def test_create_entry_rejects_zero_amount(auth_client):
    item_id = await _make_item(auth_client, tracking_enabled=True)
    resp = await auth_client.post(
        f"{PREFIX}/items/{item_id}/entries", json={"amount": "0", "entryDate": "2026-01-15"}
    )
    assert resp.status_code == 422


async def test_create_entry_accepts_negative_amount(auth_client):
    item_id = await _make_item(auth_client, tracking_enabled=True)
    resp = await auth_client.post(
        f"{PREFIX}/items/{item_id}/entries", json={"amount": "-250.50", "entryDate": "2026-02-01"}
    )
    assert resp.status_code == 201
    assert resp.json()["amount"] == "-250.5000"


async def test_create_entry_on_nonexistent_item_returns_404(auth_client):
    resp = await auth_client.post(
        f"{PREFIX}/items/{uuid.uuid4()}/entries", json={"amount": "10", "entryDate": "2026-01-01"}
    )
    assert resp.status_code == 404


# ── CRUD + ordering ────────────────────────────────────────────────────────────

async def test_list_entries_ordered_by_date_then_created_at(auth_client):
    item_id = await _make_item(auth_client, tracking_enabled=True)
    await auth_client.post(f"{PREFIX}/items/{item_id}/entries", json={"amount": "10", "entryDate": "2026-03-01"})
    await auth_client.post(f"{PREFIX}/items/{item_id}/entries", json={"amount": "20", "entryDate": "2026-01-01"})
    await auth_client.post(f"{PREFIX}/items/{item_id}/entries", json={"amount": "30", "entryDate": "2026-02-01"})

    resp = await auth_client.get(f"{PREFIX}/items/{item_id}/entries")
    assert resp.status_code == 200
    dates = [e["entryDate"] for e in resp.json()]
    assert dates == ["2026-01-01", "2026-02-01", "2026-03-01"]


async def test_get_update_delete_entry(auth_client):
    item_id = await _make_item(auth_client, tracking_enabled=True)
    create = await auth_client.post(
        f"{PREFIX}/items/{item_id}/entries", json={"amount": "42", "entryDate": "2026-01-01"}
    )
    entry_id = create.json()["id"]

    get_resp = await auth_client.get(f"{PREFIX}/entries/{entry_id}")
    assert get_resp.status_code == 200

    upd = await auth_client.put(f"{PREFIX}/entries/{entry_id}", json={"amount": "99"})
    assert upd.status_code == 200
    assert upd.json()["amount"] == "99.0000"

    bad_upd = await auth_client.put(f"{PREFIX}/entries/{entry_id}", json={"amount": "0"})
    assert bad_upd.status_code == 422

    delete_resp = await auth_client.delete(f"{PREFIX}/entries/{entry_id}")
    assert delete_resp.status_code == 204

    gone = await auth_client.get(f"{PREFIX}/entries/{entry_id}")
    assert gone.status_code == 404


async def test_entry_not_found_returns_404(auth_client):
    resp = await auth_client.get(f"{PREFIX}/entries/{uuid.uuid4()}")
    assert resp.status_code == 404


# ── Ownership isolation ───────────────────────────────────────────────────────

async def test_cross_user_entry_access_returns_404(auth_client, auth_client_b):
    item_id = await _make_item(auth_client, tracking_enabled=True)
    create = await auth_client.post(
        f"{PREFIX}/items/{item_id}/entries", json={"amount": "77", "entryDate": "2026-01-01"}
    )
    entry_id = create.json()["id"]

    assert (await auth_client_b.get(f"{PREFIX}/entries/{entry_id}")).status_code == 404
    assert (
        await auth_client_b.put(f"{PREFIX}/entries/{entry_id}", json={"amount": "1"})
    ).status_code == 404
    assert (await auth_client_b.delete(f"{PREFIX}/entries/{entry_id}")).status_code == 404


async def test_cross_user_cannot_list_entries_of_others_item(auth_client, auth_client_b):
    item_id = await _make_item(auth_client, tracking_enabled=True)
    resp = await auth_client_b.get(f"{PREFIX}/items/{item_id}/entries")
    assert resp.status_code == 404


# ── Running total computation ────────────────────────────────────────────────

async def test_running_total_computes_cumulative_signed_sum_in_date_order(auth_client):
    item_id = await _make_item(auth_client, tracking_enabled=True)
    # Deliberately inserted out of date order to prove sorting, not insertion order, drives the sum.
    await auth_client.post(f"{PREFIX}/items/{item_id}/entries", json={"amount": "1000", "entryDate": "2026-01-01"})
    await auth_client.post(f"{PREFIX}/items/{item_id}/entries", json={"amount": "-300", "entryDate": "2026-03-01"})
    await auth_client.post(f"{PREFIX}/items/{item_id}/entries", json={"amount": "500", "entryDate": "2026-02-01"})

    resp = await auth_client.get(f"{PREFIX}/items/{item_id}/running-total")
    assert resp.status_code == 200
    body = resp.json()
    assert body["itemId"] == item_id
    assert body["currentTotal"] == "1200.0000"

    rows = body["entries"]
    assert [r["entryDate"] for r in rows] == ["2026-01-01", "2026-02-01", "2026-03-01"]
    assert [r["runningTotal"] for r in rows] == ["1000.0000", "1500.0000", "1200.0000"]


async def test_running_total_empty_when_no_entries(auth_client):
    item_id = await _make_item(auth_client, tracking_enabled=True)
    resp = await auth_client.get(f"{PREFIX}/items/{item_id}/running-total")
    assert resp.status_code == 200
    body = resp.json()
    assert body["currentTotal"] == "0"
    assert body["entries"] == []


async def test_running_total_on_nonexistent_item_returns_404(auth_client):
    resp = await auth_client.get(f"{PREFIX}/items/{uuid.uuid4()}/running-total")
    assert resp.status_code == 404
