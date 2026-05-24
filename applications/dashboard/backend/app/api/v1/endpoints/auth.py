"""Authentication endpoints."""

from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user, get_current_user_id
from app.auth.jwt import (
    create_access_token,
    create_refresh_token,
    hash_password,
    verify_password,
    verify_token,
)
from app.database.redis import auth_cache
from app.database.session import get_db
from app.models.user import User
from app.schemas.auth import LoginRequest, RefreshRequest, TokenResponse, UserResponse
from app.schemas.users import ForgotPasswordRequest, ResetPasswordRequest

router = APIRouter(prefix="/auth", tags=["Auth"])

_RESET_TTL = 3600  # 1 hour


def _user_response(user: User) -> UserResponse:
    return UserResponse(
        id=str(user.id),
        email=user.email,
        name=user.name,
        role=user.role,
        createdAt=user.created_at.isoformat(),
    )


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")

    access_token, expires_in = create_access_token(
        str(user.id), extra={"role": user.role, "email": user.email}
    )
    refresh_token = create_refresh_token(str(user.id))

    user.last_login_at = datetime.now(timezone.utc)
    await db.commit()

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=expires_in,
        user=_user_response(user),
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(body: RefreshRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    try:
        payload = verify_token(body.refresh_token, expected_type="refresh")
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

    result = await db.execute(select(User).where(User.id == uuid.UUID(payload["sub"])))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or disabled")

    access_token, expires_in = create_access_token(
        str(user.id), extra={"role": user.role, "email": user.email}
    )
    new_refresh = create_refresh_token(str(user.id))

    return TokenResponse(
        access_token=access_token,
        refresh_token=new_refresh,
        expires_in=expires_in,
        user=_user_response(user),
    )


@router.post("/logout")
async def logout(user_id: str = Depends(get_current_user_id)) -> dict[str, str]:
    # Blacklist token JTI — piggyback on auth_cache with short TTL
    await auth_cache.set(f"blacklist:{user_id}", "1", ttl=3600 * 24 * 7)
    return {"message": "Logged out successfully"}


@router.get("/me", response_model=UserResponse)
async def me(current_user: User = Depends(get_current_user)) -> UserResponse:
    return _user_response(current_user)


@router.put("/me", response_model=UserResponse)
async def update_me(
    body: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserResponse:
    if name := body.get("name"):
        current_user.name = name.strip()
    await db.commit()
    await db.refresh(current_user)
    return _user_response(current_user)


# ── Password reset flow ─────────────────────────────────────────────────────

@router.post("/forgot-password")
async def forgot_password(
    body: ForgotPasswordRequest,
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """
    Generates a password-reset token and stores it in Redis (1 hr TTL).
    In production this would email the link; in dev the token is returned directly.
    """
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    # Always return the same shape to avoid user enumeration
    if not user or not user.is_active:
        return {"message": "If that email is registered, a reset link has been sent."}

    token = secrets.token_urlsafe(32)
    await auth_cache.set(f"pwd_reset:{token}", str(user.id), ttl=_RESET_TTL)

    from app.core.config import get_settings
    settings = get_settings()

    if settings.is_development:
        # Surface the token directly so the dev UI can use it without email
        return {
            "message": "Reset token generated (dev mode — token returned directly).",
            "reset_token": token,
        }
    return {"message": "If that email is registered, a reset link has been sent."}


@router.post("/reset-password")
async def reset_password(
    body: ResetPasswordRequest,
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    user_id = await auth_cache.get(f"pwd_reset:{body.token}")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired reset token")

    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User not found")

    user.hashed_password = hash_password(body.new_password)
    await db.commit()
    await auth_cache.delete(f"pwd_reset:{body.token}")
    return {"message": "Password has been reset successfully"}
