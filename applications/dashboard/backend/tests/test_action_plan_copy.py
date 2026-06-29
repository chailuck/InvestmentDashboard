"""Tests for POST /action-plans/{plan_id}/items/{item_id}/copy endpoint.

Test cases
----------
TC-COPY-BE-01: Happy path — copy succeeds, response has id and sort_order
TC-COPY-BE-02: Same-plan copy returns 400
TC-COPY-BE-03: Source item not found returns 404
TC-COPY-BE-04: Target plan not found returns 404
TC-COPY-BE-05: Source item belongs to different user returns 404
TC-COPY-BE-06: Target plan belongs to different user returns 404
TC-COPY-BE-07: Target plan is portfolio type returns 400
TC-COPY-BE-08: Empty target plan gets sort_order = 0
TC-COPY-BE-09: Non-empty target plan gets sort_order = MAX + 1
TC-COPY-BE-10: triggered=True on source is reset to False in copy
TC-COPY-BE-11: Unauthenticated request returns 401
TC-COPY-BE-12: Null fields on source are preserved as null in copy
"""

from __future__ import annotations

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


async def _put_items(client: AsyncClient, plan_id: str, items: list[dict]) -> None:
    """Replace all items on a plan using PUT."""
    resp = await client.put(
        f"/api/v1/action-plans/{plan_id}",
        json={"purchase_items": items},
    )
    assert resp.status_code == 200, resp.text


async def _get_item_id(client: AsyncClient, plan_id: str, index: int = 0) -> str:
    """Fetch a plan and return the UUID of the item at the given index."""
    resp = await client.get(f"/api/v1/action-plans/{plan_id}")
    assert resp.status_code == 200, resp.text
    items = resp.json()["purchase_items"]
    assert len(items) > index, f"Expected at least {index + 1} items, got {len(items)}"
    return items[index]["id"]


_SAMPLE_ITEM = {
    "sort_order": 0,
    "stock": "BH",
    "current_price": 121.5,
    "size": 100,
    "buy_price": 120.0,
    "tp": 130.0,
    "sl": 115.0,
    "strategy": "BREAK OUT",
    "reason": "test reason",
    "triggered": True,
}


# ── TC-COPY-BE-01: Happy path ─────────────────────────────────────────────────

async def test_copy_item_happy_path(auth_client: AsyncClient):
    """TC-COPY-BE-01: Copy succeeds; response has id and sort_order; copied item in target."""
    plan_a = await _create_plan(auth_client, name="Source A")
    plan_b = await _create_plan(auth_client, name="Target B")

    await _put_items(auth_client, plan_a["id"], [_SAMPLE_ITEM])
    item_id = await _get_item_id(auth_client, plan_a["id"])

    resp = await auth_client.post(
        f"/api/v1/action-plans/{plan_a['id']}/items/{item_id}/copy",
        json={"target_plan_id": plan_b["id"]},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert "id" in body
    assert "sort_order" in body
    # New id must differ from source item id
    assert body["id"] != item_id

    # Verify item is now in target plan
    detail = await auth_client.get(f"/api/v1/action-plans/{plan_b['id']}")
    assert detail.status_code == 200
    items = detail.json()["purchase_items"]
    assert len(items) == 1
    copied = items[0]
    assert copied["stock"] == "BH"
    assert copied["buy_price"] == 120.0
    assert copied["size"] == 100
    assert copied["tp"] == 130.0
    assert copied["sl"] == 115.0
    assert copied["strategy"] == "BREAK OUT"
    assert copied["reason"] == "test reason"
    assert copied["current_price"] == 121.5
    assert copied["triggered"] is False  # must be reset

    # Source plan item must be unchanged
    src_detail = await auth_client.get(f"/api/v1/action-plans/{plan_a['id']}")
    src_items = src_detail.json()["purchase_items"]
    assert len(src_items) == 1
    assert src_items[0]["triggered"] is True  # original preserved


# ── TC-COPY-BE-02: Same-plan copy returns 400 ─────────────────────────────────

async def test_copy_item_same_plan_returns_400(auth_client: AsyncClient):
    """TC-COPY-BE-02: Copying an item to the same plan returns HTTP 400."""
    plan_a = await _create_plan(auth_client, name="Plan Same")
    await _put_items(auth_client, plan_a["id"], [_SAMPLE_ITEM])
    item_id = await _get_item_id(auth_client, plan_a["id"])

    resp = await auth_client.post(
        f"/api/v1/action-plans/{plan_a['id']}/items/{item_id}/copy",
        json={"target_plan_id": plan_a["id"]},
    )
    assert resp.status_code == 400, resp.text
    assert "same plan" in resp.json().get("detail", "").lower()


# ── TC-COPY-BE-03: Source item not found returns 404 ─────────────────────────

async def test_copy_item_source_not_found_returns_404(auth_client: AsyncClient):
    """TC-COPY-BE-03: Non-existent source item_id returns HTTP 404."""
    plan_a = await _create_plan(auth_client, name="Source 404A")
    plan_b = await _create_plan(auth_client, name="Target 404B")
    random_item_id = str(uuid.uuid4())

    resp = await auth_client.post(
        f"/api/v1/action-plans/{plan_a['id']}/items/{random_item_id}/copy",
        json={"target_plan_id": plan_b["id"]},
    )
    assert resp.status_code == 404, resp.text
    assert "not found" in resp.json().get("detail", "").lower()


# ── TC-COPY-BE-04: Target plan not found returns 404 ─────────────────────────

async def test_copy_item_target_not_found_returns_404(auth_client: AsyncClient):
    """TC-COPY-BE-04: Non-existent target_plan_id returns HTTP 404."""
    plan_a = await _create_plan(auth_client, name="Source TgtNF")
    await _put_items(auth_client, plan_a["id"], [_SAMPLE_ITEM])
    item_id = await _get_item_id(auth_client, plan_a["id"])
    random_plan_id = str(uuid.uuid4())

    resp = await auth_client.post(
        f"/api/v1/action-plans/{plan_a['id']}/items/{item_id}/copy",
        json={"target_plan_id": random_plan_id},
    )
    assert resp.status_code == 404, resp.text


# ── TC-COPY-BE-05: Source item owned by different user returns 404 ────────────

async def test_copy_item_cross_user_source_returns_404(
    auth_client: AsyncClient,
    auth_client_b: AsyncClient,
):
    """TC-COPY-BE-05: User B cannot copy User A's item (source owned by A)."""
    # User A creates the source plan + item
    plan_a = await _create_plan(auth_client, name="A Source XU")
    await _put_items(auth_client, plan_a["id"], [_SAMPLE_ITEM])
    item_id = await _get_item_id(auth_client, plan_a["id"])

    # User B creates a target plan
    plan_b = await _create_plan(auth_client_b, name="B Target XU")

    # User B tries to copy User A's item — should 404
    resp = await auth_client_b.post(
        f"/api/v1/action-plans/{plan_a['id']}/items/{item_id}/copy",
        json={"target_plan_id": plan_b["id"]},
    )
    assert resp.status_code == 404, resp.text

    # Target plan must remain empty
    detail = await auth_client_b.get(f"/api/v1/action-plans/{plan_b['id']}")
    assert len(detail.json()["purchase_items"]) == 0


# ── TC-COPY-BE-06: Target plan owned by different user returns 404 ────────────

async def test_copy_item_cross_user_target_returns_404(
    auth_client: AsyncClient,
    auth_client_b: AsyncClient,
):
    """TC-COPY-BE-06: User A cannot copy into User B's plan (target owned by B)."""
    # User A creates source plan + item
    plan_a_src = await _create_plan(auth_client, name="A Src XU2")
    await _put_items(auth_client, plan_a_src["id"], [_SAMPLE_ITEM])
    item_id = await _get_item_id(auth_client, plan_a_src["id"])

    # User B creates the target plan
    plan_b_tgt = await _create_plan(auth_client_b, name="B Tgt XU2")

    # User A tries to copy into User B's plan — should 404
    resp = await auth_client.post(
        f"/api/v1/action-plans/{plan_a_src['id']}/items/{item_id}/copy",
        json={"target_plan_id": plan_b_tgt["id"]},
    )
    assert resp.status_code == 404, resp.text

    # User B's target must remain empty
    detail = await auth_client_b.get(f"/api/v1/action-plans/{plan_b_tgt['id']}")
    assert len(detail.json()["purchase_items"]) == 0


# ── TC-COPY-BE-07: Target plan is portfolio type returns 400 ──────────────────

async def test_copy_item_to_portfolio_plan_returns_400(auth_client: AsyncClient):
    """TC-COPY-BE-07: Copying to a portfolio-type plan returns HTTP 400."""
    plan_a = await _create_plan(auth_client, plan_type="purchase", name="Src Portfolio")
    plan_b = await _create_plan(auth_client, plan_type="portfolio", name="Tgt Portfolio")
    await _put_items(auth_client, plan_a["id"], [_SAMPLE_ITEM])
    item_id = await _get_item_id(auth_client, plan_a["id"])

    resp = await auth_client.post(
        f"/api/v1/action-plans/{plan_a['id']}/items/{item_id}/copy",
        json={"target_plan_id": plan_b["id"]},
    )
    assert resp.status_code == 400, resp.text
    assert "purchase plan" in resp.json().get("detail", "").lower()


# ── TC-COPY-BE-08: Empty target plan gets sort_order = 0 ─────────────────────

async def test_copy_item_to_empty_plan_gets_sort_order_zero(auth_client: AsyncClient):
    """TC-COPY-BE-08: COALESCE(MAX,-1)+1 yields 0 when target plan is empty."""
    plan_a = await _create_plan(auth_client, name="Src SortZero")
    plan_b = await _create_plan(auth_client, name="Tgt SortZero Empty")
    await _put_items(auth_client, plan_a["id"], [_SAMPLE_ITEM])
    item_id = await _get_item_id(auth_client, plan_a["id"])

    resp = await auth_client.post(
        f"/api/v1/action-plans/{plan_a['id']}/items/{item_id}/copy",
        json={"target_plan_id": plan_b["id"]},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["sort_order"] == 0

    detail = await auth_client.get(f"/api/v1/action-plans/{plan_b['id']}")
    assert detail.json()["purchase_items"][0]["sort_order"] == 0


# ── TC-COPY-BE-09: Non-empty target plan gets sort_order = MAX + 1 ────────────

async def test_copy_item_to_non_empty_plan_appended(auth_client: AsyncClient):
    """TC-COPY-BE-09: Copied item gets sort_order = MAX(existing) + 1."""
    plan_a = await _create_plan(auth_client, name="Src SortMax")
    plan_b = await _create_plan(auth_client, name="Tgt SortMax NonEmpty")

    # Put 3 items in target plan
    existing_items = [
        {**_SAMPLE_ITEM, "sort_order": i, "stock": f"SYM{i}"}
        for i in range(3)
    ]
    await _put_items(auth_client, plan_b["id"], existing_items)

    # Source item
    await _put_items(auth_client, plan_a["id"], [_SAMPLE_ITEM])
    item_id = await _get_item_id(auth_client, plan_a["id"])

    resp = await auth_client.post(
        f"/api/v1/action-plans/{plan_a['id']}/items/{item_id}/copy",
        json={"target_plan_id": plan_b["id"]},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["sort_order"] == 3  # MAX was 2, +1 = 3

    detail = await auth_client.get(f"/api/v1/action-plans/{plan_b['id']}")
    items = detail.json()["purchase_items"]
    # Original 3 items still present
    assert len(items) == 4
    # Find the appended item by id
    new_id = resp.json()["id"]
    new_item = next(i for i in items if i["id"] == new_id)
    assert new_item["sort_order"] == 3
    assert new_item["stock"] == "BH"


# ── TC-COPY-BE-10: triggered=True reset to False ──────────────────────────────

async def test_copy_item_triggered_reset_to_false(auth_client: AsyncClient):
    """TC-COPY-BE-10: Source item with triggered=True arrives as triggered=False in copy."""
    plan_a = await _create_plan(auth_client, name="Src Triggered")
    plan_b = await _create_plan(auth_client, name="Tgt Triggered")

    triggered_item = {**_SAMPLE_ITEM, "triggered": True}
    await _put_items(auth_client, plan_a["id"], [triggered_item])
    item_id = await _get_item_id(auth_client, plan_a["id"])

    resp = await auth_client.post(
        f"/api/v1/action-plans/{plan_a['id']}/items/{item_id}/copy",
        json={"target_plan_id": plan_b["id"]},
    )
    assert resp.status_code == 201, resp.text

    detail = await auth_client.get(f"/api/v1/action-plans/{plan_b['id']}")
    copied = detail.json()["purchase_items"][0]
    assert copied["triggered"] is False

    # Source item must still have triggered=True
    src_detail = await auth_client.get(f"/api/v1/action-plans/{plan_a['id']}")
    assert src_detail.json()["purchase_items"][0]["triggered"] is True


# ── TC-COPY-BE-11: Unauthenticated request returns 401 ───────────────────────

async def test_copy_item_requires_auth(client: AsyncClient, auth_client: AsyncClient):
    """TC-COPY-BE-11: No JWT token → 401 before handler executes."""
    plan_a = await _create_plan(auth_client, name="Src Auth")
    plan_b = await _create_plan(auth_client, name="Tgt Auth")
    await _put_items(auth_client, plan_a["id"], [_SAMPLE_ITEM])
    item_id = await _get_item_id(auth_client, plan_a["id"])

    resp = await client.post(
        f"/api/v1/action-plans/{plan_a['id']}/items/{item_id}/copy",
        json={"target_plan_id": plan_b["id"]},
    )
    assert resp.status_code == 401, resp.text


# ── TC-COPY-BE-12: Null fields preserved as null in copy ─────────────────────

async def test_copy_item_null_fields_preserved(auth_client: AsyncClient):
    """TC-COPY-BE-12: Item with all-null optional fields copies without coercion."""
    plan_a = await _create_plan(auth_client, name="Src Nulls")
    plan_b = await _create_plan(auth_client, name="Tgt Nulls")

    null_item = {
        "sort_order": 0,
        "stock": "PTT",
        "current_price": None,
        "size": None,
        "buy_price": None,
        "tp": None,
        "sl": None,
        "strategy": None,
        "reason": None,
        "triggered": False,
    }
    await _put_items(auth_client, plan_a["id"], [null_item])
    item_id = await _get_item_id(auth_client, plan_a["id"])

    resp = await auth_client.post(
        f"/api/v1/action-plans/{plan_a['id']}/items/{item_id}/copy",
        json={"target_plan_id": plan_b["id"]},
    )
    assert resp.status_code == 201, resp.text

    detail = await auth_client.get(f"/api/v1/action-plans/{plan_b['id']}")
    copied = detail.json()["purchase_items"][0]
    assert copied["stock"] == "PTT"
    assert copied["current_price"] is None
    assert copied["size"] is None
    assert copied["buy_price"] is None
    assert copied["tp"] is None
    assert copied["sl"] is None
    assert copied["strategy"] is None
    assert copied["reason"] is None
    assert copied["triggered"] is False
