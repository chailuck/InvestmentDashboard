"""Category CRUD, ownership isolation, and reorder atomicity."""

from __future__ import annotations

import uuid

PREFIX = "/api/v1/tracking"


async def _make_set(client, name="Set For Categories"):
    resp = await client.post(f"{PREFIX}/sets", json={"name": name})
    return resp.json()["id"]


async def test_create_category_explicit_order(auth_client):
    set_id = await _make_set(auth_client)
    resp = await auth_client.post(
        f"{PREFIX}/sets/{set_id}/categories", json={"name": "Custom Category", "order": 5}
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "Custom Category"
    assert body["order"] == 5
    assert body["trackingSetId"] == set_id


async def test_create_category_default_order_is_max_plus_one(auth_client):
    set_id = await _make_set(auth_client, "Order Default Set")
    # cascade already created Assets(1)/Liabilities(2)
    resp = await auth_client.post(f"{PREFIX}/sets/{set_id}/categories", json={"name": "New One"})
    assert resp.status_code == 201
    assert resp.json()["order"] == 3


async def test_create_category_on_nonexistent_set_returns_404(auth_client):
    resp = await auth_client.post(
        f"{PREFIX}/sets/{uuid.uuid4()}/categories", json={"name": "Orphan"}
    )
    assert resp.status_code == 404


async def test_list_categories_ordered_by_order_index(auth_client):
    set_id = await _make_set(auth_client, "List Order Set")
    resp = await auth_client.get(f"{PREFIX}/sets/{set_id}/categories")
    assert resp.status_code == 200
    orders = [c["order"] for c in resp.json()]
    assert orders == sorted(orders)
    assert [c["name"] for c in resp.json()] == ["Assets", "Liabilities"]


async def test_get_update_delete_category(auth_client):
    set_id = await _make_set(auth_client, "CRUD Set")
    create = await auth_client.post(f"{PREFIX}/sets/{set_id}/categories", json={"name": "Temp"})
    cat_id = create.json()["id"]

    get_resp = await auth_client.get(f"{PREFIX}/categories/{cat_id}")
    assert get_resp.status_code == 200

    upd = await auth_client.put(f"{PREFIX}/categories/{cat_id}", json={"description": "now described"})
    assert upd.status_code == 200
    assert upd.json()["description"] == "now described"
    assert upd.json()["name"] == "Temp"  # untouched by partial update

    delete_resp = await auth_client.delete(f"{PREFIX}/categories/{cat_id}")
    assert delete_resp.status_code == 204

    gone = await auth_client.get(f"{PREFIX}/categories/{cat_id}")
    assert gone.status_code == 404


async def test_category_not_found_returns_404(auth_client):
    resp = await auth_client.get(f"{PREFIX}/categories/{uuid.uuid4()}")
    assert resp.status_code == 404


# ── Ownership isolation ───────────────────────────────────────────────────────

async def test_cross_user_category_access_returns_404(auth_client, auth_client_b):
    set_id = await _make_set(auth_client, "A Private Set For Cats")
    create = await auth_client.post(f"{PREFIX}/sets/{set_id}/categories", json={"name": "A's Category"})
    cat_id = create.json()["id"]

    get_resp = await auth_client_b.get(f"{PREFIX}/categories/{cat_id}")
    assert get_resp.status_code == 404

    upd_resp = await auth_client_b.put(f"{PREFIX}/categories/{cat_id}", json={"name": "hijack"})
    assert upd_resp.status_code == 404

    del_resp = await auth_client_b.delete(f"{PREFIX}/categories/{cat_id}")
    assert del_resp.status_code == 404


async def test_cross_user_cannot_list_categories_of_others_set(auth_client, auth_client_b):
    set_id = await _make_set(auth_client, "Hidden Set")
    resp = await auth_client_b.get(f"{PREFIX}/sets/{set_id}/categories")
    assert resp.status_code == 404


# ── Reorder atomicity ──────────────────────────────────────────────────────────

async def test_reorder_categories_atomic(auth_client):
    set_id = await _make_set(auth_client, "Reorder Set")
    cats = (await auth_client.get(f"{PREFIX}/sets/{set_id}/categories")).json()
    assets = next(c for c in cats if c["name"] == "Assets")
    liabilities = next(c for c in cats if c["name"] == "Liabilities")

    resp = await auth_client.put(
        f"{PREFIX}/sets/{set_id}/categories/reorder",
        json={"items": [{"id": assets["id"], "order": 9}, {"id": liabilities["id"], "order": 1}]},
    )
    assert resp.status_code == 200

    after = (await auth_client.get(f"{PREFIX}/sets/{set_id}/categories")).json()
    ordered_names = [c["name"] for c in after]
    assert ordered_names == ["Liabilities", "Assets"]


async def test_reorder_rejects_foreign_id_with_400(auth_client, auth_client_b):
    set_id = await _make_set(auth_client, "Reorder Guard Set")
    other_set_id = await _make_set(auth_client_b, "Other User Set")
    other_cats = (await auth_client_b.get(f"{PREFIX}/sets/{other_set_id}/categories")).json()
    foreign_id = other_cats[0]["id"]

    resp = await auth_client.put(
        f"{PREFIX}/sets/{set_id}/categories/reorder",
        json={"items": [{"id": foreign_id, "order": 1}]},
    )
    assert resp.status_code == 400

    # Nothing should have changed for the foreign category.
    still = (await auth_client_b.get(f"{PREFIX}/sets/{other_set_id}/categories")).json()
    assert still[0]["order"] == other_cats[0]["order"]


async def test_reorder_on_nonexistent_set_returns_404(auth_client):
    resp = await auth_client.put(
        f"{PREFIX}/sets/{uuid.uuid4()}/categories/reorder", json={"items": []}
    )
    assert resp.status_code == 404
