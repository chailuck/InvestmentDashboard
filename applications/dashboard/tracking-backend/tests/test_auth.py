"""JWT verification behavior for get_current_user_id.

Covers: missing credentials, invalid signature, expired token, wrong token
type, missing jti, blacklisted jti (fail-closed on Redis error too), and the
happy path. Also covers the two unauthenticated health endpoints.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, patch

import pytest
from jose import jwt as jose_jwt

from tests.conftest import TEST_SECRET_KEY, make_token

PREFIX = "/api/v1/tracking"


@pytest.mark.asyncio
async def test_missing_credentials_returns_401(client):
    resp = await client.get(f"{PREFIX}/sets")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_invalid_signature_returns_401(client):
    bad_token = jose_jwt.encode(
        {"sub": str(uuid.uuid4()), "type": "access", "jti": str(uuid.uuid4())},
        "wrong-secret-key-that-does-not-match-app-secret",
        algorithm="HS256",
    )
    resp = await client.get(f"{PREFIX}/sets", headers={"Authorization": f"Bearer {bad_token}"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_expired_token_returns_401(client, user_a_id):
    token, _ = make_token(user_a_id, expired=True)
    resp = await client.get(f"{PREFIX}/sets", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_wrong_token_type_returns_401(client, user_a_id):
    token, _ = make_token(user_a_id, token_type="refresh")
    resp = await client.get(f"{PREFIX}/sets", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_missing_jti_returns_401(client, user_a_id):
    token = jose_jwt.encode(
        {"sub": user_a_id, "type": "access"}, TEST_SECRET_KEY, algorithm="HS256"
    )
    resp = await client.get(f"{PREFIX}/sets", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_blacklisted_token_returns_401(client, user_a_id, fake_redis):
    token, jti = make_token(user_a_id)
    fake_redis.exists = AsyncMock(return_value=1)  # simulate blacklisted jti
    resp = await client.get(f"{PREFIX}/sets", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401
    assert "revoked" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_redis_unavailable_fails_closed_503(client, user_a_id, fake_redis):
    import redis.asyncio as aioredis

    token, _ = make_token(user_a_id)
    fake_redis.exists = AsyncMock(side_effect=aioredis.RedisError("connection refused"))
    resp = await client.get(f"{PREFIX}/sets", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 503


@pytest.mark.asyncio
async def test_valid_token_returns_200(auth_client):
    resp = await auth_client.get(f"{PREFIX}/sets")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_health_live_no_auth_required(client):
    resp = await client.get(f"{PREFIX}/health/live")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_health_ready_no_auth_required(client):
    resp = await client.get(f"{PREFIX}/health/ready")
    assert resp.status_code in (200, 503)
    assert "checks" in resp.json()
