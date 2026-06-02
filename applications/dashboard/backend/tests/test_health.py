"""Tests for health check endpoints.

Endpoints covered
-----------------
GET /api/v1/health/live  → 200, {"status": "alive"}
GET /api/v1/health/ready → 200, {"status": "ready"}
GET /api/v1/health       → 200, full HealthStatus shape
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient


# ── /live ────────────────────────────────────────────────────────────────────

async def test_live_returns_200(client: AsyncClient):
    resp = await client.get("/api/v1/health/live")
    assert resp.status_code == 200


async def test_live_returns_alive_status(client: AsyncClient):
    resp = await client.get("/api/v1/health/live")
    assert resp.json() == {"status": "alive"}


# ── /ready ───────────────────────────────────────────────────────────────────

async def test_ready_returns_200(client: AsyncClient):
    resp = await client.get("/api/v1/health/ready")
    assert resp.status_code == 200


async def test_ready_returns_ready_status(client: AsyncClient):
    resp = await client.get("/api/v1/health/ready")
    assert resp.json() == {"status": "ready"}


# ── / (full health check) ────────────────────────────────────────────────────

async def test_health_root_returns_200(client: AsyncClient):
    resp = await client.get("/api/v1/health")
    assert resp.status_code == 200


async def test_health_root_contains_required_fields(client: AsyncClient):
    resp = await client.get("/api/v1/health")
    body = resp.json()
    assert "status" in body
    assert "uptime_seconds" in body
    assert "version" in body
    assert "checks" in body


async def test_health_root_uptime_is_positive(client: AsyncClient):
    resp = await client.get("/api/v1/health")
    assert resp.json()["uptime_seconds"] >= 0


async def test_health_root_version_is_string(client: AsyncClient):
    resp = await client.get("/api/v1/health")
    assert isinstance(resp.json()["version"], str)
    assert resp.json()["version"] != ""
