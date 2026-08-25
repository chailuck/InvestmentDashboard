"""Tracking Item CRUD, type-enum validation, ownership isolation, and reorder."""

from __future__ import annotations

import uuid

import pytest

from app.models.tracking_item import TRACKING_ITEM_TYPES

PREFIX = "/api/v1/tracking"


async def _make_sub_category(client, set_name="Set", cat_name="Cat", sub_name="Sub"):
    set_id = (await client.post(f"{PREFIX}/sets", json={"name": set_name})).json()["id"]
    cat_id = (
        await client.post(f"{PREFIX}/sets/{set_id}/categories", json={"name": cat_name})
    ).json()["id"]
    sub_id = (
        await client.post(f"{PREFIX}/categories/{cat_id}/sub-categories", json={"name": sub_name})
    ).json()["id"]
    return sub_id


@pytest.mark.parametrize("item_type", TRACKING_ITEM_TYPES)
async def test_create_tracking_item_accepts_all_valid_types(auth_client, item_type):
    sub_id = await _make_sub_category(auth_client, f"S-{item_type}", f"C-{item_type}", f"Sub-{item_type}")
    resp = await auth_client.post(
        f"{PREFIX}/sub-categories/{sub_id}/items", json={"name": "Item", "type": item_type}
    )
    assert resp.status_code == 201
    assert resp.json()["type"] == item_type


async def test_create_tracking_item_rejects_bogus_type_with_400(auth_client):
    sub_id = await _make_sub_category(auth_client, "S-bogus", "C-bogus", "Sub-bogus")
    resp = await auth_client.post(
        f"{PREFIX}/sub-categories/{sub_id}/items",
        json={"name": "Bad Item", "type": "Cryptocurrency"},  # 7th, invalid value
    )
    assert resp.status_code in (400, 422)  # Pydantic validation -> 422


async def test_create_tracking_item_full_fields(auth_client):
    sub_id = await _make_sub_category(auth_client, "S-full", "C-full", "Sub-full")
    resp = await auth_client.post(
        f"{PREFIX}/sub-categories/{sub_id}/items",
        json={
            "name": "Savings",
            "type": "Bank account",
            "initialInvestmentTracking": True,
            "exclusive": True,
            "description": "main savings",
            "accountName": "1234567890",
            "remark": "note",
        },
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["initialInvestmentTracking"] is True
    assert body["exclusive"] is True
    assert body["accountName"] == "1234567890"
    assert body["subCategoryId"] == sub_id


async def test_create_tracking_item_on_nonexistent_sub_category_returns_404(auth_client):
    resp = await auth_client.post(
        f"{PREFIX}/sub-categories/{uuid.uuid4()}/items",
        json={"name": "Orphan", "type": "Property"},
    )
    assert resp.status_code == 404


async def test_get_update_delete_tracking_item(auth_client):
    sub_id = await _make_sub_category(auth_client, "S-crud", "C-crud", "Sub-crud")
    create = await auth_client.post(
        f"{PREFIX}/sub-categories/{sub_id}/items", json={"name": "Temp Item", "type": "Materials"}
    )
    item_id = create.json()["id"]

    get_resp = await auth_client.get(f"{PREFIX}/items/{item_id}")
    assert get_resp.status_code == 200

    upd = await auth_client.put(f"{PREFIX}/items/{item_id}", json={"remark": "updated remark"})
    assert upd.status_code == 200
    assert upd.json()["remark"] == "updated remark"
    assert upd.json()["type"] == "Materials"  # untouched

    upd_type = await auth_client.put(f"{PREFIX}/items/{item_id}", json={"type": "Insurance"})
    assert upd_type.status_code == 200
    assert upd_type.json()["type"] == "Insurance"

    bad_type = await auth_client.put(f"{PREFIX}/items/{item_id}", json={"type": "NotAType"})
    assert bad_type.status_code == 422

    delete_resp = await auth_client.delete(f"{PREFIX}/items/{item_id}")
    assert delete_resp.status_code == 204

    gone = await auth_client.get(f"{PREFIX}/items/{item_id}")
    assert gone.status_code == 404


async def test_tracking_item_not_found_returns_404(auth_client):
    resp = await auth_client.get(f"{PREFIX}/items/{uuid.uuid4()}")
    assert resp.status_code == 404


# ── Ownership isolation ───────────────────────────────────────────────────────

async def test_cross_user_tracking_item_access_returns_404(auth_client, auth_client_b):
    sub_id = await _make_sub_category(auth_client, "Priv Set 3", "Priv Cat 3", "Priv Sub 3")
    create = await auth_client.post(
        f"{PREFIX}/sub-categories/{sub_id}/items", json={"name": "Private Item", "type": "TaxSaving"}
    )
    item_id = create.json()["id"]

    assert (await auth_client_b.get(f"{PREFIX}/items/{item_id}")).status_code == 404
    assert (
        await auth_client_b.put(f"{PREFIX}/items/{item_id}", json={"name": "x"})
    ).status_code == 404
    assert (await auth_client_b.delete(f"{PREFIX}/items/{item_id}")).status_code == 404


async def test_cross_user_cannot_list_items_of_others_sub_category(auth_client, auth_client_b):
    sub_id = await _make_sub_category(auth_client, "Hidden Set 3", "Hidden Cat 3", "Hidden Sub 3")
    resp = await auth_client_b.get(f"{PREFIX}/sub-categories/{sub_id}/items")
    assert resp.status_code == 404


# ── Reorder ────────────────────────────────────────────────────────────────────

async def test_reorder_tracking_items_atomic(auth_client):
    sub_id = await _make_sub_category(auth_client, "Reorder Set 3", "Reorder Cat 3", "Reorder Sub 3")
    a = (
        await auth_client.post(
            f"{PREFIX}/sub-categories/{sub_id}/items", json={"name": "A", "type": "Property"}
        )
    ).json()
    b = (
        await auth_client.post(
            f"{PREFIX}/sub-categories/{sub_id}/items", json={"name": "B", "type": "Property"}
        )
    ).json()

    resp = await auth_client.put(
        f"{PREFIX}/sub-categories/{sub_id}/items/reorder",
        json={"items": [{"id": a["id"], "order": 9}, {"id": b["id"], "order": 1}]},
    )
    assert resp.status_code == 200

    after = (await auth_client.get(f"{PREFIX}/sub-categories/{sub_id}/items")).json()
    assert [i["name"] for i in after] == ["B", "A"]


async def test_reorder_tracking_items_rejects_foreign_id(auth_client, auth_client_b):
    sub_id = await _make_sub_category(auth_client, "Guard Set 2", "Guard Cat 2", "Guard Sub 2")
    other_sub_id = await _make_sub_category(auth_client_b, "Other Set 2", "Other Cat 2", "Other Sub 2")
    other_item = (
        await auth_client_b.post(
            f"{PREFIX}/sub-categories/{other_sub_id}/items", json={"name": "Foreign", "type": "Property"}
        )
    ).json()

    resp = await auth_client.put(
        f"{PREFIX}/sub-categories/{sub_id}/items/reorder",
        json={"items": [{"id": other_item["id"], "order": 1}]},
    )
    assert resp.status_code == 400
