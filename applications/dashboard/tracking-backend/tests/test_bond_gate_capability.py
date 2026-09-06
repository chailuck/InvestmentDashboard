"""Bond register capability gate (ADR-027 §E.8).

The bond routes are gated by the item's type carrying the `bond_register`
capability, not the literal string `"BOND"`. This proves:
  - a type WITHOUT `bond_register` -> 400 (raised AFTER the ownership check,
    so a cross-user id is still 404, never 400)
  - the system bond type (WITH `bond_register`) -> 200 / 201
  - renaming the bond type via the admin API does NOT break the gate
    (backward-compatibility acceptance criterion)
"""

from __future__ import annotations

import uuid

from app.models.item_type import SYSTEM_ITEM_TYPE_IDS

PREFIX = "/api/v1/tracking"
BOND_TYPE_ID = SYSTEM_ITEM_TYPE_IDS["BOND"]

_BOND_PAYLOAD = {"code": "TH0623A", "amount": "100000.0000"}


async def _make_item(client, type_id: str, name: str = "I") -> str:
    set_id = (await client.post(f"{PREFIX}/sets", json={"name": f"S-{uuid.uuid4()}"})).json()["id"]
    cat_id = (
        await client.post(f"{PREFIX}/sets/{set_id}/categories", json={"name": "C"})
    ).json()["id"]
    sub_id = (
        await client.post(f"{PREFIX}/categories/{cat_id}/sub-categories", json={"name": "Sub"})
    ).json()["id"]
    resp = await client.post(
        f"{PREFIX}/sub-categories/{sub_id}/items", json={"name": name, "typeId": type_id}
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def test_non_bond_capability_type_is_400_on_every_bond_route(auth_client):
    item_id = await _make_item(auth_client, SYSTEM_ITEM_TYPE_IDS["Investment Account"])
    assert (await auth_client.get(f"{PREFIX}/items/{item_id}/bonds")).status_code == 400
    resp = await auth_client.post(f"{PREFIX}/items/{item_id}/bonds", json=_BOND_PAYLOAD)
    assert resp.status_code == 400
    assert "BOND" not in resp.json()["detail"]  # message no longer names the literal


async def test_bond_capability_type_allows_the_register(auth_client):
    item_id = await _make_item(auth_client, BOND_TYPE_ID)
    created = await auth_client.post(f"{PREFIX}/items/{item_id}/bonds", json=_BOND_PAYLOAD)
    assert created.status_code == 201, created.text
    listed = await auth_client.get(f"{PREFIX}/items/{item_id}/bonds")
    assert listed.status_code == 200
    assert len(listed.json()) == 1


async def test_ownership_check_wins_over_capability_gate(auth_client, auth_client_b):
    """A cross-user item id is 404 (ownership), never 400 (capability) — the
    gate runs strictly after `_get_item_or_404`."""
    item_id = await _make_item(auth_client, SYSTEM_ITEM_TYPE_IDS["Investment Account"])
    assert (await auth_client_b.get(f"{PREFIX}/items/{item_id}/bonds")).status_code == 404
    assert (
        await auth_client_b.post(f"{PREFIX}/items/{item_id}/bonds", json=_BOND_PAYLOAD)
    ).status_code == 404


async def test_gate_survives_bond_type_rename(auth_client, admin_client):
    item_id = await _make_item(auth_client, BOND_TYPE_ID)
    rename = await admin_client.put(
        f"{PREFIX}/item-types/{BOND_TYPE_ID}", json={"label": "Government Bond"}
    )
    assert rename.status_code == 200, rename.text
    try:
        created = await auth_client.post(f"{PREFIX}/items/{item_id}/bonds", json=_BOND_PAYLOAD)
        assert created.status_code == 201, created.text  # capability, not label, gates the route

        # A newly created item of the (renamed) bond type still passes the gate.
        item2 = await _make_item(auth_client, BOND_TYPE_ID, name="I2")
        assert (
            await auth_client.post(f"{PREFIX}/items/{item2}/bonds", json=_BOND_PAYLOAD)
        ).status_code == 201
    finally:
        restore = await admin_client.put(
            f"{PREFIX}/item-types/{BOND_TYPE_ID}", json={"label": "BOND"}
        )
        assert restore.status_code == 200, restore.text
