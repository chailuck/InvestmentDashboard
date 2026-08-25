"""Structured logging setup using structlog.

Mirrors applications/dashboard/backend/app/core/logging.py exactly (this
service is fully independent and does not import from that package, so the
setup is duplicated here). Every log line is enriched with `service_name`
so log aggregation can distinguish this service from the main backend, and
with `request_id`/`correlation_id` via structlog.contextvars — those two are
bound per-request by the RequestContextMiddleware in main.py.
"""

from __future__ import annotations

import logging
import sys
from typing import Any

import structlog

SERVICE_NAME = "tracking-backend"


def _add_service_name(logger: Any, method_name: str, event_dict: dict[str, Any]) -> dict[str, Any]:
    event_dict.setdefault("service_name", SERVICE_NAME)
    return event_dict


def configure_logging(log_level: str = "INFO", json_output: bool = False) -> None:
    shared_processors: list[Any] = [
        structlog.contextvars.merge_contextvars,
        _add_service_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]

    renderer: Any = (
        structlog.processors.JSONRenderer()
        if json_output
        else structlog.dev.ConsoleRenderer(colors=sys.stderr.isatty())
    )

    structlog.configure(
        processors=shared_processors + [structlog.stdlib.ProcessorFormatter.wrap_for_formatter],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, log_level.upper(), logging.INFO)
        ),
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    formatter = structlog.stdlib.ProcessorFormatter(
        processor=renderer,
        foreign_pre_chain=shared_processors,
    )

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(log_level.upper())

    for noisy in ("httpx", "httpcore", "sqlalchemy.engine", "uvicorn.access"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def get_logger(name: str) -> Any:
    return structlog.get_logger(name)
