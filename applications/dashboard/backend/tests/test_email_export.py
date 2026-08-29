"""Tests for the POST /api/v1/email/send-export feature.

Covers three independent units, per the approved design (Gate 2):

1. ``app.auth.dependencies.get_current_user_with_email`` — an additive
   dependency alongside ``get_current_user_id`` that also surfaces the
   token's ``email`` claim. ``get_current_user_id`` itself is untouched and
   is not re-tested here (see test_auth.py).
2. ``app.services.email_service.EmailService.send_export_email`` — builds
   and sends a multipart/mixed MIME message with a JSON attachment.
   ``aiosmtplib.send`` is mocked; no real email is ever sent in this file.
3. ``POST /email/send-export`` — the HTTP route wiring the two together.

Key behavioural contract under test: unlike ``send-now`` (which reports SMTP
failure as an HTTP 200 with ``success: false``), ``send-export`` must raise
502 on SMTP failure — see test_send_export_smtp_failure_returns_502.
"""

from __future__ import annotations

import base64
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.security import HTTPAuthorizationCredentials
from httpx import AsyncClient
from jose import jwt as jose_jwt
from pydantic import ValidationError

import app.api.v1.endpoints.email as email_endpoint_module
import app.services.email_service as email_service_module
from app.api.v1.endpoints.email import SendExportRequest
from app.auth.dependencies import CurrentUser, get_current_user_with_email
from app.auth.jwt import create_access_token
from app.core.config import get_settings
from app.services.email_service import EmailService, SendResult

_settings = get_settings()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _credentials(token: str) -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


def _manual_token(payload_overrides: dict) -> str:
    """Build a JWT with the same shape as create_access_token, but with full
    control over claims (used to craft an expired token)."""
    base = {
        "sub": "11111111-1111-1111-1111-111111111111",
        "iat": datetime.now(timezone.utc),
        "jti": "test-jti",
        "type": "access",
        "email": "manual@example.com",
    }
    base.update(payload_overrides)
    return jose_jwt.encode(base, _settings.app_secret_key, algorithm=_settings.jwt_algorithm)


class _FakeSecret:
    def __init__(self, value: str) -> None:
        self._value = value

    def get_secret_value(self) -> str:
        return self._value


def _fake_settings(gmail_user: str = "sender@gmail.com", gmail_app_password: str = "app-password"):
    return SimpleNamespace(
        gmail_user=gmail_user,
        gmail_app_password=_FakeSecret(gmail_app_password),
    )


_VALID_EXPORT_BODY = {
    "subject": "Your portfolio export",
    "html_body": "<p>Attached is your export.</p>",
    "attachment_filename": "backup-2026-08-29.json",
    "attachment_content": base64.b64encode(b'{"positions": []}').decode(),
}


# ═════════════════════════════════════════════════════════════════════════════
# 1. get_current_user_with_email — unit tests
# ═════════════════════════════════════════════════════════════════════════════

async def test_get_current_user_with_email_valid_token():
    """A token carrying sub/email/jti returns a populated CurrentUser."""
    user_id = "22222222-2222-2222-2222-222222222222"
    token, _ = create_access_token(user_id, extra={"role": "analyst", "email": "alice@example.com"})

    result = await get_current_user_with_email(_credentials(token))

    assert isinstance(result, CurrentUser)
    assert result.id == user_id
    assert result.email == "alice@example.com"


async def test_get_current_user_with_email_missing_email_claim():
    """A token without an 'email' claim (e.g. minted before this feature, or
    via create_access_token with no extra) is rejected with 401."""
    user_id = "33333333-3333-3333-3333-333333333333"
    token, _ = create_access_token(user_id)  # no extra -> no email claim

    with pytest.raises(Exception) as exc_info:
        await get_current_user_with_email(_credentials(token))

    assert exc_info.value.status_code == 401
    assert "email" in exc_info.value.detail.lower()


async def test_get_current_user_with_email_invalid_token():
    """A garbage token is rejected with 401 (mirrors get_current_user_id)."""
    with pytest.raises(Exception) as exc_info:
        await get_current_user_with_email(_credentials("this.is.not.a.valid.jwt"))

    assert exc_info.value.status_code == 401


async def test_get_current_user_with_email_expired_token():
    """An expired token is rejected with 401."""
    expired = _manual_token({"exp": datetime.now(timezone.utc) - timedelta(minutes=5)})

    with pytest.raises(Exception) as exc_info:
        await get_current_user_with_email(_credentials(expired))

    assert exc_info.value.status_code == 401


async def test_get_current_user_with_email_missing_credentials():
    """No Authorization header at all -> 401 (credentials=None)."""
    with pytest.raises(Exception) as exc_info:
        await get_current_user_with_email(None)

    assert exc_info.value.status_code == 401


async def test_get_current_user_with_email_blacklisted_token(mock_redis):
    """A blacklisted (logged-out) token is rejected with 401, same as
    get_current_user_id."""
    mock_redis.exists = AsyncMock(return_value=1)
    user_id = "44444444-4444-4444-4444-444444444444"
    token, _ = create_access_token(user_id, extra={"email": "bob@example.com"})

    with pytest.raises(Exception) as exc_info:
        await get_current_user_with_email(_credentials(token))

    assert exc_info.value.status_code == 401
    assert "revoked" in exc_info.value.detail.lower()


# ═════════════════════════════════════════════════════════════════════════════
# 2. SendExportRequest.attachment_filename validator — unit tests
# ═════════════════════════════════════════════════════════════════════════════

def _make_request(**overrides) -> dict:
    body = dict(_VALID_EXPORT_BODY)
    body.update(overrides)
    return body


def test_attachment_filename_rejects_path_traversal():
    with pytest.raises(ValidationError):
        SendExportRequest(**_make_request(attachment_filename="../etc/passwd"))


def test_attachment_filename_rejects_backslash():
    with pytest.raises(ValidationError):
        SendExportRequest(**_make_request(attachment_filename="..\\windows\\system32.json"))


def test_attachment_filename_rejects_crlf():
    with pytest.raises(ValidationError):
        SendExportRequest(**_make_request(attachment_filename="name\r\n.json"))
    with pytest.raises(ValidationError):
        SendExportRequest(**_make_request(attachment_filename="name\n.json"))


def test_attachment_filename_rejects_non_json_extension():
    with pytest.raises(ValidationError):
        SendExportRequest(**_make_request(attachment_filename="backup-2026-08-29.txt"))


def test_attachment_filename_accepts_normal_name():
    req = SendExportRequest(**_make_request(attachment_filename="backup-2026-08-29.json"))
    assert req.attachment_filename == "backup-2026-08-29.json"


# ═════════════════════════════════════════════════════════════════════════════
# 2b. SendExportRequest.subject / html_body validators — unit tests
# ═════════════════════════════════════════════════════════════════════════════

def test_subject_rejects_cr():
    with pytest.raises(ValidationError):
        SendExportRequest(**_make_request(subject="Export\rInjected-Header: x"))


def test_subject_rejects_lf():
    with pytest.raises(ValidationError):
        SendExportRequest(**_make_request(subject="Export\nInjected-Header: x"))


def test_subject_accepts_normal_text():
    req = SendExportRequest(**_make_request(subject="Your portfolio export — 2026-08-29"))
    assert req.subject == "Your portfolio export — 2026-08-29"


def test_html_body_rejects_nul_byte():
    with pytest.raises(ValidationError):
        SendExportRequest(**_make_request(html_body="<p>hello\x00world</p>"))


def test_html_body_accepts_multiline_html():
    """html_body is a full HTML document — legitimate newlines must not be
    rejected (unlike subject, which must be a single line)."""
    multiline = "<html>\n<body>\n<p>hello</p>\n</body>\n</html>"
    req = SendExportRequest(**_make_request(html_body=multiline))
    assert req.html_body == multiline


def test_subject_rejects_empty_string():
    """subject declares min_length=1 — an empty string must be rejected at
    the schema layer (422), not silently accepted as a blank email subject."""
    with pytest.raises(ValidationError):
        SendExportRequest(**_make_request(subject=""))


def test_html_body_rejects_empty_string():
    """html_body declares min_length=1 — an empty body must be rejected at
    the schema layer (422), not silently accepted as a blank email."""
    with pytest.raises(ValidationError):
        SendExportRequest(**_make_request(html_body=""))


# ═════════════════════════════════════════════════════════════════════════════
# 3. EmailService.send_export_email — unit tests (aiosmtplib mocked)
# ═════════════════════════════════════════════════════════════════════════════

async def test_send_export_email_success_builds_correct_mime_structure():
    """Assert the message passed to aiosmtplib.send is multipart/mixed with a
    nested multipart/alternative (html-only) part and a JSON attachment part
    carrying the requested filename."""
    fake_send = AsyncMock(return_value=None)
    with (
        patch.object(email_service_module.aiosmtplib, "send", fake_send),
        patch.object(email_service_module, "get_settings", _fake_settings),
    ):
        svc = EmailService()
        result = await svc.send_export_email(
            recipient_email="recipient@example.com",
            subject="Export subject",
            html_body="<p>hello</p>",
            attachment_filename="my-export.json",
            attachment_bytes=b'{"a": 1}',
        )

    assert result.success is True
    assert result.recipient == "recipient@example.com"
    assert result.sent_at is not None

    fake_send.assert_awaited_once()
    sent_msg = fake_send.call_args.args[0]

    assert sent_msg.get_content_type() == "multipart/mixed"
    assert sent_msg["Subject"] == "Export subject"
    assert sent_msg["To"] == "recipient@example.com"

    parts = sent_msg.get_payload()
    assert len(parts) == 2

    alt_part, attachment_part = parts
    assert alt_part.get_content_type() == "multipart/alternative"
    html_subparts = alt_part.get_payload()
    assert len(html_subparts) == 1
    assert html_subparts[0].get_content_type() == "text/html"

    assert attachment_part.get_content_type() == "application/json"
    assert attachment_part.get_filename() == "my-export.json"
    assert attachment_part.get("Content-Disposition", "").startswith("attachment")


async def test_send_export_email_smtp_exception_returns_failure_not_raise():
    """If aiosmtplib.send raises, the method must catch it and return a
    failure SendResult — the exception must never propagate to the caller."""
    fake_send = AsyncMock(side_effect=RuntimeError("connection refused"))
    with (
        patch.object(email_service_module.aiosmtplib, "send", fake_send),
        patch.object(email_service_module, "get_settings", _fake_settings),
    ):
        svc = EmailService()
        result = await svc.send_export_email(
            recipient_email="recipient@example.com",
            subject="Export subject",
            html_body="<p>hello</p>",
            attachment_filename="my-export.json",
            attachment_bytes=b"{}",
        )

    assert isinstance(result, SendResult)
    assert result.success is False
    assert result.error == "Failed to send the email. Please try again later."


async def test_send_export_email_smtp_exception_logs_detail_but_hides_it_from_result():
    """The raw exception (which may contain SMTP hostnames/internal infra
    detail) must still reach the server-side log in full, even though it is
    no longer surfaced in SendResult.error / the HTTP response."""
    fake_send = AsyncMock(side_effect=RuntimeError("smtp.internal.example:587 connection refused"))
    with (
        patch.object(email_service_module.aiosmtplib, "send", fake_send),
        patch.object(email_service_module, "get_settings", _fake_settings),
        patch.object(email_service_module._log, "error") as mock_log_error,
    ):
        svc = EmailService()
        result = await svc.send_export_email(
            recipient_email="recipient@example.com",
            subject="Export subject",
            html_body="<p>hello</p>",
            attachment_filename="my-export.json",
            attachment_bytes=b"{}",
        )

    # Client-facing result carries no exception internals.
    assert "smtp.internal.example" not in (result.error or "")
    assert result.error == "Failed to send the email. Please try again later."

    # Server-side log call still carries the full exception detail.
    mock_log_error.assert_called_once()
    _, log_kwargs = mock_log_error.call_args
    assert "smtp.internal.example:587 connection refused" in log_kwargs["error"]


# ═════════════════════════════════════════════════════════════════════════════
# 4. POST /api/v1/email/send-export — integration tests
# ═════════════════════════════════════════════════════════════════════════════

async def test_send_export_smtp_not_configured_returns_503(auth_client: AsyncClient):
    with patch.object(email_endpoint_module, "get_settings", lambda: _fake_settings(gmail_user="")):
        resp = await auth_client.post("/api/v1/email/send-export", json=_VALID_EXPORT_BODY)
    assert resp.status_code == 503


async def test_send_export_happy_path_returns_200(auth_client: AsyncClient):
    """SMTP mocked to succeed -> 200, success true, recipient == JWT's email
    (test@example.com per the auth_client fixture)."""
    fake_send = AsyncMock(return_value=None)
    with (
        patch.object(email_endpoint_module, "get_settings", _fake_settings),
        patch.object(email_service_module, "get_settings", _fake_settings),
        patch.object(email_service_module.aiosmtplib, "send", fake_send),
    ):
        resp = await auth_client.post("/api/v1/email/send-export", json=_VALID_EXPORT_BODY)

    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["recipient"] == "test@example.com"
    assert body["sent_at"] is not None
    fake_send.assert_awaited_once()


async def test_send_export_smtp_failure_returns_502(auth_client: AsyncClient):
    """Distinct from send-now: SMTP failure must surface as HTTP 502, not a
    200 with success=false."""
    fake_send = AsyncMock(side_effect=RuntimeError("smtp broke"))
    with (
        patch.object(email_endpoint_module, "get_settings", _fake_settings),
        patch.object(email_service_module, "get_settings", _fake_settings),
        patch.object(email_service_module.aiosmtplib, "send", fake_send),
    ):
        resp = await auth_client.post("/api/v1/email/send-export", json=_VALID_EXPORT_BODY)

    assert resp.status_code == 502
    assert "Failed to send export email" in resp.json()["detail"]


async def test_send_export_smtp_failure_detail_hides_exception_internals(auth_client: AsyncClient):
    """The 502 response's `detail` must never contain the raw SMTP exception
    text (hostnames, connection errors, stack info) — only a generic
    client-safe message."""
    raw_exc_text = "smtp.internal-infra.example:587 Connection reset by peer"
    fake_send = AsyncMock(side_effect=RuntimeError(raw_exc_text))
    with (
        patch.object(email_endpoint_module, "get_settings", _fake_settings),
        patch.object(email_service_module, "get_settings", _fake_settings),
        patch.object(email_service_module.aiosmtplib, "send", fake_send),
    ):
        resp = await auth_client.post("/api/v1/email/send-export", json=_VALID_EXPORT_BODY)

    assert resp.status_code == 502
    detail = resp.json()["detail"]
    assert "smtp.internal-infra.example" not in detail
    assert "Connection reset by peer" not in detail
    assert "Failed to send the email. Please try again later." in detail


async def test_send_export_malformed_base64_returns_4xx(auth_client: AsyncClient):
    body = dict(_VALID_EXPORT_BODY)
    body["attachment_content"] = "!!!not-valid-base64!!!"
    with patch.object(email_endpoint_module, "get_settings", _fake_settings):
        resp = await auth_client.post("/api/v1/email/send-export", json=body)

    assert 400 <= resp.status_code < 500


async def test_send_export_unauthenticated_returns_401(client: AsyncClient):
    resp = await client.post("/api/v1/email/send-export", json=_VALID_EXPORT_BODY)
    assert resp.status_code == 401


async def test_send_export_bad_filename_returns_422(auth_client: AsyncClient):
    body = dict(_VALID_EXPORT_BODY)
    body["attachment_filename"] = "../etc/passwd"
    resp = await auth_client.post("/api/v1/email/send-export", json=body)
    assert resp.status_code == 422
