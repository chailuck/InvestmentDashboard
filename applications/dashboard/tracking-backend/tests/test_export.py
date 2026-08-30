"""Export endpoint tests — `GET /sets/{set_id}/export` (Financial Tracker
full-fidelity snapshot).

Covers: a fully-populated set round-trips every record with correct
nesting/counts/values; ownership isolation (bare 404, not 403, not an empty
200); nonexistent set_id -> 404; an empty tracking set (no items/lists yet)
-> 200 with empty arrays; and that Decimal/date/datetime fields serialize
correctly, including a NULL balance staying `null` (not `0` or omitted)."""

from __future__ import annotations

import uuid

PREFIX = "/api/v1/tracking"


# ── Helpers (mirrors test_dashboard_balance_grid.py's helper style) ─────────


async def _make_set(client, name: str | None = None) -> str:
    resp = await client.post(f"{PREFIX}/sets", json={"name": name or f"Set-{uuid.uuid4()}"})
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _sub_id(client, set_id: str, category_name: str, sub_name: str) -> str:
    cats = (await client.get(f"{PREFIX}/sets/{set_id}/categories")).json()
    cat = next(c for c in cats if c["name"] == category_name)
    subs = (await client.get(f"{PREFIX}/categories/{cat['id']}/sub-categories")).json()
    sub = next(s for s in subs if s["name"] == sub_name)
    return sub["id"]


async def _current_assets_sub_id(client, set_id: str) -> str:
    return await _sub_id(client, set_id, "Assets", "Current Assets")


async def _property_sub_id(client, set_id: str) -> str:
    return await _sub_id(client, set_id, "Assets", "Property")


async def _make_item(
    client,
    sub_id: str,
    name: str = "Item",
    item_type: str = "Bank account",
    exclusive: bool = False,
    initial_investment_tracking: bool = False,
    description: str | None = None,
    account_name: str | None = None,
    remark: str | None = None,
) -> str:
    body = {
        "name": name,
        "type": item_type,
        "exclusive": exclusive,
        "initialInvestmentTracking": initial_investment_tracking,
    }
    if description is not None:
        body["description"] = description
    if account_name is not None:
        body["accountName"] = account_name
    if remark is not None:
        body["remark"] = remark
    resp = await client.post(f"{PREFIX}/sub-categories/{sub_id}/items", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _make_list(client, set_id: str, transaction_date: str, quarter: int, year: int) -> str:
    resp = await client.post(
        f"{PREFIX}/sets/{set_id}/update-lists",
        json={"transactionDate": transaction_date, "quarter": quarter, "year": year},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _set_balance(client, list_id: str, item_id: str, balance) -> None:
    resp = await client.put(
        f"{PREFIX}/update-lists/{list_id}/balances",
        json={"balances": [{"trackingItemId": item_id, "balance": balance}]},
    )
    assert resp.status_code == 200, resp.text


async def _make_entry(
    client, item_id: str, amount: str, entry_date: str, note: str | None = None
) -> str:
    body = {"amount": amount, "entryDate": entry_date}
    if note is not None:
        body["note"] = note
    resp = await client.post(f"{PREFIX}/items/{item_id}/entries", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _get_export(client, set_id: str):
    resp = await client.get(f"{PREFIX}/sets/{set_id}/export")
    assert resp.status_code == 200, resp.text
    return resp.json()


# ── Fully-populated round-trip ───────────────────────────────────────────────


async def test_fully_populated_set_exports_every_record(auth_client):
    set_id = await _make_set(auth_client, "Full Export Set")
    current_assets_sub = await _current_assets_sub_id(auth_client, set_id)
    property_sub = await _property_sub_id(auth_client, set_id)

    item1_id = await _make_item(
        auth_client,
        current_assets_sub,
        name="Checking",
        item_type="Bank account",
        initial_investment_tracking=True,
        description="Main checking account",
        account_name="Acct-001",
        remark="primary",
    )
    item2_id = await _make_item(
        auth_client, property_sub, name="House", item_type="Property", exclusive=True
    )

    list1_id = await _make_list(auth_client, set_id, "2026-01-15", quarter=1, year=2026)
    list2_id = await _make_list(auth_client, set_id, "2026-04-15", quarter=2, year=2026)
    await _set_balance(auth_client, list1_id, item1_id, "1000.50")
    await _set_balance(auth_client, list1_id, item2_id, "500000")
    await _set_balance(auth_client, list2_id, item1_id, "1200.75")
    # list2/item2 deliberately left with NO balance row at all.

    entry1_id = await _make_entry(auth_client, item1_id, "100.25", "2026-01-01", note="เงินโบนัส")
    entry2_id = await _make_entry(auth_client, item1_id, "-50", "2026-02-01")

    export = await _get_export(auth_client, set_id)

    # Envelope
    assert export["exportVersion"] == 2  # bumped by ADR-018 (entry `note` added)
    assert "exportedAt" in export and export["exportedAt"]

    # Tracking set (no userId leaked)
    assert export["trackingSet"]["id"] == set_id
    assert export["trackingSet"]["name"] == "Full Export Set"
    assert "userId" not in export["trackingSet"]
    assert "createdAt" in export["trackingSet"] and "updatedAt" in export["trackingSet"]

    # Categories: default skeleton (2) + counts
    assert len(export["categories"]) == 2
    category_names = {c["name"] for c in export["categories"]}
    assert category_names == {"Assets", "Liabilities"}
    for c in export["categories"]:
        assert c["trackingSetId"] == set_id
        assert "orderIndex" in c

    # Sub-categories: default skeleton (3 under Assets + 2 under Liabilities = 5)
    assert len(export["subCategories"]) == 5

    # Tracking items
    assert len(export["trackingItems"]) == 2
    items_by_id = {i["id"]: i for i in export["trackingItems"]}
    assert items_by_id[item1_id]["name"] == "Checking"
    assert items_by_id[item1_id]["type"] == "Bank account"
    assert items_by_id[item1_id]["initialInvestmentTracking"] is True
    assert items_by_id[item1_id]["exclusive"] is False
    assert items_by_id[item1_id]["description"] == "Main checking account"
    assert items_by_id[item1_id]["accountName"] == "Acct-001"
    assert items_by_id[item1_id]["remark"] == "primary"
    assert items_by_id[item1_id]["subCategoryId"] == current_assets_sub

    assert items_by_id[item2_id]["name"] == "House"
    assert items_by_id[item2_id]["type"] == "Property"
    assert items_by_id[item2_id]["exclusive"] is True
    assert items_by_id[item2_id]["description"] is None
    assert items_by_id[item2_id]["accountName"] is None
    assert items_by_id[item2_id]["remark"] is None

    # Update tracking lists
    assert len(export["updateTrackingLists"]) == 2
    lists_by_id = {u["id"]: u for u in export["updateTrackingLists"]}
    assert lists_by_id[list1_id]["quarter"] == 1
    assert lists_by_id[list1_id]["year"] == 2026
    assert lists_by_id[list1_id]["transactionDate"] == "2026-01-15"
    assert lists_by_id[list1_id]["trackingSetId"] == set_id

    # Balances: 3 rows written (list1/item1, list1/item2, list2/item1)
    assert len(export["updateTrackingListBalances"]) == 3
    balances_by_key = {
        (b["updateTrackingListId"], b["trackingItemId"]): b
        for b in export["updateTrackingListBalances"]
    }
    assert balances_by_key[(list1_id, item1_id)]["balance"] == "1000.5000"
    assert balances_by_key[(list1_id, item2_id)]["balance"] == "500000.0000"
    assert balances_by_key[(list2_id, item1_id)]["balance"] == "1200.7500"
    assert (list2_id, item2_id) not in balances_by_key  # never written -> absent, not null row

    # Initial investment entries
    assert len(export["initialInvestmentEntries"]) == 2
    entries_by_id = {e["id"]: e for e in export["initialInvestmentEntries"]}
    assert entries_by_id[entry1_id]["amount"] == "100.2500"
    assert entries_by_id[entry1_id]["entryDate"] == "2026-01-01"
    assert entries_by_id[entry1_id]["trackingItemId"] == item1_id
    assert entries_by_id[entry1_id]["note"] == "เงินโบนัส"  # note round-trips in the export
    assert entries_by_id[entry2_id]["amount"] == "-50.0000"
    assert entries_by_id[entry2_id]["note"] is None  # no note -> explicit null, not omitted


async def test_null_balance_serializes_as_json_null_not_zero_or_omitted(auth_client):
    set_id = await _make_set(auth_client)
    sub_id = await _current_assets_sub_id(auth_client, set_id)
    item_id = await _make_item(auth_client, sub_id)
    list_id = await _make_list(auth_client, set_id, "2026-01-15", quarter=1, year=2026)
    # Explicit null balance (row exists, but its balance value is NULL).
    await _set_balance(auth_client, list_id, item_id, None)

    export = await _get_export(auth_client, set_id)
    assert len(export["updateTrackingListBalances"]) == 1
    balance_row = export["updateTrackingListBalances"][0]
    assert "balance" in balance_row
    assert balance_row["balance"] is None


# ── Empty tracking set ───────────────────────────────────────────────────────


async def test_empty_tracking_set_returns_200_with_empty_arrays(auth_client):
    set_id = await _make_set(auth_client, "Empty Set")
    export = await _get_export(auth_client, set_id)

    assert export["updateTrackingLists"] == []
    assert export["updateTrackingListBalances"] == []
    assert export["initialInvestmentEntries"] == []
    assert export["trackingItems"] == []
    # The cascade-created default skeleton is still present.
    assert len(export["categories"]) == 2
    assert len(export["subCategories"]) == 5


# ── Ownership / security ─────────────────────────────────────────────────────


async def test_cross_user_export_returns_bare_404(auth_client, auth_client_b):
    set_id = await _make_set(auth_client, "User A's Set")
    sub_id = await _current_assets_sub_id(auth_client, set_id)
    await _make_item(auth_client, sub_id, name="Secret Item")

    resp = await auth_client_b.get(f"{PREFIX}/sets/{set_id}/export")
    assert resp.status_code == 404
    assert resp.status_code != 403
    # Not an empty-but-200 leak either.
    body = resp.json()
    assert "trackingSet" not in body


async def test_nonexistent_set_returns_404(auth_client):
    resp = await auth_client.get(f"{PREFIX}/sets/{uuid.uuid4()}/export")
    assert resp.status_code == 404


async def test_unauthenticated_request_returns_401(client):
    resp = await client.get(f"{PREFIX}/sets/{uuid.uuid4()}/export")
    assert resp.status_code == 401
