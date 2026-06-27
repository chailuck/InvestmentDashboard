"""Tests for the Objective tab endpoints.

Test cases:
  TC-OBJ-BE-01: GET /objective returns 200 with positions for authenticated user
  TC-OBJ-BE-02: GET /objective with months=3 filters by entry_date correctly
  TC-OBJ-BE-03: GET /objective with no_reason_only=true returns only positions without reason
  TC-OBJ-BE-04: PATCH /objective/{id} updates reason and feel
  TC-OBJ-BE-05: PATCH /objective/{id} with feel=6 returns 422
  TC-OBJ-BE-06: PATCH /objective/{id} returns 404 for unknown position_id
  TC-OBJ-BE-07: PATCH /objective/{id} with reason=null clears the field
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.portfolio_db import PortfolioDbPosition


# ── Helpers ────────────────────────────────────────────────────────────────────

async def _create_position(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    symbol: str = "PTT",
    direction: str = "LONG",
    entry_date: date | None = None,
    position_size: int | None = 1000,
    status: str = "active",
    reason: str | None = None,
    feel: int | None = None,
) -> PortfolioDbPosition:
    """Insert a PortfolioDbPosition directly and commit so the app session sees it."""
    pos = PortfolioDbPosition(
        user_id=user_id,
        symbol=symbol,
        direction=direction,
        entry_date=entry_date or date.today(),
        entry_price=100.0,
        position_size=position_size,
        status=status,
        reason=reason,
        feel=feel,
    )
    db.add(pos)
    await db.commit()
    await db.refresh(pos)
    return pos


async def _get_user_id_from_token(auth_client: AsyncClient) -> uuid.UUID:
    """Derive the authenticated user's UUID by hitting /api/v1/users/me."""
    resp = await auth_client.get("/api/v1/users/me")
    return uuid.UUID(resp.json()["id"])


# ── TC-OBJ-BE-01 ──────────────────────────────────────────────────────────────

async def test_list_objective_returns_200(auth_client: AsyncClient, db_session: AsyncSession):
    """TC-OBJ-BE-01: GET /objective returns 200 with positions for the authenticated user."""
    uid = await _get_user_id_from_token(auth_client)
    await _create_position(db_session, uid, symbol="AOT")

    resp = await auth_client.get("/api/v1/objective")

    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data
    assert "total" in data
    assert isinstance(data["items"], list)
    assert data["total"] >= 1
    symbols = [item["symbol"] for item in data["items"]]
    assert "AOT" in symbols


# ── TC-OBJ-BE-02 ──────────────────────────────────────────────────────────────

async def test_list_objective_months_filter(auth_client: AsyncClient, db_session: AsyncSession):
    """TC-OBJ-BE-02: GET /objective with months=3 filters by entry_date correctly."""
    uid = await _get_user_id_from_token(auth_client)

    recent_date = date.today() - timedelta(days=30)
    old_date = date.today() - timedelta(days=200)

    await _create_position(db_session, uid, symbol="KBANK", entry_date=recent_date)
    await _create_position(db_session, uid, symbol="BBL", entry_date=old_date)

    resp = await auth_client.get("/api/v1/objective", params={"months": 3})

    assert resp.status_code == 200
    data = resp.json()
    symbols = [item["symbol"] for item in data["items"]]

    assert "KBANK" in symbols
    assert "BBL" not in symbols


# ── TC-OBJ-BE-03 ──────────────────────────────────────────────────────────────

async def test_list_objective_no_reason_only(auth_client: AsyncClient, db_session: AsyncSession):
    """TC-OBJ-BE-03: GET /objective?no_reason_only=true returns only positions without reason."""
    uid = await _get_user_id_from_token(auth_client)

    await _create_position(db_session, uid, symbol="CPALL", reason=None)
    await _create_position(db_session, uid, symbol="MINT", reason="Breakout confirmed")

    resp = await auth_client.get("/api/v1/objective", params={"no_reason_only": "true"})

    assert resp.status_code == 200
    data = resp.json()
    symbols = [item["symbol"] for item in data["items"]]

    assert "CPALL" in symbols
    assert "MINT" not in symbols


# ── TC-OBJ-BE-04 ──────────────────────────────────────────────────────────────

async def test_patch_objective_updates_reason_and_feel(
    auth_client: AsyncClient, db_session: AsyncSession
):
    """TC-OBJ-BE-04: PATCH /objective/{id} updates reason and feel."""
    uid = await _get_user_id_from_token(auth_client)
    pos = await _create_position(db_session, uid, symbol="SCB")

    resp = await auth_client.patch(
        f"/api/v1/objective/{pos.id}",
        json={"reason": "Strong earnings beat", "feel": 4},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["reason"] == "Strong earnings beat"
    assert data["feel"] == 4
    assert data["id"] == str(pos.id)


# ── TC-OBJ-BE-05 ──────────────────────────────────────────────────────────────

async def test_patch_objective_feel_out_of_range_returns_422(
    auth_client: AsyncClient, db_session: AsyncSession
):
    """TC-OBJ-BE-05: PATCH /objective/{id} with feel=6 returns 422."""
    uid = await _get_user_id_from_token(auth_client)
    pos = await _create_position(db_session, uid, symbol="BH")

    resp = await auth_client.patch(
        f"/api/v1/objective/{pos.id}",
        json={"feel": 6},
    )

    assert resp.status_code == 422


# ── TC-OBJ-BE-06 ──────────────────────────────────────────────────────────────

async def test_patch_objective_unknown_position_returns_404(auth_client: AsyncClient):
    """TC-OBJ-BE-06: PATCH /objective/{id} returns 404 for unknown position_id."""
    fake_id = str(uuid.uuid4())

    resp = await auth_client.patch(
        f"/api/v1/objective/{fake_id}",
        json={"reason": "Should not find this"},
    )

    assert resp.status_code == 404


# ── TC-OBJ-BE-07 ──────────────────────────────────────────────────────────────

async def test_patch_objective_null_reason_clears_field(
    auth_client: AsyncClient, db_session: AsyncSession
):
    """TC-OBJ-BE-07: PATCH /objective/{id} with reason=null clears the field."""
    uid = await _get_user_id_from_token(auth_client)
    pos = await _create_position(db_session, uid, symbol="TRUE", reason="Initial reason", feel=3)

    resp = await auth_client.patch(
        f"/api/v1/objective/{pos.id}",
        json={"reason": None},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["reason"] is None
    # feel should be unchanged since it was not in the patch payload
    assert data["feel"] == 3


# ── TC-OBJ-BE-08 ──────────────────────────────────────────────────────────────

async def test_patch_objective_feel_zero_returns_422(
    auth_client: AsyncClient, db_session: AsyncSession
):
    """TC-OBJ-BE-08: PATCH /objective/{id} with feel=0 returns 422.

    0 is outside the valid range 1–5 and is a common off-by-one mistake.
    The validator rejects it the same way as feel=6.
    """
    uid = await _get_user_id_from_token(auth_client)
    pos = await _create_position(db_session, uid, symbol="CPF")

    resp = await auth_client.patch(
        f"/api/v1/objective/{pos.id}",
        json={"feel": 0},
    )

    assert resp.status_code == 422
