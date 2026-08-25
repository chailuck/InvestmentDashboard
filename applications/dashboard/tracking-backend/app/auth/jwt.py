"""JWT verification only.

This service NEVER issues tokens (no create_access_token / create_refresh_token
/ password hashing here — those live exclusively in the main backend, which is
the sole identity provider). It only verifies signatures/expiry on tokens that
the main backend already issued, using the shared APP_SECRET_KEY.

This is intentionally a subset of applications/dashboard/backend/app/auth/jwt.py
— duplicated (not imported) to keep this service's codebase fully independent.
"""

from __future__ import annotations

from typing import Any

from jose import JWTError, jwt

from app.core.config import get_settings

settings = get_settings()


def decode_token(token: str) -> dict[str, Any]:
    return jwt.decode(token, settings.app_secret_key, algorithms=[settings.jwt_algorithm])


def verify_token(token: str, expected_type: str = "access") -> dict[str, Any]:
    try:
        payload = decode_token(token)
        if payload.get("type") != expected_type:
            raise ValueError(f"Expected token type '{expected_type}'")
        return payload
    except JWTError as exc:
        raise ValueError(f"Invalid token: {exc}") from exc
