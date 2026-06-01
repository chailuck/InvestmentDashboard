"""Authentication endpoints."""


import secrets
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import BLACKLIST_KEY_PREFIX, bearer_scheme, get_current_user, get_current_user_id
from app.auth.jwt import (
    create_access_token,
    create_refresh_token,
    hash_password,
    verify_password,
    verify_token,
)
from app.core.logging import get_logger
from app.core.rate_limit import limiter
from app.database.redis import auth_cache, get_redis
from app.database.session import get_db
from app.models.user import User
from app.schemas.auth import LoginRequest, RefreshRequest, TokenResponse, UserResponse, UserUpdateRequest
from app.schemas.users import ForgotPasswordRequest, ResetPasswordRequest

router = APIRouter(prefix="/auth", tags=["Auth"])
_log = get_logger("auth")

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
@limiter.limit("5/minute")
async def login(request: Request, body: LoginRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if not user or not verify_password(body.password, user.hashed_password):
        _log.warning("Failed login attempt", email=body.email, ip=request.client.host if request.client else "unknown")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")

    access_token, expires_in = create_access_token(
        str(user.id), extra={"role": user.role, "email": user.email}
    )
    refresh_token = create_refresh_token(str(user.id))

    user.last_login_at = datetime.now(timezone.utc)
    await db.commit()

    _log.info("Successful login", user_id=str(user.id), email=user.email)
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
async def logout(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict[str, str]:
    """
    Invalidate the current access token by adding its JTI to the Redis blacklist.
    TTL is set to the token's remaining lifetime so the blacklist entry auto-expires.
    """
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing credentials")

    try:
        payload = verify_token(credentials.credentials)
    except ValueError as exc:
        # Token is already invalid â€” treat as successful logout
        _log.info("Logout called with invalid token", error=str(exc))
        return {"message": "Logged out successfully"}

    jti = payload.get("jti")
    exp = payload.get("exp")

    if jti and exp:
        now = int(datetime.now(timezone.utc).timestamp())
        ttl = max(int(exp) - now, 1)  # never 0 â€” some Redis configs treat 0 as no expiry
        r = await get_redis()
        await r.set(f"{BLACKLIST_KEY_PREFIX}{jti}", "1", ex=ttl)
        _log.info("Token blacklisted on logout", jti=jti, ttl_seconds=ttl)

    return {"message": "Logged out successfully"}


@router.get("/me", response_model=UserResponse)
async def me(current_user: User = Depends(get_current_user)) -> UserResponse:
    return _user_response(current_user)


@router.put("/me", response_model=UserResponse)
async def update_me(
    body: UserUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserResponse:
    current_user.name = body.name
    await db.commit()
    await db.refresh(current_user)
    return _user_response(current_user)


# â”€â”€ Password reset flow â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.post("/forgot-password")
@limiter.limit("3/minute")
async def forgot_password(
    request: Request,
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
            "message": "Reset token generated (dev mode â€” token returned directly).",
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
