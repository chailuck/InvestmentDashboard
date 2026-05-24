"""User management endpoints (admin CRUD + self-service)."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user, require_admin
from app.auth.jwt import hash_password, verify_password
from app.database.session import get_db
from app.models.user import User
from app.schemas.users import (
    AdminResetPasswordRequest,
    ChangePasswordRequest,
    UserCreate,
    UserDetail,
    UserListResponse,
    UserUpdate,
)

router = APIRouter(prefix="/users", tags=["Users"])

AdminUser = Annotated[User, Depends(require_admin)]
CurrentUser = Annotated[User, Depends(get_current_user)]
DB = Annotated[AsyncSession, Depends(get_db)]


def _to_detail(user: User) -> UserDetail:
    return UserDetail(
        id=str(user.id),
        email=user.email,
        name=user.name,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at,
        updated_at=user.updated_at,
        last_login_at=user.last_login_at,
    )


# ── List users (admin) ──────────────────────────────────────────────────────
@router.get("", response_model=UserListResponse)
async def list_users(
    _admin: AdminUser,
    db: DB,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    role: str | None = Query(None),
    is_active: bool | None = Query(None),
    search: str | None = Query(None),
) -> UserListResponse:
    q = select(User)
    if role:
        q = q.where(User.role == role)
    if is_active is not None:
        q = q.where(User.is_active == is_active)
    if search:
        pattern = f"%{search}%"
        q = q.where((User.name.ilike(pattern)) | (User.email.ilike(pattern)))

    count_q = select(func.count()).select_from(q.subquery())
    total = (await db.execute(count_q)).scalar_one()

    q = q.order_by(User.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    users = (await db.execute(q)).scalars().all()

    return UserListResponse(users=[_to_detail(u) for u in users], total=total)


# ── Create user (admin) ────────────────────────────────────────────────────
@router.post("", response_model=UserDetail, status_code=status.HTTP_201_CREATED)
async def create_user(body: UserCreate, _admin: AdminUser, db: DB) -> UserDetail:
    existing = (await db.execute(select(User).where(User.email == body.email))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    user = User(
        email=body.email,
        name=body.name,
        hashed_password=hash_password(body.password),
        role=body.role,
        is_active=body.is_active,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return _to_detail(user)


# ── Get single user (admin or self) ───────────────────────────────────────
@router.get("/{user_id}", response_model=UserDetail)
async def get_user(user_id: str, current_user: CurrentUser, db: DB) -> UserDetail:
    if current_user.role != "admin" and str(current_user.id) != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    target = (await db.execute(select(User).where(User.id == uuid.UUID(user_id)))).scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return _to_detail(target)


# ── Update user (admin: any field; self: name only) ────────────────────────
@router.put("/{user_id}", response_model=UserDetail)
async def update_user(user_id: str, body: UserUpdate, current_user: CurrentUser, db: DB) -> UserDetail:
    is_admin = current_user.role == "admin"
    is_self = str(current_user.id) == user_id

    if not is_admin and not is_self:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    target = (await db.execute(select(User).where(User.id == uuid.UUID(user_id)))).scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if body.name is not None:
        target.name = body.name
    if is_admin:
        if body.email is not None:
            # Check uniqueness
            dup = (await db.execute(
                select(User).where(User.email == body.email, User.id != uuid.UUID(user_id))
            )).scalar_one_or_none()
            if dup:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already in use")
            target.email = body.email
        if body.role is not None:
            target.role = body.role
        if body.is_active is not None:
            target.is_active = body.is_active

    await db.commit()
    await db.refresh(target)
    return _to_detail(target)


# ── Activate / deactivate (admin) ──────────────────────────────────────────
@router.post("/{user_id}/deactivate", response_model=UserDetail)
async def deactivate_user(user_id: str, _admin: AdminUser, db: DB) -> UserDetail:
    target = (await db.execute(select(User).where(User.id == uuid.UUID(user_id)))).scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if str(target.id) == str(_admin.id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot deactivate yourself")
    target.is_active = False
    await db.commit()
    await db.refresh(target)
    return _to_detail(target)


@router.post("/{user_id}/activate", response_model=UserDetail)
async def activate_user(user_id: str, _admin: AdminUser, db: DB) -> UserDetail:
    target = (await db.execute(select(User).where(User.id == uuid.UUID(user_id)))).scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    target.is_active = True
    await db.commit()
    await db.refresh(target)
    return _to_detail(target)


# ── Admin force-reset password ─────────────────────────────────────────────
@router.post("/{user_id}/reset-password")
async def admin_reset_password(
    user_id: str, body: AdminResetPasswordRequest, _admin: AdminUser, db: DB
) -> dict[str, str]:
    target = (await db.execute(select(User).where(User.id == uuid.UUID(user_id)))).scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    target.hashed_password = hash_password(body.new_password)
    await db.commit()
    return {"message": "Password reset successfully"}


# ── Self: change own password ──────────────────────────────────────────────
@router.post("/me/change-password")
async def change_own_password(body: ChangePasswordRequest, current_user: CurrentUser, db: DB) -> dict[str, str]:
    if not verify_password(body.current_password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
    current_user.hashed_password = hash_password(body.new_password)
    await db.commit()
    return {"message": "Password changed successfully"}
