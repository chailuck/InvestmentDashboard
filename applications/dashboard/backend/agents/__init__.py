"""
Multi-agent AI development system for the enterprise investment platform.

Quick start:

    from agents.orchestrator import create_orchestrator
    from agents.core.models import AgentTask

    async with create_orchestrator() as orch:
        task = orch.build_task(
            task_type="frontend_component",
            payload={"name": "PortfolioCard", "description": "Card showing portfolio summary"},
        )
        response = await orch.dispatch(task)
        print(response.content)
"""

from .core import (
    AgentMemory,
    AgentRegistry,
    AgentResponse,
    AgentRouter,
    AgentTask,
    AgentType,
    BaseAgent,
    SharedContext,
    TaskPriority,
    TaskQueue,
    TaskStatus,
)
from .orchestrator import AgentOrchestrator, create_orchestrator

__all__ = [
    # Core framework
    "BaseAgent",
    "AgentMemory",
    "AgentRegistry",
    "AgentResponse",
    "AgentRouter",
    "AgentTask",
    "AgentType",
    "SharedContext",
    "TaskPriority",
    "TaskQueue",
    "TaskStatus",
    # Orchestration
    "AgentOrchestrator",
    "create_orchestrator",
]
