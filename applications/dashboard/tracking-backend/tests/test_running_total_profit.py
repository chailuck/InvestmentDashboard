"""`profitVsOriginal` block on `GET /items/{id}/running-total` (ADR-018).

The block is ALWAYS present; its inner fields are null when the data needed
to compute them is absent. Scenarios:
  - covered (entries + a balance snapshot)      -> profit & percent correct
  - entries but NO update-list balance          -> currentValue/profit/percent null, isCovered false
  - zero entries (flag on)                      -> everything null, isCovered false
  - negative net (entries net below zero)       -> profit present, percent null, isCovered true
  - read-time recompute: adding an entry moves the profit immediately
"""

from __future__ import annotations

import uuid
from decimal import Decimal

PREFIX = "/api/v1/tracking"


async def _make_set(client) -> str:
    return (await client.post(f"{PREFIX}/sets", json={"name": f"Set-{uuid.uuid4()}"})).json()["id"]


async def _current_assets_sub_id(client, set_id: str) -> str:
    cats = (await client.get(f"{PREFIX}/sets/{set_id}/categories")).json()
    cat = next(c for c in cats if c["name"] == "Assets")
    subs = (await client.get(f"{PREFIX}/categories/{cat['id']}/sub-categories")).json()
    return next(s for s in subs if s["name"] == "Current Assets")["id"]


async def _make_tracked_item(client, set_id: str, name: str = "Tracked") -> str:
    sub_id = await _current_assets_sub_id(client, set_id)
    resp = await client.post(
        f"{PREFIX}/sub-categories/{sub_id}/items",
        json={"name": name, "type": "Investment Account", "initialInvestmentTracking": True},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _add_entry(client, item_id: str, amount: str, entry_date: str) -> None:
    resp = await client.post(
        f"{PREFIX}/items/{item_id}/entries", json={"amount": amount, "entryDate": entry_date}
    )
    assert resp.status_code == 201, resp.text


async def _make_list(client, set_id: str, txn_date: str, quarter: int, year: int) -> str:
    resp = await client.post(
        f"{PREFIX}/sets/{set_id}/update-lists",
        json={"transactionDate": txn_date, "quarter": quarter, "year": year},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _set_balance(client, list_id: str, item_id: str, balance: str) -> None:
    resp = await client.put(
        f"{PREFIX}/update-lists/{list_id}/balances",
        json={"balances": [{"trackingItemId": item_id, "balance": balance}]},
    )
    assert resp.status_code == 200, resp.text


async def _profit_block(client, item_id: str) -> dict:
    resp = await client.get(f"{PREFIX}/items/{item_id}/running-total")
    assert resp.status_code == 200, resp.text
    return resp.json()["profitVsOriginal"]


# ── Scenarios ────────────────────────────────────────────────────────────────


async def test_covered_item_reports_profit_and_percent(auth_client):
    set_id = await _make_set(auth_client)
    item_id = await _make_tracked_item(auth_client, set_id)
    await _add_entry(auth_client, item_id, "600", "2026-01-01")
    await _add_entry(auth_client, item_id, "400", "2026-02-01")  # net 1000
    q1 = await _make_list(auth_client, set_id, "2026-01-15", quarter=1, year=2026)
    await _set_balance(auth_client, q1, item_id, "1200")

    block = await _profit_block(auth_client, item_id)
    assert block["isCovered"] is True
    assert Decimal(block["netOriginalInvestment"]) == Decimal("1000")
    assert Decimal(block["currentValue"]) == Decimal("1200")
    assert Decimal(block["profit"]) == Decimal("200")
    assert Decimal(block["profitPercent"]) == Decimal("20")
    assert block["currentValueSlot"] == {"year": 2026, "quarter": 1}


async def test_entries_but_no_balance_snapshot_is_not_covered(auth_client):
    set_id = await _make_set(auth_client)
    item_id = await _make_tracked_item(auth_client, set_id)
    await _add_entry(auth_client, item_id, "1000", "2026-01-01")
    # No update list / balance at all.

    block = await _profit_block(auth_client, item_id)
    assert block["isCovered"] is False
    assert Decimal(block["netOriginalInvestment"]) == Decimal("1000")
    assert block["currentValue"] is None
    assert block["profit"] is None
    assert block["profitPercent"] is None
    assert block["currentValueSlot"] is None


async def test_zero_entries_item_has_all_null_profit_fields(auth_client):
    set_id = await _make_set(auth_client)
    item_id = await _make_tracked_item(auth_client, set_id)
    q1 = await _make_list(auth_client, set_id, "2026-01-15", quarter=1, year=2026)
    await _set_balance(auth_client, q1, item_id, "5000")  # a balance exists...

    block = await _profit_block(auth_client, item_id)
    assert block["isCovered"] is False  # ...but no entries -> net unknown
    assert block["netOriginalInvestment"] is None
    assert block["profit"] is None
    assert block["profitPercent"] is None


async def test_negative_net_reports_profit_but_null_percent(auth_client):
    set_id = await _make_set(auth_client)
    item_id = await _make_tracked_item(auth_client, set_id)
    await _add_entry(auth_client, item_id, "500", "2026-01-01")
    await _add_entry(auth_client, item_id, "-900", "2026-02-01")  # net -400
    q1 = await _make_list(auth_client, set_id, "2026-01-15", quarter=1, year=2026)
    await _set_balance(auth_client, q1, item_id, "100")

    block = await _profit_block(auth_client, item_id)
    assert block["isCovered"] is True
    assert Decimal(block["netOriginalInvestment"]) == Decimal("-400")
    assert Decimal(block["profit"]) == Decimal("500")  # 100 - (-400)
    assert block["profitPercent"] is None


async def test_profit_recomputes_immediately_when_an_entry_is_added(auth_client):
    set_id = await _make_set(auth_client)
    item_id = await _make_tracked_item(auth_client, set_id)
    await _add_entry(auth_client, item_id, "1000", "2026-01-01")
    q1 = await _make_list(auth_client, set_id, "2026-01-15", quarter=1, year=2026)
    await _set_balance(auth_client, q1, item_id, "1200")

    before = await _profit_block(auth_client, item_id)
    assert Decimal(before["profit"]) == Decimal("200")

    await _add_entry(auth_client, item_id, "-300", "2026-03-01")  # net now 700
    after = await _profit_block(auth_client, item_id)
    assert Decimal(after["netOriginalInvestment"]) == Decimal("700")
    assert Decimal(after["profit"]) == Decimal("500")  # 1200 - 700


async def test_profit_block_always_present_even_with_nothing(auth_client):
    set_id = await _make_set(auth_client)
    item_id = await _make_tracked_item(auth_client, set_id)

    resp = await auth_client.get(f"{PREFIX}/items/{item_id}/running-total")
    assert resp.status_code == 200
    body = resp.json()
    assert "profitVsOriginal" in body
    block = body["profitVsOriginal"]
    assert block["isCovered"] is False
    assert block["netOriginalInvestment"] is None
    assert block["currentValue"] is None
