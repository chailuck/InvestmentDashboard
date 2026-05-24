"""
Structured logging configuration for the agent system.
"""

from __future__ import annotations

import logging
import logging.config
import sys
from typing import Any

import structlog


def configure_logging(
    log_level: str = "INFO",
    json_output: bool = False,
    service_name: str = "investment-agents",
) -> None:
    """
    Configure structlog + stdlib logging for the agent framework.

    Call once at application startup before agents are initialised.
    """
    shared_processors: list[Any] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        _add_service_name(service_name),
    ]

    if json_output:
        renderer: Any = structlog.processors.JSONRenderer()
    else:
        renderer = structlog.dev.ConsoleRenderer(colors=sys.stderr.isatty())

    structlog.configure(
        processors=shared_processors + [
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
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

    root_logger = logging.getLogger()
    root_logger.handlers.clear()
    root_logger.addHandler(handler)
    root_logger.setLevel(log_level.upper())

    # Silence noisy third-party loggers
    for noisy in ("httpx", "httpcore", "openai", "anthropic"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def _add_service_name(service_name: str) -> Any:
    def processor(
        logger: Any, method: str, event_dict: dict[str, Any]
    ) -> dict[str, Any]:
        event_dict["service"] = service_name
        return event_dict

    return processor


def get_agent_logger(agent_id: str, agent_type: str) -> Any:
    """Return a structlog logger pre-bound with agent identity."""
    return structlog.get_logger().bind(
        agent_id=agent_id,
        agent_type=agent_type,
    )


class TaskLogger:
    """Context manager that auto-logs task start/end with timing."""

    def __init__(self, logger: Any, task_id: str, task_type: str) -> None:
        self._log = logger
        self._task_id = task_id
        self._task_type = task_type
        self._start: float = 0.0

    async def __aenter__(self) -> "TaskLogger":
        import time
        self._start = time.monotonic()
        self._log.info(
            "task_start",
            task_id=self._task_id,
            task_type=self._task_type,
        )
        return self

    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        import time
        elapsed_ms = (time.monotonic() - self._start) * 1000
        if exc_type:
            self._log.error(
                "task_error",
                task_id=self._task_id,
                elapsed_ms=round(elapsed_ms, 2),
                error=str(exc_val),
            )
        else:
            self._log.info(
                "task_complete",
                task_id=self._task_id,
                elapsed_ms=round(elapsed_ms, 2),
            )
