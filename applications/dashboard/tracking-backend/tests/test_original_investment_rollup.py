"""`GET /sets/{set_id}/dashboard/original-investment` — the profit-vs-original
rollup (ADR-018).

Covers: coverage counting (shown/total/excluded), exclusive-item exclusion,
flag-off exclusion, not-covered rows still present with null figures, totals
aggregating covered items only, totals percent suppressed when summed net
<= 0, read-time recompute, IDOR (bare 404), and a fixed query-count assertion
via a SQLAlchemy `before_cursor_execute` counter (no such harness existed in
the suite — this is a focused local one).
"""

from __future__ import annotations

import contextlib
import uuid
from decimal import Decimal

from sqlalchemy import event

PREFIX = "/api/v1/tracking"


# ── Query counter ────────────────────────────────────────────────────────────


@contextlib.contextmanager
def count_selects(engine):
    """Count SELECT statements issued on the shared test engine for the
    duration of the block. Transaction-control statements (BEGIN/COMMIT/
    ROLLBACK) are not `SELECT`s and are ignored."""
    counter = {"n": 0}
    sync_engine = engine.sync_engine

    def _before(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            counter["n"] += 1

    event.listen(sync_engine, "before_cursor_execute", _before)
    try:
        yield counter
    finally:
        event.remove(sync_engine, "before_cursor_execute", _before)


# ── Builders ─────────────────────────────────────────────────────────────────


async def _make_set(client) -> str:
    return (await client.post(f"{PREFIX}/sets", json={"name": f"Set-{uuid.uuid4()}"})).json()["id"]


async def _current_assets_sub_id(client, set_id: str) -> str:
    cats = (await client.get(f"{PREFIX}/sets/{set_id}/categories")).json()
    cat = next(c for c in cats if c["name"] == "Assets")
    subs = (await client.get(f"{PREFIX}/categories/{cat['id']}/sub-categories")).json()
    return next(s for s in subs if s["name"] == "Current Assets")["id"]


async def _make_item(
    client,
    sub_id: str,
    name: str,
    *,
    flag: bool = True,
    exclusive: bool = False,
    item_type: str = "Investment Account",
) -> str:
    resp = await client.post(
        f"{PREFIX}/sub-categories/{sub_id}/items",
        json={
            "name": name,
            "type": item_type,
            "initialInvestmentTracking": flag,
            "exclusive": exclusive,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _add_entry(client, item_id: str, amount: str, entry_date: str = "2026-01-01") -> None:
    resp = await client.post(
        f"{PREFIX}/items/{item_id}/entries", json={"amount": amount, "entryDate": entry_date}
    )
    assert resp.status_code == 201, resp.text


async def _make_list(client, set_id: str, quarter: int = 1, year: int = 2026) -> str:
    resp = await client.post(
        f"{PREFIX}/sets/{set_id}/update-lists",
        json={"transactionDate": f"{year}-0{quarter}-15", "quarter": quarter, "year": year},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _set_balance(client, list_id: str, item_id: str, balance: str) -> None:
    resp = await client.put(
        f"{PREFIX}/update-lists/{list_id}/balances",
        json={"balances": [{"trackingItemId": item_id, "balance": balance}]},
    )
    assert resp.status_code == 200, resp.text


async def _rollup(client, set_id: str) -> dict:
    resp = await client.get(f"{PREFIX}/sets/{set_id}/dashboard/original-investment")
    assert resp.status_code == 200, resp.text
    return resp.json()


def _row(rollup: dict, item_id: str) -> dict:
    return next(r for r in rollup["items"] if r["itemId"] == item_id)


# ── Coverage counting + exclusion rules ─────────────────────────────────────


async def test_coverage_counts_and_exclusions(auth_client):
    set_id = await _make_set(auth_client)
    sub_id = await _current_assets_sub_id(auth_client, set_id)

    covered = await _make_item(auth_client, sub_id, "Covered")
    entries_no_balance = await _make_item(auth_client, sub_id, "EntriesNoBalance")
    balance_no_entries = await _make_item(auth_client, sub_id, "BalanceNoEntries")
    flag_off = await _make_item(auth_client, sub_id, "FlagOff", flag=False)
    excluded = await _make_item(auth_client, sub_id, "Excluded", exclusive=True)

    await _add_entry(auth_client, covered, "1000")
    await _add_entry(auth_client, entries_no_balance, "500")
    await _add_entry(auth_client, excluded, "9999")

    lst = await _make_list(auth_client, set_id)
    await _set_balance(auth_client, lst, covered, "1500")
    await _set_balance(auth_client, lst, balance_no_entries, "700")
    await _set_balance(auth_client, lst, excluded, "9999")

    rollup = await _rollup(auth_client, set_id)

    # M = the 3 in-scope non-exclusive items; flag-off and exclusive are gone.
    item_ids = {r["itemId"] for r in rollup["items"]}
    assert item_ids == {covered, entries_no_balance, balance_no_entries}
    assert flag_off not in item_ids
    assert excluded not in item_ids

    cov = rollup["coverage"]
    assert cov["totalCount"] == 3
    assert cov["shownCount"] == 1
    assert set(cov["excludedItemNames"]) == {"EntriesNoBalance", "BalanceNoEntries"}

    # Covered row figures.
    cr = _row(rollup, covered)
    assert cr["isCovered"] is True
    assert Decimal(cr["netOriginalInvestment"]) == Decimal("1000")
    assert Decimal(cr["currentValue"]) == Decimal("1500")
    assert Decimal(cr["profit"]) == Decimal("500")
    assert Decimal(cr["profitPercent"]) == Decimal("50")
    assert cr["currentValueSlot"] == {"year": 2026, "quarter": 1}

    # Not-covered rows are present with nulls where the datum is missing.
    r1 = _row(rollup, entries_no_balance)
    assert r1["isCovered"] is False
    assert Decimal(r1["netOriginalInvestment"]) == Decimal("500")
    assert r1["currentValue"] is None
    assert r1["profit"] is None
    assert r1["profitPercent"] is None
    assert r1["currentValueSlot"] is None

    r2 = _row(rollup, balance_no_entries)
    assert r2["isCovered"] is False
    assert r2["netOriginalInvestment"] is None
    assert Decimal(r2["currentValue"]) == Decimal("700")
    assert r2["profit"] is None


# ── Totals aggregate covered items only ─────────────────────────────────────


async def test_totals_aggregate_covered_only(auth_client):
    set_id = await _make_set(auth_client)
    sub_id = await _current_assets_sub_id(auth_client, set_id)

    a = await _make_item(auth_client, sub_id, "A")
    b = await _make_item(auth_client, sub_id, "B")
    c = await _make_item(auth_client, sub_id, "C")  # entries only -> not covered

    await _add_entry(auth_client, a, "1000")
    await _add_entry(auth_client, b, "2000")
    await _add_entry(auth_client, c, "5000")

    lst = await _make_list(auth_client, set_id)
    await _set_balance(auth_client, lst, a, "1200")
    await _set_balance(auth_client, lst, b, "2500")
    # c: no balance

    rollup = await _rollup(auth_client, set_id)
    totals = rollup["totals"]
    # covered net = 1000 + 2000 = 3000 ; covered cv = 1200 + 2500 = 3700
    assert Decimal(totals["netOriginalInvestment"]) == Decimal("3000")
    assert Decimal(totals["currentValue"]) == Decimal("3700")
    assert Decimal(totals["profit"]) == Decimal("700")
    assert Decimal(totals["profitPercent"]) == (Decimal("700") / Decimal("3000") * Decimal("100"))


async def test_totals_percent_null_when_summed_net_not_positive(auth_client):
    set_id = await _make_set(auth_client)
    sub_id = await _current_assets_sub_id(auth_client, set_id)

    a = await _make_item(auth_client, sub_id, "A")
    b = await _make_item(auth_client, sub_id, "B")
    await _add_entry(auth_client, a, "500")
    await _add_entry(auth_client, b, "300")
    await _add_entry(auth_client, b, "-800")  # b net -500 ; total net = 500 + (-500) = 0

    lst = await _make_list(auth_client, set_id)
    await _set_balance(auth_client, lst, a, "600")
    await _set_balance(auth_client, lst, b, "50")

    rollup = await _rollup(auth_client, set_id)
    totals = rollup["totals"]
    assert Decimal(totals["netOriginalInvestment"]) == Decimal("0")
    assert Decimal(totals["currentValue"]) == Decimal("650")
    assert Decimal(totals["profit"]) == Decimal("650")
    assert totals["profitPercent"] is None


async def test_no_covered_items_yields_null_totals(auth_client):
    set_id = await _make_set(auth_client)
    sub_id = await _current_assets_sub_id(auth_client, set_id)
    only = await _make_item(auth_client, sub_id, "Only")
    await _add_entry(auth_client, only, "1000")  # entries but never a balance

    rollup = await _rollup(auth_client, set_id)
    assert rollup["coverage"]["shownCount"] == 0
    assert rollup["coverage"]["totalCount"] == 1
    totals = rollup["totals"]
    assert totals["netOriginalInvestment"] is None
    assert totals["currentValue"] is None
    assert totals["profit"] is None
    assert totals["profitPercent"] is None


# ── Read-time recompute ─────────────────────────────────────────────────────


async def test_rollup_recomputes_when_entry_added_and_when_balance_changes(auth_client):
    set_id = await _make_set(auth_client)
    sub_id = await _current_assets_sub_id(auth_client, set_id)
    item_id = await _make_item(auth_client, sub_id, "Item")
    await _add_entry(auth_client, item_id, "1000")
    lst = await _make_list(auth_client, set_id)
    await _set_balance(auth_client, lst, item_id, "1200")

    r1 = _row(await _rollup(auth_client, set_id), item_id)
    assert Decimal(r1["profit"]) == Decimal("200")

    await _add_entry(auth_client, item_id, "-300", "2026-02-01")  # net -> 700
    r2 = _row(await _rollup(auth_client, set_id), item_id)
    assert Decimal(r2["netOriginalInvestment"]) == Decimal("700")
    assert Decimal(r2["profit"]) == Decimal("500")

    # Change the balance snapshot -> current value + profit move immediately.
    await _set_balance(auth_client, lst, item_id, "2000")
    r3 = _row(await _rollup(auth_client, set_id), item_id)
    assert Decimal(r3["currentValue"]) == Decimal("2000")
    assert Decimal(r3["profit"]) == Decimal("1300")  # 2000 - 700


# ── Security ────────────────────────────────────────────────────────────────


async def test_cross_user_access_returns_bare_404(auth_client, auth_client_b):
    set_id = await _make_set(auth_client)
    resp = await auth_client_b.get(f"{PREFIX}/sets/{set_id}/dashboard/original-investment")
    assert resp.status_code == 404
    assert resp.status_code != 403


async def test_nonexistent_set_returns_404(auth_client):
    resp = await auth_client.get(f"{PREFIX}/sets/{uuid.uuid4()}/dashboard/original-investment")
    assert resp.status_code == 404


# ── Fixed query budget ─────────────────────────────────────────────────────


async def test_rollup_endpoint_issues_fixed_query_count(auth_client, engine):
    """Fully-populated set. Expected SELECT budget = 8:
      1  ownership check (_get_set_or_404)
      +5 get_balance_grid  (lists, balances, categories, sub-categories, items)
      +1 Query A  (in-scope tracking-item ids)
      +1 Query B  (all entries for those ids, one shot)
    No query is issued inside any per-item / per-slot loop.

    NOTE: ADR-018 wrote this budget as "9 (1 ownership + 6 grid + A + B)";
    that counted the caller's ownership check twice (once on its own, once
    inside the grid docstring's "6"). get_balance_grid itself issues 5
    SELECTs, so the real end-to-end figure is 8.
    """
    set_id = await _make_set(auth_client)
    sub_id = await _current_assets_sub_id(auth_client, set_id)
    i1 = await _make_item(auth_client, sub_id, "I1")
    i2 = await _make_item(auth_client, sub_id, "I2")
    await _add_entry(auth_client, i1, "1000")
    await _add_entry(auth_client, i2, "2000")
    lst = await _make_list(auth_client, set_id)
    await _set_balance(auth_client, lst, i1, "1100")
    await _set_balance(auth_client, lst, i2, "2100")

    with count_selects(engine) as counter:
        resp = await auth_client.get(f"{PREFIX}/sets/{set_id}/dashboard/original-investment")
        assert resp.status_code == 200

    assert counter["n"] == 8, f"expected 8 SELECTs, issued {counter['n']}"


async def test_rollup_query_count_does_not_grow_with_item_count(auth_client, engine):
    """Same budget with many more in-scope items — proves no per-item query."""
    set_id = await _make_set(auth_client)
    sub_id = await _current_assets_sub_id(auth_client, set_id)
    lst = await _make_list(auth_client, set_id)
    for n in range(6):
        item_id = await _make_item(auth_client, sub_id, f"Item{n}")
        await _add_entry(auth_client, item_id, "100")
        await _set_balance(auth_client, lst, item_id, "150")

    with count_selects(engine) as counter:
        resp = await auth_client.get(f"{PREFIX}/sets/{set_id}/dashboard/original-investment")
        assert resp.status_code == 200

    assert counter["n"] == 8, f"expected 8 SELECTs regardless of item count, issued {counter['n']}"
