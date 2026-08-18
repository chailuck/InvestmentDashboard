"""Regression tests for POST /portfolio-db/positions/{pos_id}/sell.

Bug context (fixed in this change set):
  The "partial sell" branch of `sell_position()` built the closed child
  `PortfolioDbPosition` row without copying `portfolio_id` from the parent.
  Every read path in the app filters `WHERE portfolio_id = :portfolio_id`,
  so the child row persisted correctly but was invisible everywhere in the
  app (portfolio views, performance, etc). Fixed by adding
  `portfolio_id=pos.portfolio_id` to the child constructor call.

Test cases:
  TC-PDB-SELL-01: Partial sell child row has same portfolio_id as parent
  TC-PDB-SELL-02: Partial sell child row IS returned by a portfolio_id-filtered
                   query (the actual read-path shape) — this is the test that
                   would have caught the original bug, since a plain equality
                   assertion on `None == None` would not have.
  TC-PDB-SELL-03: Full sell closes in place — no child row, parent portfolio_id
                   unchanged (guards the fix against regressing the full-sell path)
  TC-PDB-SELL-04: Partial sell on a position with portfolio_id=None propagates
                   None to the child (no invented default/validation)
"""

from __future__ import annotations

import uuid
from datetime import date

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.portfolio import Portfolio
from app.models.portfolio_db import PortfolioDbPosition


# ── Helpers ────────────────────────────────────────────────────────────────────

async def _create_portfolio(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    name: str = "Main",
) -> Portfolio:
    """Insert a Portfolio row so PortfolioDbPosition.portfolio_id has a valid FK target."""
    result = await db.execute(
        select(Portfolio).where(Portfolio.user_id == user_id, Portfolio.name == name)
    )
    existing = result.scalar_one_or_none()
    if existing:
        return existing
    portfolio = Portfolio(user_id=user_id, name=name)
    db.add(portfolio)
    await db.commit()
    await db.refresh(portfolio)
    return portfolio


async def _create_position(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    symbol: str = "PTT",
    direction: str = "LONG",
    entry_date: date | None = None,
    entry_price: float = 100.0,
    position_size: int = 1000,
    status: str = "active",
    portfolio_id: uuid.UUID | None = None,
) -> PortfolioDbPosition:
    """Insert a PortfolioDbPosition directly and commit so the app session sees it."""
    pos = PortfolioDbPosition(
        user_id=user_id,
        portfolio_id=portfolio_id,
        symbol=symbol,
        direction=direction,
        entry_date=entry_date or date.today(),
        entry_price=entry_price,
        position_size=position_size,
        status=status,
    )
    db.add(pos)
    await db.commit()
    await db.refresh(pos)
    return pos


async def _get_user_id_from_token(auth_client: AsyncClient) -> uuid.UUID:
    """Derive the authenticated user's UUID by hitting /api/v1/auth/me.

    Note: /api/v1/users/me is NOT a valid route (only /users/{user_id} and
    /users/me/change-password exist) — a GET there matches /users/{user_id}
    with user_id="me" and 500s. /api/v1/auth/me is the correct self-lookup
    endpoint and is what this helper uses.
    """
    resp = await auth_client.get("/api/v1/auth/me")
    resp.raise_for_status()
    return uuid.UUID(resp.json()["id"])


# ── TC-PDB-SELL-01 ───────────────────────────────────────────────────────────

async def test_partial_sell_child_portfolio_id_matches_parent(
    auth_client: AsyncClient, db_session: AsyncSession
):
    """TC-PDB-SELL-01: after a partial sell, the child row's portfolio_id equals
    the parent's portfolio_id (field-equality regression for the fix)."""
    uid = await _get_user_id_from_token(auth_client)
    portfolio = await _create_portfolio(db_session, uid)
    parent = await _create_position(
        db_session, uid, symbol="PDBS1", position_size=1000, portfolio_id=portfolio.id
    )

    resp = await auth_client.post(
        f"/api/v1/portfolio-db/positions/{parent.id}/sell",
        json={"quantity": 400, "exit_price": 120.0, "exit_date": str(date.today())},
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["type"] == "partial"
    child_id = uuid.UUID(data["sold"]["id"])

    result = await db_session.execute(
        select(PortfolioDbPosition).where(PortfolioDbPosition.id == child_id)
    )
    child = result.scalar_one()
    assert child.portfolio_id == portfolio.id
    assert child.portfolio_id == parent.portfolio_id


# ── TC-PDB-SELL-02 ───────────────────────────────────────────────────────────

async def test_partial_sell_child_visible_in_portfolio_filtered_query(
    auth_client: AsyncClient, db_session: AsyncSession
):
    """TC-PDB-SELL-02: the child row IS returned by the same portfolio_id-filtered
    query shape the app's real read paths use. This is the test that would have
    caught the original bug — a plain `child.portfolio_id == parent.portfolio_id`
    assertion would NOT catch it, because the bug was `portfolio_id=None` being
    silently accepted (None == None passes) rather than a wrong non-null value."""
    uid = await _get_user_id_from_token(auth_client)
    portfolio = await _create_portfolio(db_session, uid, name="Filtered")
    parent = await _create_position(
        db_session, uid, symbol="PDBS2", position_size=1000, portfolio_id=portfolio.id
    )

    resp = await auth_client.post(
        f"/api/v1/portfolio-db/positions/{parent.id}/sell",
        json={"quantity": 300, "exit_price": 110.0, "exit_date": str(date.today())},
    )
    assert resp.status_code == 201
    child_id = uuid.UUID(resp.json()["sold"]["id"])

    result = await db_session.execute(
        select(PortfolioDbPosition).where(
            PortfolioDbPosition.portfolio_id == portfolio.id
        )
    )
    rows = result.scalars().all()
    ids = {row.id for row in rows}

    assert child_id in ids, (
        "Partial-sell child row was not returned by a portfolio_id-filtered query "
        "— this reproduces the original bug where the child was invisible to every "
        "read path in the app despite persisting correctly in the DB."
    )


# ── TC-PDB-SELL-03 ───────────────────────────────────────────────────────────

async def test_full_sell_closes_in_place_no_child_created(
    auth_client: AsyncClient, db_session: AsyncSession
):
    """TC-PDB-SELL-03: a full sell (quantity == position_size) closes the position
    in place, creates no child row, and leaves the parent's portfolio_id untouched.
    Guards the fix against accidentally affecting the full-sell branch."""
    uid = await _get_user_id_from_token(auth_client)
    portfolio = await _create_portfolio(db_session, uid, name="FullSell")
    parent = await _create_position(
        db_session, uid, symbol="PDBS3", position_size=500, portfolio_id=portfolio.id
    )

    resp = await auth_client.post(
        f"/api/v1/portfolio-db/positions/{parent.id}/sell",
        json={"quantity": 500, "exit_price": 130.0, "exit_date": str(date.today())},
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["type"] == "full"
    assert data["position"]["id"] == str(parent.id)

    result = await db_session.execute(
        select(PortfolioDbPosition).where(PortfolioDbPosition.parent_id == parent.id)
    )
    children = result.scalars().all()
    assert children == []

    await db_session.refresh(parent)
    assert parent.status == "closed"
    assert parent.portfolio_id == portfolio.id


# ── TC-PDB-SELL-04 ───────────────────────────────────────────────────────────

async def test_partial_sell_with_null_portfolio_id_propagates_none(
    auth_client: AsyncClient, db_session: AsyncSession
):
    """TC-PDB-SELL-04: for a legacy/unassigned position (portfolio_id=None), the
    child row created by a partial sell also gets portfolio_id=None — the fix
    only propagates whatever the parent already has, it does not force a
    non-null value or invent new validation."""
    uid = await _get_user_id_from_token(auth_client)
    parent = await _create_position(
        db_session, uid, symbol="PDBS4", position_size=800, portfolio_id=None
    )
    assert parent.portfolio_id is None

    resp = await auth_client.post(
        f"/api/v1/portfolio-db/positions/{parent.id}/sell",
        json={"quantity": 200, "exit_price": 90.0, "exit_date": str(date.today())},
    )

    assert resp.status_code == 201
    child_id = uuid.UUID(resp.json()["sold"]["id"])

    result = await db_session.execute(
        select(PortfolioDbPosition).where(PortfolioDbPosition.id == child_id)
    )
    child = result.scalar_one()
    assert child.portfolio_id is None
