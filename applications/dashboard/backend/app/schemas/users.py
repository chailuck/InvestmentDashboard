"""User management schemas."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, field_validator


class UserCreate(BaseModel):
    email: EmailStr
    name: str
    password: str
    role: str = "viewer"
    is_active: bool = True

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        if v not in ("admin", "analyst", "viewer"):
            raise ValueError("Role must be admin, analyst, or viewer")
        return v

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Name cannot be blank")
        return v.strip()


class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in ("admin", "analyst", "viewer"):
            raise ValueError("Role must be admin, analyst, or viewer")
        return v


class UserDetail(BaseModel):
    id: str
    email: str
    name: str
    role: str
    is_active: bool
    created_at: datetime
    updated_at: datetime
    last_login_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class UserListResponse(BaseModel):
    users: list[UserDetail]
    total: int


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class AdminResetPasswordRequest(BaseModel):
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


# ── Clone-user schemas ────────────────────────────────────────────────────────

class ClonePreflightRequest(BaseModel):
    target_user_id: str

    @field_validator("target_user_id")
    @classmethod
    def validate_uuid(cls, v: str) -> str:
        try:
            uuid.UUID(v)
        except ValueError as exc:
            raise ValueError("target_user_id must be a valid UUID") from exc
        return v


class TableCounts(BaseModel):
    portfolios: int = 0
    holdings: int = 0
    investment_transactions: int = 0
    portfolio_positions_db: int = 0
    action_plans: int = 0
    purchase_plan_items: int = 0
    portfolio_plan_items: int = 0
    user_scan_configs: int = 0
    user_symbol_lists: int = 0
    weekly_scans: int = 0
    weekly_scan_items: int = 0
    pe_scan_results: int = 0
    symbol_notes: int = 0
    weekly_reviews: int = 0
    weekly_review_items: int = 0


class ClonePreflightResponse(BaseModel):
    source_user_id: str
    source_user_name: str
    target_user_id: str
    target_user_name: str
    source_counts: TableCounts
    target_existing_counts: TableCounts
    target_has_data: bool


class CloneExecuteRequest(BaseModel):
    target_user_id: str
    portfolio_mode_override: Optional[str] = None
    confirmed: bool

    @field_validator("target_user_id")
    @classmethod
    def validate_uuid(cls, v: str) -> str:
        try:
            uuid.UUID(v)
        except ValueError as exc:
            raise ValueError("target_user_id must be a valid UUID") from exc
        return v

    @field_validator("portfolio_mode_override")
    @classmethod
    def validate_portfolio_mode(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in ("excel", "db"):
            raise ValueError("portfolio_mode_override must be 'excel' or 'db'")
        return v

    @field_validator("confirmed")
    @classmethod
    def validate_confirmed(cls, v: bool) -> bool:
        if not v:
            raise ValueError("confirmed must be true to execute a clone operation")
        return v


class CloneExecuteResponse(BaseModel):
    cloned_by_admin_id: str
    cloned_by_admin_name: str
    source_user_id: str
    source_user_name: str
    target_user_id: str
    target_user_name: str
    portfolio_mode_applied: str
    cloned_at: datetime
    rows_cloned: TableCounts
    total_rows_cloned: int
