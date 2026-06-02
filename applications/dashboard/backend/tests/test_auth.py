"""Tests for authentication endpoints.

Key design decisions
--------------------
* There is no public /register endpoint.  User creation goes through the
  admin-only POST /api/v1/users.  The admin_client fixture (seeded via DB)
  is used to create test users.
* Login is JSON body (LoginRequest), NOT OAuth2 form data.
* get_current_user_id calls Redis to check the token blacklist.  Redis is
  mocked globally by the mock_redis autouse fixture in conftest.py.

Endpoints covered
-----------------
POST /api/v1/users               (admin) — create user
POST /api/v1/auth/login          — obtain tokens
POST /api/v1/auth/refresh        — rotate access token
POST /api/v1/auth/logout         — blacklist token
GET  /api/v1/auth/me             — self profile
PUT  /api/v1/auth/me             — update own name
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.jwt import create_access_token, create_refresh_token
from main import fastapi_app
from tests.conftest import _create_user

# ── Shared payloads ───────────────────────────────────────────────────────────

_VALID_USER = {
    "email": "auth_test@example.com",
    "name": "Auth Test User",
    "password": "ValidPass123!",
    "role": "analyst",
}

_LOGIN_BODY = {
    "email": _VALID_USER["email"],
    "password": _VALID_USER["password"],
}


# ── User creation via admin endpoint ─────────────────────────────────────────

async def test_create_user_success(admin_client: AsyncClient):
    """Admin can create a new user — returns 201 with user fields."""
    resp = await admin_client.post("/api/v1/users", json=_VALID_USER)
    assert resp.status_code == 201
    body = resp.json()
    assert body["email"] == _VALID_USER["email"]
    assert body["name"] == _VALID_USER["name"]
    assert body["role"] == _VALID_USER["role"]
    assert "id" in body


async def test_create_user_duplicate_email(admin_client: AsyncClient, db_session: AsyncSession):
    """Creating a user with an already-registered email returns 409."""
    # Seed user directly
    await _create_user(db_session, email="dup@example.com")
    await db_session.commit()

    resp = await admin_client.post(
        "/api/v1/users",
        json={"email": "dup@example.com", "name": "Dup", "password": "ValidPass123!", "role": "viewer"},
    )
    assert resp.status_code == 409


async def test_create_user_invalid_email(admin_client: AsyncClient):
    """Malformed email address is rejected with 422."""
    resp = await admin_client.post(
        "/api/v1/users",
        json={"email": "not-an-email", "name": "Bad Email", "password": "ValidPass123!", "role": "viewer"},
    )
    assert resp.status_code == 422


async def test_create_user_weak_password(admin_client: AsyncClient):
    """Password shorter than 8 characters is rejected with 422."""
    resp = await admin_client.post(
        "/api/v1/users",
        json={"email": "weak@example.com", "name": "Weak", "password": "short", "role": "viewer"},
    )
    assert resp.status_code == 422


async def test_create_user_invalid_role(admin_client: AsyncClient):
    """An unrecognised role value is rejected with 422."""
    resp = await admin_client.post(
        "/api/v1/users",
        json={"email": "badrole@example.com", "name": "Bad Role", "password": "ValidPass123!", "role": "superuser"},
    )
    assert resp.status_code == 422


async def test_create_user_requires_admin(client: AsyncClient):
    """Unauthenticated request to POST /users is rejected with 401."""
    resp = await client.post("/api/v1/users", json=_VALID_USER)
    assert resp.status_code == 401


# ── Login ─────────────────────────────────────────────────────────────────────

async def test_login_success(admin_client: AsyncClient, db_session: AsyncSession):
    """Valid credentials return 200 with access_token and refresh_token."""
    await _create_user(db_session, email=_VALID_USER["email"], password=_VALID_USER["password"])
    await db_session.commit()

    # Use an unauthenticated client for the login call
    from httpx import ASGITransport
    from app.database.session import get_db

    async def _override():
        yield db_session

    fastapi_app.dependency_overrides[get_db] = _override
    async with AsyncClient(transport=ASGITransport(app=fastapi_app), base_url="http://test") as c:
        resp = await c.post("/api/v1/auth/login", json=_LOGIN_BODY)
    fastapi_app.dependency_overrides.clear()

    assert resp.status_code == 200
    body = resp.json()
    assert "access_token" in body
    assert "refresh_token" in body
    assert body["token_type"] == "bearer"
    assert body["expires_in"] > 0


async def test_login_wrong_password(admin_client: AsyncClient, db_session: AsyncSession):
    """Wrong password returns 401."""
    await _create_user(db_session, email="wrongpw@example.com", password="CorrectPass1!")
    await db_session.commit()

    from httpx import ASGITransport
    from app.database.session import get_db

    async def _override():
        yield db_session

    fastapi_app.dependency_overrides[get_db] = _override
    async with AsyncClient(transport=ASGITransport(app=fastapi_app), base_url="http://test") as c:
        resp = await c.post("/api/v1/auth/login", json={"email": "wrongpw@example.com", "password": "WrongPass1!"})
    fastapi_app.dependency_overrides.clear()

    assert resp.status_code == 401


async def test_login_nonexistent_user(client: AsyncClient):
    """Login attempt for an unknown email returns 401."""
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "nobody@nowhere.com", "password": "SomePass123!"},
    )
    assert resp.status_code == 401


# ── /me ───────────────────────────────────────────────────────────────────────

async def test_get_me_authenticated(auth_client: AsyncClient):
    """Authenticated GET /me returns 200 with the user's email."""
    resp = await auth_client.get("/api/v1/auth/me")
    assert resp.status_code == 200
    body = resp.json()
    assert "email" in body
    assert body["email"] == "test@example.com"


async def test_get_me_no_token(client: AsyncClient):
    """Missing Authorization header returns 401."""
    resp = await client.get("/api/v1/auth/me")
    assert resp.status_code == 401


async def test_get_me_invalid_token(client: AsyncClient):
    """A garbage bearer token returns 401."""
    resp = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": "Bearer this.is.not.a.valid.jwt"},
    )
    assert resp.status_code == 401


async def test_get_me_returns_expected_fields(auth_client: AsyncClient):
    """The /me response includes id, email, name, role, createdAt."""
    resp = await auth_client.get("/api/v1/auth/me")
    body = resp.json()
    for field in ("id", "email", "name", "role", "createdAt"):
        assert field in body, f"Missing field: {field}"


# ── PUT /me ───────────────────────────────────────────────────────────────────

async def test_update_me_name(auth_client: AsyncClient):
    """PUT /me with a new name returns 200 and the updated name."""
    resp = await auth_client.put("/api/v1/auth/me", json={"name": "Updated Name"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "Updated Name"


async def test_update_me_blank_name_rejected(auth_client: AsyncClient):
    """PUT /me with a blank name returns 422."""
    resp = await auth_client.put("/api/v1/auth/me", json={"name": "   "})
    assert resp.status_code == 422


# ── Refresh ───────────────────────────────────────────────────────────────────

async def test_refresh_token(auth_client: AsyncClient, db_session: AsyncSession):
    """POST /auth/refresh with a valid refresh token returns a new access_token."""
    # Get the user that was seeded by auth_client fixture
    from sqlalchemy import select
    from app.models.user import User

    result = await db_session.execute(select(User).where(User.email == "test@example.com"))
    user = result.scalar_one()

    refresh_token = create_refresh_token(str(user.id))
    resp = await auth_client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})
    assert resp.status_code == 200
    body = resp.json()
    assert "access_token" in body
    assert "refresh_token" in body


async def test_refresh_with_invalid_token(auth_client: AsyncClient):
    """POST /auth/refresh with a garbage token returns 401."""
    resp = await auth_client.post("/api/v1/auth/refresh", json={"refresh_token": "garbage.token.value"})
    assert resp.status_code == 401


async def test_refresh_with_access_token_rejected(auth_client: AsyncClient, db_session: AsyncSession):
    """POST /auth/refresh with an access token (wrong type) returns 401."""
    from sqlalchemy import select
    from app.models.user import User

    result = await db_session.execute(select(User).where(User.email == "test@example.com"))
    user = result.scalar_one()

    # Mint an access token and attempt to use it as a refresh token
    access_token, _ = create_access_token(str(user.id))
    resp = await auth_client.post("/api/v1/auth/refresh", json={"refresh_token": access_token})
    assert resp.status_code == 401


# ── Logout ────────────────────────────────────────────────────────────────────

async def test_logout_returns_200(auth_client: AsyncClient):
    """POST /auth/logout with a valid bearer token returns 200."""
    resp = await auth_client.post("/api/v1/auth/logout")
    assert resp.status_code == 200
    assert "message" in resp.json()


async def test_logout_without_token_returns_401(client: AsyncClient):
    """POST /auth/logout without a token returns 401."""
    resp = await client.post("/api/v1/auth/logout")
    assert resp.status_code == 401
