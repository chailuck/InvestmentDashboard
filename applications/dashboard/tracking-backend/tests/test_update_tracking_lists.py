"""Update Tracking List CRUD (Phase 2), bulk balance upsert (validate-before-
write, update-in-place, explicit-null clear, omitted-item untouched),
detail-endpoint hierarchy completeness, read-time delta computation
correctness, and ownership isolation."""

from __future__ import annotations

import datetime as dt
import uuid
from decimal import Decimal
from unittest.mock import patch

from sqlalchemy import select

from app.api.v1.endpoints import update_tracking_lists as update_tracking_lists_module
from app.models.update_tracking_list import UpdateTrackingList
from app.models.update_tracking_list_balance import UpdateTrackingListBalance
from app.services.update_tracking import get_update_list_detail

PREFIX = "/api/v1/tracking"


# ── Helpers ───────────────────────────────────────────────────────────────────


async def _make_set(client, name: str | None = None) -> str:
    resp = await client.post(f"{PREFIX}/sets", json={"name": name or f"Set-{uuid.uuid4()}"})
    return resp.json()["id"]


async def _current_assets_sub_id(client, set_id: str) -> str:
    cats = (await client.get(f"{PREFIX}/sets/{set_id}/categories")).json()
    assets = next(c for c in cats if c["name"] == "Assets")
    subs = (await client.get(f"{PREFIX}/categories/{assets['id']}/sub-categories")).json()
    current_assets = next(s for s in subs if s["name"] == "Current Assets")
    return current_assets["id"]


async def _make_item(client, sub_id: str, name: str = "Item", item_type: str = "Bank account") -> str:
    resp = await client.post(
        f"{PREFIX}/sub-categories/{sub_id}/items", json={"name": name, "type": item_type}
    )
    return resp.json()["id"]


async def _make_set_with_item(client, name: str | None = None, item_name: str = "Item"):
    """Returns (set_id, current_assets_sub_id, item_id)."""
    set_id = await _make_set(client, name)
    sub_id = await _current_assets_sub_id(client, set_id)
    item_id = await _make_item(client, sub_id, name=item_name)
    return set_id, sub_id, item_id


async def _make_list(
    client,
    set_id: str,
    transaction_date: str = "2026-01-01",
    quarter: int | None = None,
    year: int | None = None,
) -> str:
    body: dict = {"transactionDate": transaction_date}
    if quarter is not None:
        body["quarter"] = quarter
    if year is not None:
        body["year"] = year
    resp = await client.post(f"{PREFIX}/sets/{set_id}/update-lists", json=body)
    return resp.json()["id"]


def _find_item(detail: dict, item_id: str) -> dict:
    for cat in detail["categories"]:
        for sub in cat["subCategories"]:
            for item in sub["items"]:
                if item["id"] == item_id:
                    return item
    raise AssertionError(f"item {item_id} not found in detail response: {detail}")


async def _set_balance(client, list_id: str, item_id: str, balance) -> None:
    resp = await client.put(
        f"{PREFIX}/update-lists/{list_id}/balances",
        json={"balances": [{"trackingItemId": item_id, "balance": balance}]},
    )
    assert resp.status_code == 200, resp.text


# ── Header CRUD ────────────────────────────────────────────────────────────────


async def test_create_update_tracking_list_returns_201(auth_client):
    set_id, _, _ = await _make_set_with_item(auth_client)
    resp = await auth_client.post(
        f"{PREFIX}/sets/{set_id}/update-lists",
        json={"transactionDate": "2026-01-15", "quarter": 1, "year": 2026},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["trackingSetId"] == set_id
    assert body["transactionDate"] == "2026-01-15"
    assert body["quarter"] == 1
    assert body["year"] == 2026
    assert "id" in body and "createdAt" in body and "updatedAt" in body


async def test_create_update_tracking_list_without_quarter_or_year(auth_client):
    set_id, _, _ = await _make_set_with_item(auth_client)
    resp = await auth_client.post(
        f"{PREFIX}/sets/{set_id}/update-lists", json={"transactionDate": "2026-01-15"}
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["quarter"] is None
    assert body["year"] is None


async def test_create_update_tracking_list_with_only_quarter(auth_client):
    set_id, _, _ = await _make_set_with_item(auth_client)
    resp = await auth_client.post(
        f"{PREFIX}/sets/{set_id}/update-lists",
        json={"transactionDate": "2026-01-15", "quarter": 3},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["quarter"] == 3
    assert body["year"] is None


async def test_create_update_tracking_list_with_only_year(auth_client):
    set_id, _, _ = await _make_set_with_item(auth_client)
    resp = await auth_client.post(
        f"{PREFIX}/sets/{set_id}/update-lists",
        json={"transactionDate": "2026-01-15", "year": 2027},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["quarter"] is None
    assert body["year"] == 2027


async def test_create_update_tracking_list_missing_date_returns_422(auth_client):
    set_id, _, _ = await _make_set_with_item(auth_client)
    resp = await auth_client.post(f"{PREFIX}/sets/{set_id}/update-lists", json={})
    assert resp.status_code == 422


async def test_create_update_tracking_list_quarter_zero_returns_422(auth_client):
    set_id, _, _ = await _make_set_with_item(auth_client)
    resp = await auth_client.post(
        f"{PREFIX}/sets/{set_id}/update-lists",
        json={"transactionDate": "2026-01-01", "quarter": 0},
    )
    assert resp.status_code == 422


async def test_create_update_tracking_list_quarter_five_returns_422(auth_client):
    set_id, _, _ = await _make_set_with_item(auth_client)
    resp = await auth_client.post(
        f"{PREFIX}/sets/{set_id}/update-lists",
        json={"transactionDate": "2026-01-01", "quarter": 5},
    )
    assert resp.status_code == 422


async def test_create_update_tracking_list_quarter_non_integer_returns_422(auth_client):
    set_id, _, _ = await _make_set_with_item(auth_client)
    resp = await auth_client.post(
        f"{PREFIX}/sets/{set_id}/update-lists",
        json={"transactionDate": "2026-01-01", "quarter": "Q1"},
    )
    assert resp.status_code == 422


async def test_create_update_tracking_list_year_out_of_range_returns_422(auth_client):
    set_id, _, _ = await _make_set_with_item(auth_client)
    resp = await auth_client.post(
        f"{PREFIX}/sets/{set_id}/update-lists",
        json={"transactionDate": "2026-01-01", "year": 1999},
    )
    assert resp.status_code == 422


async def test_create_update_tracking_list_on_nonexistent_set_returns_404(auth_client):
    resp = await auth_client.post(
        f"{PREFIX}/sets/{uuid.uuid4()}/update-lists", json={"transactionDate": "2026-01-01"}
    )
    assert resp.status_code == 404


async def test_duplicate_transaction_date_allowed(auth_client):
    set_id, _, _ = await _make_set_with_item(auth_client)
    r1 = await auth_client.post(f"{PREFIX}/sets/{set_id}/update-lists", json={"transactionDate": "2026-01-01"})
    r2 = await auth_client.post(f"{PREFIX}/sets/{set_id}/update-lists", json={"transactionDate": "2026-01-01"})
    assert r1.status_code == 201
    assert r2.status_code == 201


async def test_list_update_tracking_lists_ordered_by_date_desc_then_created_desc(auth_client):
    set_id, _, _ = await _make_set_with_item(auth_client)
    await _make_list(auth_client, set_id, "2026-01-01")
    await _make_list(auth_client, set_id, "2026-03-01")
    await _make_list(auth_client, set_id, "2026-02-01")

    resp = await auth_client.get(f"{PREFIX}/sets/{set_id}/update-lists")
    assert resp.status_code == 200
    dates = [row["transactionDate"] for row in resp.json()]
    assert dates == ["2026-03-01", "2026-02-01", "2026-01-01"]


async def test_list_update_tracking_lists_on_nonexistent_set_returns_404(auth_client):
    resp = await auth_client.get(f"{PREFIX}/sets/{uuid.uuid4()}/update-lists")
    assert resp.status_code == 404


async def test_get_nonexistent_update_tracking_list_returns_404(auth_client):
    resp = await auth_client.get(f"{PREFIX}/update-lists/{uuid.uuid4()}")
    assert resp.status_code == 404


async def test_update_update_tracking_list_partial(auth_client):
    set_id, _, _ = await _make_set_with_item(auth_client)
    list_id = await _make_list(auth_client, set_id, "2026-01-01", quarter=1, year=2026)

    resp = await auth_client.put(
        f"{PREFIX}/update-lists/{list_id}", json={"quarter": 2, "year": 2026}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["transactionDate"] == "2026-01-01"  # untouched
    assert body["quarter"] == 2
    assert body["year"] == 2026


async def test_update_update_tracking_list_transaction_date(auth_client):
    set_id, _, _ = await _make_set_with_item(auth_client)
    list_id = await _make_list(auth_client, set_id, "2026-01-01", quarter=1, year=2026)

    resp = await auth_client.put(
        f"{PREFIX}/update-lists/{list_id}", json={"transactionDate": "2026-06-15"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["transactionDate"] == "2026-06-15"
    assert body["quarter"] == 1  # untouched
    assert body["year"] == 2026  # untouched


async def test_update_update_tracking_list_transaction_date_explicit_null_returns_422(auth_client):
    """transaction_date is NOT NULL at the DB layer — unlike quarter/year, an
    explicit null for it is a client error, not a legitimate clear-to-null
    request, and must be rejected before it ever reaches the DB session."""
    set_id, _, _ = await _make_set_with_item(auth_client)
    list_id = await _make_list(auth_client, set_id, "2026-01-01")

    resp = await auth_client.put(f"{PREFIX}/update-lists/{list_id}", json={"transactionDate": None})
    assert resp.status_code == 422

    still_there = await auth_client.get(f"{PREFIX}/update-lists/{list_id}")
    assert still_there.status_code == 200
    assert still_there.json()["transactionDate"] == "2026-01-01"


async def test_update_update_tracking_list_quarter_only_set(auth_client):
    set_id, _, _ = await _make_set_with_item(auth_client)
    list_id = await _make_list(auth_client, set_id)

    resp = await auth_client.put(f"{PREFIX}/update-lists/{list_id}", json={"quarter": 4})
    assert resp.status_code == 200
    body = resp.json()
    assert body["quarter"] == 4
    assert body["year"] is None


async def test_update_update_tracking_list_year_only_set(auth_client):
    set_id, _, _ = await _make_set_with_item(auth_client)
    list_id = await _make_list(auth_client, set_id)

    resp = await auth_client.put(f"{PREFIX}/update-lists/{list_id}", json={"year": 2030})
    assert resp.status_code == 200
    body = resp.json()
    assert body["quarter"] is None
    assert body["year"] == 2030


async def test_update_update_tracking_list_neither_quarter_nor_year_sent_leaves_both_untouched(auth_client):
    set_id, _, _ = await _make_set_with_item(auth_client)
    list_id = await _make_list(auth_client, set_id, "2026-01-01", quarter=2, year=2026)

    resp = await auth_client.put(
        f"{PREFIX}/update-lists/{list_id}", json={"transactionDate": "2026-03-01"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["quarter"] == 2  # untouched — key omitted from the request
    assert body["year"] == 2026  # untouched — key omitted from the request


async def test_update_update_tracking_list_explicit_null_clears_quarter_leaves_year(auth_client):
    """Explicit null must clear quarter independently, without touching year
    — this is the presence-aware fix: exclude_unset distinguishes an
    explicit null from an omitted key, so quarter and year are each
    independently settable/clearable."""
    set_id, _, _ = await _make_set_with_item(auth_client)
    list_id = await _make_list(auth_client, set_id, "2026-01-01", quarter=3, year=2026)

    resp = await auth_client.put(f"{PREFIX}/update-lists/{list_id}", json={"quarter": None})
    assert resp.status_code == 200
    body = resp.json()
    assert body["quarter"] is None
    assert body["year"] == 2026  # untouched


async def test_update_update_tracking_list_explicit_null_clears_year_leaves_quarter(auth_client):
    set_id, _, _ = await _make_set_with_item(auth_client)
    list_id = await _make_list(auth_client, set_id, "2026-01-01", quarter=3, year=2026)

    resp = await auth_client.put(f"{PREFIX}/update-lists/{list_id}", json={"year": None})
    assert resp.status_code == 200
    body = resp.json()
    assert body["quarter"] == 3  # untouched
    assert body["year"] is None


async def test_update_update_tracking_list_explicit_null_clears_both(auth_client):
    set_id, _, _ = await _make_set_with_item(auth_client)
    list_id = await _make_list(auth_client, set_id, "2026-01-01", quarter=3, year=2026)

    resp = await auth_client.put(
        f"{PREFIX}/update-lists/{list_id}", json={"quarter": None, "year": None}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["quarter"] is None
    assert body["year"] is None


async def test_update_update_tracking_list_quarter_out_of_range_returns_422(auth_client):
    set_id, _, _ = await _make_set_with_item(auth_client)
    list_id = await _make_list(auth_client, set_id)

    resp_low = await auth_client.put(f"{PREFIX}/update-lists/{list_id}", json={"quarter": 0})
    assert resp_low.status_code == 422

    resp_high = await auth_client.put(f"{PREFIX}/update-lists/{list_id}", json={"quarter": 5})
    assert resp_high.status_code == 422


async def test_update_update_tracking_list_quarter_non_integer_returns_422(auth_client):
    set_id, _, _ = await _make_set_with_item(auth_client)
    list_id = await _make_list(auth_client, set_id)

    resp = await auth_client.put(f"{PREFIX}/update-lists/{list_id}", json={"quarter": "Q1"})
    assert resp.status_code == 422


async def test_update_update_tracking_list_emits_audit_log(auth_client):
    set_id, _, _ = await _make_set_with_item(auth_client)
    list_id = await _make_list(auth_client, set_id)

    with patch.object(update_tracking_lists_module, "_log") as mock_log:
        resp = await auth_client.put(
            f"{PREFIX}/update-lists/{list_id}", json={"quarter": 2, "year": 2026}
        )
    assert resp.status_code == 200
    mock_log.info.assert_called_once()
    args, kwargs = mock_log.info.call_args
    assert args[0] == "Update tracking list updated"
    assert kwargs["update_tracking_list_id"] == list_id


async def test_delete_update_tracking_list_cascades_balances(auth_client, db_session):
    set_id, _, item_id = await _make_set_with_item(auth_client)
    list_id = await _make_list(auth_client, set_id)
    await _set_balance(auth_client, list_id, item_id, "100.00")

    resp = await auth_client.delete(f"{PREFIX}/update-lists/{list_id}")
    assert resp.status_code == 204

    result = await db_session.execute(
        select(UpdateTrackingListBalance).where(
            UpdateTrackingListBalance.update_tracking_list_id == uuid.UUID(list_id)
        )
    )
    assert result.scalars().all() == []

    get_resp = await auth_client.get(f"{PREFIX}/update-lists/{list_id}")
    assert get_resp.status_code == 404


async def test_delete_nonexistent_update_tracking_list_returns_404(auth_client):
    resp = await auth_client.delete(f"{PREFIX}/update-lists/{uuid.uuid4()}")
    assert resp.status_code == 404


# ── Ownership isolation (404, never 403) ─────────────────────────────────────


async def test_cross_user_get_update_tracking_list_returns_404(auth_client, auth_client_b):
    set_id, _, _ = await _make_set_with_item(auth_client)
    list_id = await _make_list(auth_client, set_id)

    resp = await auth_client_b.get(f"{PREFIX}/update-lists/{list_id}")
    assert resp.status_code == 404


async def test_cross_user_update_update_tracking_list_returns_404(auth_client, auth_client_b):
    set_id, _, _ = await _make_set_with_item(auth_client)
    list_id = await _make_list(auth_client, set_id)

    resp = await auth_client_b.put(
        f"{PREFIX}/update-lists/{list_id}", json={"quarter": 3, "year": 2026}
    )
    assert resp.status_code == 404


async def test_cross_user_delete_update_tracking_list_returns_404(auth_client, auth_client_b):
    set_id, _, _ = await _make_set_with_item(auth_client)
    list_id = await _make_list(auth_client, set_id)

    resp = await auth_client_b.delete(f"{PREFIX}/update-lists/{list_id}")
    assert resp.status_code == 404

    still_there = await auth_client.get(f"{PREFIX}/update-lists/{list_id}")
    assert still_there.status_code == 200


async def test_cross_user_cannot_list_update_tracking_lists_of_others_set(auth_client, auth_client_b):
    set_id, _, _ = await _make_set_with_item(auth_client)
    resp = await auth_client_b.get(f"{PREFIX}/sets/{set_id}/update-lists")
    assert resp.status_code == 404


async def test_cross_user_cannot_read_detail(auth_client, auth_client_b):
    set_id, _, _ = await _make_set_with_item(auth_client)
    list_id = await _make_list(auth_client, set_id)
    resp = await auth_client_b.get(f"{PREFIX}/update-lists/{list_id}/detail")
    assert resp.status_code == 404


async def test_cross_user_cannot_upsert_balances_or_leak_data(auth_client, auth_client_b):
    """User B must not be able to write balances against user A's list, and
    must never receive a 200 that would imply the list exists."""
    set_id, _, item_id = await _make_set_with_item(auth_client)
    list_id = await _make_list(auth_client, set_id)

    resp = await auth_client_b.put(
        f"{PREFIX}/update-lists/{list_id}/balances",
        json={"balances": [{"trackingItemId": item_id, "balance": "1"}]},
    )
    assert resp.status_code == 404
    assert resp.status_code != 200


# ── Bulk balance upsert ──────────────────────────────────────────────────────


async def test_upsert_balances_creates_new_rows(auth_client):
    set_id, _, item_id = await _make_set_with_item(auth_client)
    list_id = await _make_list(auth_client, set_id)

    resp = await auth_client.put(
        f"{PREFIX}/update-lists/{list_id}/balances",
        json={"balances": [{"trackingItemId": item_id, "balance": "1234.5678"}]},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["trackingItemId"] == item_id
    assert body[0]["balance"] == "1234.5678"
    assert body[0]["updateTrackingListId"] == list_id


async def test_upsert_balances_updates_existing_row_not_a_duplicate(auth_client):
    set_id, _, item_id = await _make_set_with_item(auth_client)
    list_id = await _make_list(auth_client, set_id)

    await _set_balance(auth_client, list_id, item_id, "100")
    resp = await auth_client.put(
        f"{PREFIX}/update-lists/{list_id}/balances",
        json={"balances": [{"trackingItemId": item_id, "balance": "200"}]},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["balance"] == "200.0000"

    detail = (await auth_client.get(f"{PREFIX}/update-lists/{list_id}/detail")).json()
    assert _find_item(detail, item_id)["balance"] == "200.0000"


async def test_upsert_balances_explicit_null_clears_value(auth_client):
    set_id, _, item_id = await _make_set_with_item(auth_client)
    list_id = await _make_list(auth_client, set_id)

    await _set_balance(auth_client, list_id, item_id, "500")
    resp = await auth_client.put(
        f"{PREFIX}/update-lists/{list_id}/balances",
        json={"balances": [{"trackingItemId": item_id, "balance": None}]},
    )
    assert resp.status_code == 200
    assert resp.json()[0]["balance"] is None


async def test_upsert_balances_field_omitted_defaults_to_null(auth_client):
    set_id, _, item_id = await _make_set_with_item(auth_client)
    list_id = await _make_list(auth_client, set_id)
    resp = await auth_client.put(
        f"{PREFIX}/update-lists/{list_id}/balances",
        json={"balances": [{"trackingItemId": item_id}]},
    )
    assert resp.status_code == 200
    assert resp.json()[0]["balance"] is None


async def test_upsert_balances_omitted_item_untouched(auth_client):
    set_id, sub_id, item_id = await _make_set_with_item(auth_client)
    item2_id = await _make_item(auth_client, sub_id, name="Item2")
    list_id = await _make_list(auth_client, set_id)

    await auth_client.put(
        f"{PREFIX}/update-lists/{list_id}/balances",
        json={
            "balances": [
                {"trackingItemId": item_id, "balance": "111"},
                {"trackingItemId": item2_id, "balance": "222"},
            ]
        },
    )
    # Second call only touches item_id.
    resp = await auth_client.put(
        f"{PREFIX}/update-lists/{list_id}/balances",
        json={"balances": [{"trackingItemId": item_id, "balance": "999"}]},
    )
    assert resp.status_code == 200

    detail = (await auth_client.get(f"{PREFIX}/update-lists/{list_id}/detail")).json()
    assert _find_item(detail, item_id)["balance"] == "999.0000"
    assert _find_item(detail, item2_id)["balance"] == "222.0000"  # untouched


async def test_upsert_balances_invalid_item_from_different_set_rejects_writes_nothing(auth_client):
    set_id, _, item_id = await _make_set_with_item(auth_client)
    _, _, other_item_id = await _make_set_with_item(auth_client, name="Other Set")
    list_id = await _make_list(auth_client, set_id)

    resp = await auth_client.put(
        f"{PREFIX}/update-lists/{list_id}/balances",
        json={
            "balances": [
                {"trackingItemId": item_id, "balance": "100"},
                {"trackingItemId": other_item_id, "balance": "200"},
            ]
        },
    )
    assert resp.status_code == 400
    assert other_item_id in resp.json()["detail"]

    # Nothing written — not even the otherwise-valid item's row.
    detail = (await auth_client.get(f"{PREFIX}/update-lists/{list_id}/detail")).json()
    assert _find_item(detail, item_id)["balance"] is None


async def test_upsert_balances_nonexistent_item_id_returns_400(auth_client):
    set_id, _, _ = await _make_set_with_item(auth_client)
    list_id = await _make_list(auth_client, set_id)
    resp = await auth_client.put(
        f"{PREFIX}/update-lists/{list_id}/balances",
        json={"balances": [{"trackingItemId": str(uuid.uuid4()), "balance": "1"}]},
    )
    assert resp.status_code == 400


async def test_upsert_balances_on_nonexistent_list_returns_404(auth_client):
    resp = await auth_client.put(
        f"{PREFIX}/update-lists/{uuid.uuid4()}/balances", json={"balances": []}
    )
    assert resp.status_code == 404


async def test_upsert_balances_empty_list_is_noop(auth_client):
    set_id, _, _ = await _make_set_with_item(auth_client)
    list_id = await _make_list(auth_client, set_id)
    resp = await auth_client.put(f"{PREFIX}/update-lists/{list_id}/balances", json={"balances": []})
    assert resp.status_code == 200
    assert resp.json() == []


async def test_upsert_balances_emits_audit_log_once_per_batch(auth_client):
    set_id, sub_id, item_id = await _make_set_with_item(auth_client)
    item2_id = await _make_item(auth_client, sub_id, name="Item2")
    list_id = await _make_list(auth_client, set_id)

    with patch.object(update_tracking_lists_module, "_log") as mock_log:
        resp = await auth_client.put(
            f"{PREFIX}/update-lists/{list_id}/balances",
            json={
                "balances": [
                    {"trackingItemId": item_id, "balance": "1"},
                    {"trackingItemId": item2_id, "balance": "2"},
                ]
            },
        )
    assert resp.status_code == 200
    mock_log.info.assert_called_once()
    args, kwargs = mock_log.info.call_args
    assert args[0] == "Update tracking list balances upserted"
    assert kwargs["count"] == 2


# ── Detail: hierarchy completeness ───────────────────────────────────────────


async def test_detail_response_shape(auth_client):
    set_id, _, item_id = await _make_set_with_item(auth_client)
    list_id = await _make_list(auth_client, set_id, "2026-01-01", quarter=1, year=2026)

    resp = await auth_client.get(f"{PREFIX}/update-lists/{list_id}/detail")
    assert resp.status_code == 200
    body = resp.json()
    assert body["list"]["id"] == list_id
    assert body["previousListId"] is None
    assert len(body["categories"]) == 2  # cascade-created Assets, Liabilities

    assets = next(c for c in body["categories"] if c["name"] == "Assets")
    assert "orderIndex" in assets
    current_assets = next(s for s in assets["subCategories"] if s["name"] == "Current Assets")
    assert "orderIndex" in current_assets
    assert any(i["id"] == item_id for i in current_assets["items"])


async def test_detail_on_nonexistent_list_returns_404(auth_client):
    resp = await auth_client.get(f"{PREFIX}/update-lists/{uuid.uuid4()}/detail")
    assert resp.status_code == 404


async def test_detail_includes_item_added_after_list_creation(auth_client):
    set_id, sub_id, _ = await _make_set_with_item(auth_client)
    list_id = await _make_list(auth_client, set_id)

    # Added to the set AFTER the list header already existed.
    late_item_id = await _make_item(auth_client, sub_id, name="Late Item")

    detail = (await auth_client.get(f"{PREFIX}/update-lists/{list_id}/detail")).json()
    late = _find_item(detail, late_item_id)
    assert late["balance"] is None
    assert late["hasPreviousData"] is False
    assert late["previousBalance"] is None
    assert late["deltaAmount"] is None
    assert late["deltaPercent"] is None


async def test_detail_with_no_categories_returns_empty_categories_list(auth_client):
    set_id, _, _ = await _make_set_with_item(auth_client)
    list_id = await _make_list(auth_client, set_id)

    cats = (await auth_client.get(f"{PREFIX}/sets/{set_id}/categories")).json()
    for c in cats:
        await auth_client.delete(f"{PREFIX}/categories/{c['id']}")

    detail = (await auth_client.get(f"{PREFIX}/update-lists/{list_id}/detail")).json()
    assert detail["categories"] == []


# ── Delta computation ────────────────────────────────────────────────────────


async def test_delta_no_previous_list_all_items_have_no_previous_data(auth_client):
    set_id, _, item_id = await _make_set_with_item(auth_client)
    list_id = await _make_list(auth_client, set_id, "2026-01-01")
    await _set_balance(auth_client, list_id, item_id, "1000")

    detail = (await auth_client.get(f"{PREFIX}/update-lists/{list_id}/detail")).json()
    assert detail["previousListId"] is None
    item = _find_item(detail, item_id)
    assert item["hasPreviousData"] is False
    assert item["previousBalance"] is None
    assert item["deltaAmount"] is None
    assert item["deltaPercent"] is None
    assert item["balance"] == "1000.0000"


async def test_delta_item_absent_from_previous_list_has_no_previous_data(auth_client):
    set_id, sub_id, item1_id = await _make_set_with_item(auth_client)
    older_list_id = await _make_list(auth_client, set_id, "2026-01-01")
    await _set_balance(auth_client, older_list_id, item1_id, "500")

    # item2 didn't exist yet when the older list's balances were captured.
    item2_id = await _make_item(auth_client, sub_id, name="New Item")
    newer_list_id = await _make_list(auth_client, set_id, "2026-02-01")
    await auth_client.put(
        f"{PREFIX}/update-lists/{newer_list_id}/balances",
        json={
            "balances": [
                {"trackingItemId": item1_id, "balance": "600"},
                {"trackingItemId": item2_id, "balance": "50"},
            ]
        },
    )

    detail = (await auth_client.get(f"{PREFIX}/update-lists/{newer_list_id}/detail")).json()
    assert detail["previousListId"] == older_list_id

    item1 = _find_item(detail, item1_id)
    assert item1["hasPreviousData"] is True
    assert item1["previousBalance"] == "500.0000"
    assert item1["deltaAmount"] == "100.0000"

    item2 = _find_item(detail, item2_id)
    assert item2["hasPreviousData"] is False
    assert item2["previousBalance"] is None
    assert item2["deltaAmount"] is None
    assert item2["deltaPercent"] is None


async def test_delta_zero_previous_balance_yields_null_percent_not_error(auth_client):
    set_id, _, item_id = await _make_set_with_item(auth_client)
    older_list_id = await _make_list(auth_client, set_id, "2026-01-01")
    await _set_balance(auth_client, older_list_id, item_id, "0")
    newer_list_id = await _make_list(auth_client, set_id, "2026-02-01")
    await _set_balance(auth_client, newer_list_id, item_id, "150")

    detail = (await auth_client.get(f"{PREFIX}/update-lists/{newer_list_id}/detail")).json()
    item = _find_item(detail, item_id)
    assert item["hasPreviousData"] is True
    assert item["previousBalance"] == "0.0000"
    assert item["deltaAmount"] == "150.0000"  # computable
    assert item["deltaPercent"] is None  # but percent must not divide by zero


async def test_delta_positive_and_negative_math(auth_client):
    set_id, _, item_id = await _make_set_with_item(auth_client)
    older_list_id = await _make_list(auth_client, set_id, "2026-01-01")
    await _set_balance(auth_client, older_list_id, item_id, "1000")
    newer_list_id = await _make_list(auth_client, set_id, "2026-02-01")
    await _set_balance(auth_client, newer_list_id, item_id, "1250")

    detail = (await auth_client.get(f"{PREFIX}/update-lists/{newer_list_id}/detail")).json()
    item = _find_item(detail, item_id)
    assert item["deltaAmount"] == "250.0000"
    assert Decimal(item["deltaPercent"]) == Decimal("25")

    newest_list_id = await _make_list(auth_client, set_id, "2026-03-01")
    await _set_balance(auth_client, newest_list_id, item_id, "1000")

    detail2 = (await auth_client.get(f"{PREFIX}/update-lists/{newest_list_id}/detail")).json()
    item2 = _find_item(detail2, item_id)
    assert item2["deltaAmount"] == "-250.0000"
    assert Decimal(item2["deltaPercent"]) == Decimal("-20")


async def test_delta_reflects_edit_to_older_list_at_read_time_not_cached(auth_client):
    """Proves true read-time computation: editing an OLDER list's balance
    and re-reading a NEWER list's detail must reflect the change."""
    set_id, _, item_id = await _make_set_with_item(auth_client)
    older_list_id = await _make_list(auth_client, set_id, "2026-01-01")
    await _set_balance(auth_client, older_list_id, item_id, "1000")
    newer_list_id = await _make_list(auth_client, set_id, "2026-02-01")
    await _set_balance(auth_client, newer_list_id, item_id, "1200")

    before = (await auth_client.get(f"{PREFIX}/update-lists/{newer_list_id}/detail")).json()
    assert _find_item(before, item_id)["deltaAmount"] == "200.0000"

    await _set_balance(auth_client, older_list_id, item_id, "900")

    after = (await auth_client.get(f"{PREFIX}/update-lists/{newer_list_id}/detail")).json()
    after_item = _find_item(after, item_id)
    assert after_item["previousBalance"] == "900.0000"
    assert after_item["deltaAmount"] == "300.0000"


# ── Delta service — previous-list lookup tiebreak (unit-level, deterministic) ─
#
# These call app.services.update_tracking.get_update_list_detail directly
# against db_session, with created_at set explicitly, rather than relying on
# real wall-clock gaps between HTTP calls — HTTP timing is not a reliable way
# to force two rows into the same-transaction_date / same-created_at
# scenarios the tiebreak logic exists to handle.


async def test_service_previous_list_tiebreak_by_created_at_for_same_date(
    auth_client, db_session, user_a_id
):
    set_id, _, _ = await _make_set_with_item(auth_client)
    uid = uuid.UUID(user_a_id)
    base_dt = dt.datetime(2026, 1, 1, 12, 0, 0, tzinfo=dt.timezone.utc)

    older = UpdateTrackingList(
        user_id=uid, tracking_set_id=uuid.UUID(set_id), transaction_date=dt.date(2026, 1, 1)
    )
    older.created_at = base_dt
    newer_same_date = UpdateTrackingList(
        user_id=uid, tracking_set_id=uuid.UUID(set_id), transaction_date=dt.date(2026, 1, 1)
    )
    newer_same_date.created_at = base_dt + dt.timedelta(seconds=5)
    target = UpdateTrackingList(
        user_id=uid, tracking_set_id=uuid.UUID(set_id), transaction_date=dt.date(2026, 1, 2)
    )
    db_session.add_all([older, newer_same_date, target])
    await db_session.commit()

    detail = await get_update_list_detail(db_session, list_id=target.id, user_id=uid)
    assert detail is not None
    assert detail.previous_list_id == newer_same_date.id


async def test_service_previous_list_tiebreak_by_id_when_date_and_created_at_collide(
    auth_client, db_session, user_a_id
):
    set_id, _, _ = await _make_set_with_item(auth_client)
    uid = uuid.UUID(user_a_id)
    same_dt = dt.datetime(2026, 1, 1, 12, 0, 0, tzinfo=dt.timezone.utc)

    a = UpdateTrackingList(
        user_id=uid, tracking_set_id=uuid.UUID(set_id), transaction_date=dt.date(2026, 1, 1)
    )
    a.created_at = same_dt
    b = UpdateTrackingList(
        user_id=uid, tracking_set_id=uuid.UUID(set_id), transaction_date=dt.date(2026, 1, 1)
    )
    b.created_at = same_dt
    target = UpdateTrackingList(
        user_id=uid, tracking_set_id=uuid.UUID(set_id), transaction_date=dt.date(2026, 1, 2)
    )
    db_session.add_all([a, b, target])
    await db_session.commit()

    expected_previous_id = max(a.id, b.id)
    detail = await get_update_list_detail(db_session, list_id=target.id, user_id=uid)
    assert detail is not None
    assert detail.previous_list_id == expected_previous_id


async def test_service_get_detail_returns_none_for_wrong_owner(auth_client, db_session, user_b_id):
    set_id, _, _ = await _make_set_with_item(auth_client)
    list_id = await _make_list(auth_client, set_id)

    detail = await get_update_list_detail(
        db_session, list_id=uuid.UUID(list_id), user_id=uuid.UUID(user_b_id)
    )
    assert detail is None


async def test_service_get_detail_returns_none_for_nonexistent_list(db_session, user_a_id):
    detail = await get_update_list_detail(
        db_session, list_id=uuid.uuid4(), user_id=uuid.UUID(user_a_id)
    )
    assert detail is None
