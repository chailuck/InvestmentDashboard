"""Email digest settings and on-demand send endpoints.

Routes (all under /api/v1/email):
    GET  /email/settings    — read current user's email digest preferences
    PUT  /email/settings    — update email digest preferences
    POST /email/send-now    — trigger an immediate digest send
    GET  /email/preview     — return widget data as JSON (no email sent)
"""

from __future__ import annotations

import base64
import binascii
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser, get_current_user_id, get_current_user_with_email
from app.core.config import get_settings
from app.core.logging import get_logger
from app.database.session import get_db
from app.models.user import User
from app.services.email_service import EmailService, SendResult

router = APIRouter(prefix="/email", tags=["Email"])

UserId = Annotated[str, Depends(get_current_user_id)]
DB = Annotated[AsyncSession, Depends(get_db)]

_log = get_logger("email.endpoint")


# ── Schemas ────────────────────────────────────────────────────────────────────

class EmailSettingsResponse(BaseModel):
    enabled: bool
    schedule_time: str        # HH:MM local (display only — stored in users table)
    recipient: str


class EmailSettingsUpdate(BaseModel):
    enabled: bool | None = None
    schedule_time: str | None = None   # HH:MM format, e.g. "17:30"
    recipient: str | None = None

    @field_validator("schedule_time")
    @classmethod
    def validate_time_format(cls, v: str | None) -> str | None:
        if v is None:
            return v
        parts = v.split(":")
        if len(parts) != 2:
            raise ValueError("schedule_time must be HH:MM")
        hh, mm = parts
        if not (hh.isdigit() and mm.isdigit()):
            raise ValueError("schedule_time must be HH:MM with numeric parts")
        if not (0 <= int(hh) <= 23 and 0 <= int(mm) <= 59):
            raise ValueError("schedule_time hours must be 00-23, minutes 00-59")
        return v

    @field_validator("recipient")
    @classmethod
    def validate_recipient(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if v and "@" not in v:
            raise ValueError("recipient must be a valid email address")
        return v


class SendResultResponse(BaseModel):
    success: bool
    recipient: str
    sent_at: str | None = None
    prices_total: int | None = None
    prices_refreshed: int | None = None
    prices_failed: list[str] | None = None
    price_refresh_duration_seconds: float | None = None
    error: str | None = None

    @classmethod
    def from_send_result(cls, result: SendResult) -> "SendResultResponse":
        pr = result.price_refresh
        return cls(
            success=result.success,
            recipient=result.recipient,
            sent_at=result.sent_at,
            prices_total=pr.total_symbols if pr else None,
            prices_refreshed=pr.refreshed if pr else None,
            prices_failed=pr.failed if pr else None,
            price_refresh_duration_seconds=pr.duration_seconds if pr else None,
            error=result.error,
        )


class SendExportRequest(BaseModel):
    subject: str = Field(..., min_length=1, max_length=200)
    html_body: str = Field(..., min_length=1)
    attachment_filename: str = Field(..., min_length=1, max_length=255)
    attachment_content: str = Field(..., min_length=1)  # base64-encoded JSON bytes

    @field_validator("attachment_filename")
    @classmethod
    def _safe_filename(cls, v: str) -> str:
        if any(c in v for c in ("/", "\\", "\r", "\n")) or not v.endswith(".json"):
            raise ValueError("attachment_filename must be a bare '*.json' name")
        return v

    @field_validator("subject")
    @classmethod
    def _no_crlf_subject(cls, v: str) -> str:
        # A mail Subject header must be a single line — CR/LF would allow
        # header injection (extra headers, e.g. a spoofed Bcc). Kept in
        # parity with attachment_filename's guard even though the recipient
        # is fixed to the JWT-derived email today.
        if "\r" in v or "\n" in v:
            raise ValueError("subject must not contain CR or LF characters")
        return v

    @field_validator("html_body")
    @classmethod
    def _no_nul_bytes(cls, v: str) -> str:
        # html_body is a full HTML document and legitimately contains
        # newlines, so only reject NUL bytes — never valid in text/HTML and
        # a known source of parser/truncation abuse in some C-based libs.
        if "\x00" in v:
            raise ValueError("html_body must not contain NUL bytes")
        return v


class SendExportResponse(BaseModel):
    success: bool
    recipient: str
    sent_at: str | None = None
    error: str | None = None


# ── Helper: resolve User or 404 ───────────────────────────────────────────────

async def _get_user(user_id: str, db: AsyncSession) -> User:
    uid = uuid.UUID(user_id)
    result = await db.execute(select(User).where(User.id == uid))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


# ── GET /email/settings ───────────────────────────────────────────────────────

@router.get("/settings", response_model=EmailSettingsResponse)
async def get_email_settings(user_id: UserId, db: DB) -> EmailSettingsResponse:
    """Return the current user's email digest preferences.

    Falls back to the global settings defaults when the user rows are not yet
    populated (the ALTER TABLE adds columns with defaults so this should not
    happen after startup, but is defensive).
    """
    user = await _get_user(user_id, db)
    settings = get_settings()

    # email_digest_enabled / email_digest_time / email_digest_recipient are
    # added via ALTER TABLE in main.py lifespan. SQLAlchemy does not know about
    # them through the ORM mapping so we read them via __dict__ with fallback
    # to settings defaults.
    enabled = getattr(user, "email_digest_enabled", settings.daily_email_enabled)
    schedule_time = getattr(user, "email_digest_time", "17:30") or "17:30"
    recipient = getattr(user, "email_digest_recipient", settings.daily_email_recipient) or ""

    return EmailSettingsResponse(
        enabled=bool(enabled),
        schedule_time=schedule_time,
        recipient=recipient,
    )


# ── PUT /email/settings ───────────────────────────────────────────────────────

@router.put("/settings", response_model=EmailSettingsResponse)
async def update_email_settings(
    body: EmailSettingsUpdate,
    user_id: UserId,
    db: DB,
) -> EmailSettingsResponse:
    """Update the current user's email digest preferences.

    Only provided fields are changed (partial update semantics).
    """
    from sqlalchemy import text

    uid = uuid.UUID(user_id)
    user = await _get_user(user_id, db)

    # Build SET clause dynamically — only touch supplied fields
    assignments: list[str] = []
    params: dict[str, Any] = {"uid": uid}

    if body.enabled is not None:
        assignments.append("email_digest_enabled = :enabled")
        params["enabled"] = body.enabled

    if body.schedule_time is not None:
        assignments.append("email_digest_time = :schedule_time")
        params["schedule_time"] = body.schedule_time

    if body.recipient is not None:
        assignments.append("email_digest_recipient = :recipient")
        params["recipient"] = body.recipient

    if assignments:
        await db.execute(
            text(f"UPDATE users SET {', '.join(assignments)} WHERE id = :uid"),
            params,
        )
        await db.commit()

    _log.info(
        "email.settings.updated",
        user_id=user_id,
        fields=list(params.keys()),
    )

    # Re-read to return the current DB state
    return await get_email_settings(user_id, db)


# ── POST /email/send-now ──────────────────────────────────────────────────────

@router.post("/send-now", response_model=SendResultResponse)
async def send_email_now(user_id: UserId, db: DB) -> SendResultResponse:
    """Trigger an immediate daily digest for the current user.

    Uses the user's ``email_digest_recipient`` setting; falls back to the global
    ``DAILY_EMAIL_RECIPIENT`` setting when the per-user field is empty.
    """
    settings = get_settings()
    user = await _get_user(user_id, db)

    per_user_recipient = getattr(user, "email_digest_recipient", "") or ""
    recipient = per_user_recipient.strip() or settings.daily_email_recipient

    if not recipient:
        raise HTTPException(
            status_code=422,
            detail=(
                "No recipient email configured. "
                "Set email_digest_recipient via PUT /email/settings or "
                "set the DAILY_EMAIL_RECIPIENT environment variable."
            ),
        )

    if not settings.gmail_user or not settings.gmail_app_password.get_secret_value():
        raise HTTPException(
            status_code=503,
            detail=(
                "Gmail credentials not configured. "
                "Set GMAIL_USER and GMAIL_APP_PASSWORD environment variables."
            ),
        )

    _log.info(
        "email.send_now.triggered",
        user_id=user_id,
        recipient=recipient,
    )

    svc = EmailService()
    result = await svc.send_daily_digest(db, user_id, recipient)
    return SendResultResponse.from_send_result(result)


# ── POST /email/send-export ───────────────────────────────────────────────────

@router.post("/send-export", response_model=SendExportResponse)
async def send_export(
    body: SendExportRequest,
    current_user: CurrentUser = Depends(get_current_user_with_email),
) -> SendExportResponse:
    """Send an ad-hoc export (e.g. a portfolio backup JSON) to the caller's own
    email address, taken from the JWT's ``email`` claim — never from request
    input, so a caller cannot redirect the export to an arbitrary address.

    Unlike ``send-now`` (which reports SMTP failure as a 200 with
    ``success: false``), this endpoint raises 502 on SMTP failure: an export
    request that silently fails to deliver is a distinct error state that
    callers must not be able to swallow.
    """
    settings = get_settings()

    if not settings.gmail_user or not settings.gmail_app_password.get_secret_value():
        raise HTTPException(
            status_code=503,
            detail=(
                "Gmail credentials not configured. "
                "Set GMAIL_USER and GMAIL_APP_PASSWORD environment variables."
            ),
        )

    try:
        attachment_bytes = base64.b64decode(body.attachment_content, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(
            status_code=400,
            detail=f"attachment_content is not valid base64: {exc}",
        ) from exc

    _log.info(
        "email.send_export.triggered",
        user_id=current_user.id,
        recipient=current_user.email,
        attachment_filename=body.attachment_filename,
    )

    svc = EmailService()
    result: SendResult = await svc.send_export_email(
        recipient_email=current_user.email,
        subject=body.subject,
        html_body=body.html_body,
        attachment_filename=body.attachment_filename,
        attachment_bytes=attachment_bytes,
    )

    if not result.success:
        _log.error(
            "email.send_export.failed",
            user_id=current_user.id,
            recipient=current_user.email,
            error=result.error,
        )
        raise HTTPException(
            status_code=502,
            detail=f"Failed to send export email: {result.error}",
        )

    _log.info(
        "email.send_export.sent",
        user_id=current_user.id,
        recipient=current_user.email,
    )
    return SendExportResponse(
        success=True,
        recipient=result.recipient,
        sent_at=result.sent_at,
    )


# ── GET /email/preview ────────────────────────────────────────────────────────

@router.get("/preview")
async def preview_widget_data(user_id: UserId, db: DB) -> dict[str, Any]:
    """Return the assembled widget data as JSON without sending an email.

    Useful for debugging template content and verifying data availability
    before enabling the scheduled send.
    """
    svc = EmailService()
    weekly_scan, purchase_plan, portfolio = await svc.fetch_widget_data(db, user_id)

    return {
        "weekly_scan": weekly_scan,
        "purchase_plan": purchase_plan,
        "portfolio": portfolio,
        "sections_available": {
            "weekly_scan": weekly_scan is not None,
            "purchase_plan": purchase_plan is not None,
            "portfolio": portfolio is not None,
        },
    }
