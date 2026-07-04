"""APScheduler integration — daily email digest job.

The scheduler is an AsyncIOScheduler embedded in the FastAPI process.
It is started in the lifespan only when ``DAILY_EMAIL_ENABLED=true``.

Exported surface:
    start_scheduler(cron_expression)   — call once at startup
    stop_scheduler()                   — call once at shutdown
"""

from __future__ import annotations

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.core.logging import get_logger

_log = get_logger("scheduler")

# Module-level singleton — one scheduler per process
_scheduler: AsyncIOScheduler | None = None


# ── Scheduled job ─────────────────────────────────────────────────────────────

async def daily_email_job() -> None:
    """Entry point invoked by APScheduler on the configured cron cadence.

    Imports are deferred inside the function body to avoid circular-import
    issues at module load time (``app.core.config`` is imported in many places).
    """
    from app.core.config import get_settings
    from app.database.session import AsyncSessionLocal
    from app.services.email_service import EmailService

    log = get_logger("scheduler.daily_email")
    settings = get_settings()

    if not settings.daily_email_enabled:
        log.info("scheduler.daily_email.disabled_by_config")
        return

    recipient = settings.daily_email_recipient
    if not recipient:
        log.error(
            "scheduler.daily_email.no_recipient",
            hint="Set DAILY_EMAIL_RECIPIENT env var",
        )
        return

    # Resolve user_id from the recipient address so we can scope DB queries
    async with AsyncSessionLocal() as db:
        from sqlalchemy import select
        from app.models.user import User

        result = await db.execute(
            select(User).where(User.email == recipient)
        )
        user = result.scalar_one_or_none()

        if user is None:
            log.error(
                "scheduler.daily_email.user_not_found",
                email=recipient,
                hint="Ensure DAILY_EMAIL_RECIPIENT matches a registered user",
            )
            return

        log.info(
            "scheduler.daily_email.job_start",
            user_id=str(user.id),
            recipient=recipient,
        )

        svc = EmailService()
        send_result = await svc.send_daily_digest(db, str(user.id), recipient)

    if send_result.success:
        log.info(
            "scheduler.daily_email.job_success",
            recipient=send_result.recipient,
            sent_at=send_result.sent_at,
            prices_refreshed=(
                send_result.price_refresh.refreshed
                if send_result.price_refresh else None
            ),
        )
    else:
        log.error(
            "scheduler.daily_email.job_failed",
            recipient=send_result.recipient,
            error=send_result.error,
        )


# ── Lifecycle helpers ─────────────────────────────────────────────────────────

def start_scheduler(cron_expression: str = "30 10 * * 1-5") -> None:
    """Create and start the AsyncIOScheduler with the daily digest job.

    Args:
        cron_expression: Standard 5-field cron string (UTC).
                         Default ``"30 10 * * 1-5"`` fires Mon–Fri at 10:30 UTC
                         which is 17:30 Bangkok time (ICT = UTC+7).
    """
    global _scheduler

    if _scheduler is not None and _scheduler.running:
        _log.warning("scheduler.already_running — skipping second start")
        return

    _scheduler = AsyncIOScheduler(timezone="UTC")
    _scheduler.add_job(
        daily_email_job,
        trigger=CronTrigger.from_crontab(cron_expression, timezone="UTC"),
        id="daily_email",
        name="Daily Email Digest",
        max_instances=1,           # never overlap — previous run must finish first
        misfire_grace_time=3600,   # fire up to 1 hour late if the server was down
        replace_existing=True,
    )
    _scheduler.start()

    _log.info(
        "scheduler.started",
        cron=cron_expression,
        timezone="UTC",
    )


def stop_scheduler() -> None:
    """Gracefully shut down the scheduler (non-blocking)."""
    global _scheduler

    if _scheduler is None:
        return

    if _scheduler.running:
        try:
            _scheduler.shutdown(wait=False)
            _log.info("scheduler.stopped")
        except Exception as exc:
            _log.warning("scheduler.stop_error", error=str(exc))

    _scheduler = None
