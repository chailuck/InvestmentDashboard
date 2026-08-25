"""Sub-Category CRUD, ownership isolation, and reorder atomicity."""

from __future__ import annotations

import uuid

PREFIX = "/api/v1/tracking"


async def _make_set_and_category(client, set_name="Set", cat_name="Category"):
    set_resp = await client.post(f"{PREFIX}/sets", json={"name": set_name})
    set_id = set_resp.json()["id"]
    cat_resp = await client.post(f"{PREFIX}/sets/{set_id}/categories", json={"name": cat_name})
    return set_id, cat_resp.json()["id"]


async def test_create_sub_category_explicit_order(auth_client):
    _, cat_id = await _make_set_and_category(auth_client, "S1", "C1")
    resp = await auth_client.post(
        f"{PREFIX}/categories/{cat_id}/sub-categories", json={"name": "Sub A", "order": 7}
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "Sub A"
    assert body["order"] == 7
    assert body["categoryId"] == cat_id


async def test_create_sub_category_default_order(auth_client):
    _, cat_id = await _make_set_and_category(auth_client, "S2", "C2")
    first = await auth_client.post(f"{PREFIX}/categories/{cat_id}/sub-categories", json={"name": "S1"})
    second = await auth_client.post(f"{PREFIX}/categories/{cat_id}/sub-categories", json={"name": "S2"})
    assert first.json()["order"] == 1
    assert second.json()["order"] == 2


async def test_create_sub_category_on_nonexistent_category_returns_404(auth_client):
    resp = await auth_client.post(
        f"{PREFIX}/categories/{uuid.uuid4()}/sub-categories", json={"name": "Orphan"}
    )
    assert resp.status_code == 404


async def test_list_sub_categories_ordered(auth_client):
    _, cat_id = await _make_set_and_category(auth_client, "S3", "C3")
    await auth_client.post(f"{PREFIX}/categories/{cat_id}/sub-categories", json={"name": "First", "order": 2})
    await auth_client.post(f"{PREFIX}/categories/{cat_id}/sub-categories", json={"name": "Second", "order": 1})

    resp = await auth_client.get(f"{PREFIX}/categories/{cat_id}/sub-categories")
    assert [s["name"] for s in resp.json()] == ["Second", "First"]


async def test_get_update_delete_sub_category(auth_client):
    _, cat_id = await _make_set_and_category(auth_client, "S4", "C4")
    create = await auth_client.post(
        f"{PREFIX}/categories/{cat_id}/sub-categories", json={"name": "Temp Sub"}
    )
    sub_id = create.json()["id"]

    get_resp = await auth_client.get(f"{PREFIX}/sub-categories/{sub_id}")
    assert get_resp.status_code == 200

    upd = await auth_client.put(f"{PREFIX}/sub-categories/{sub_id}", json={"name": "Renamed Sub"})
    assert upd.status_code == 200
    assert upd.json()["name"] == "Renamed Sub"

    delete_resp = await auth_client.delete(f"{PREFIX}/sub-categories/{sub_id}")
    assert delete_resp.status_code == 204

    gone = await auth_client.get(f"{PREFIX}/sub-categories/{sub_id}")
    assert gone.status_code == 404


async def test_sub_category_not_found_returns_404(auth_client):
    resp = await auth_client.get(f"{PREFIX}/sub-categories/{uuid.uuid4()}")
    assert resp.status_code == 404


# ── Ownership isolation ───────────────────────────────────────────────────────

async def test_cross_user_sub_category_access_returns_404(auth_client, auth_client_b):
    _, cat_id = await _make_set_and_category(auth_client, "Priv Set", "Priv Cat")
    create = await auth_client.post(
        f"{PREFIX}/categories/{cat_id}/sub-categories", json={"name": "Private Sub"}
    )
    sub_id = create.json()["id"]

    assert (await auth_client_b.get(f"{PREFIX}/sub-categories/{sub_id}")).status_code == 404
    assert (
        await auth_client_b.put(f"{PREFIX}/sub-categories/{sub_id}", json={"name": "x"})
    ).status_code == 404
    assert (await auth_client_b.delete(f"{PREFIX}/sub-categories/{sub_id}")).status_code == 404


async def test_cross_user_cannot_list_sub_categories_of_others_category(auth_client, auth_client_b):
    _, cat_id = await _make_set_and_category(auth_client, "Hidden Set 2", "Hidden Cat")
    resp = await auth_client_b.get(f"{PREFIX}/categories/{cat_id}/sub-categories")
    assert resp.status_code == 404


# ── Reorder atomicity ──────────────────────────────────────────────────────────

async def test_reorder_sub_categories_atomic(auth_client):
    _, cat_id = await _make_set_and_category(auth_client, "Reorder Set 2", "Reorder Cat")
    a = (await auth_client.post(f"{PREFIX}/categories/{cat_id}/sub-categories", json={"name": "A"})).json()
    b = (await auth_client.post(f"{PREFIX}/categories/{cat_id}/sub-categories", json={"name": "B"})).json()

    resp = await auth_client.put(
        f"{PREFIX}/categories/{cat_id}/sub-categories/reorder",
        json={"items": [{"id": a["id"], "order": 9}, {"id": b["id"], "order": 1}]},
    )
    assert resp.status_code == 200

    after = (await auth_client.get(f"{PREFIX}/categories/{cat_id}/sub-categories")).json()
    assert [s["name"] for s in after] == ["B", "A"]


async def test_reorder_sub_categories_rejects_foreign_id(auth_client, auth_client_b):
    _, cat_id = await _make_set_and_category(auth_client, "Guard Set", "Guard Cat")
    _, other_cat_id = await _make_set_and_category(auth_client_b, "Other Set", "Other Cat")
    other_sub = (
        await auth_client_b.post(
            f"{PREFIX}/categories/{other_cat_id}/sub-categories", json={"name": "Other Sub"}
        )
    ).json()

    resp = await auth_client.put(
        f"{PREFIX}/categories/{cat_id}/sub-categories/reorder",
        json={"items": [{"id": other_sub["id"], "order": 1}]},
    )
    assert resp.status_code == 400
