"""
AgentOrchestrator — top-level entry point that wires agents together.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from langchain_anthropic import ChatAnthropic
from langchain_core.language_models import BaseChatModel

from .ai.ai_agent import AIAgent
from .api.api_agent import APIAgent
from .architect.chief_architect_agent import ChiefArchitectAgent
from .backend.backend_lead_agent import BackendLeadAgent
from .core.context import SharedContext
from .core.models import AgentResponse, AgentTask, AgentType, TaskPriority
from .core.registry import AgentRegistry
from .core.router import AgentRouter
from .core.task_queue import TaskQueue
from .database.database_agent import DatabaseAgent
from .devops.devops_agent import DevOpsAgent
from .frontend.frontend_lead_agent import FrontendLeadAgent
from .performance.performance_agent import PerformanceAgent
from .qa.qa_agent import QAAgent
from .responsive.responsive_agent import ResponsiveAgent
from .security.security_agent import SecurityAgent
from .skills.skills_agent import SkillsAgent
from .uiux.uiux_agent import UIUXAgent

logger = logging.getLogger(__name__)


class AgentOrchestrator:
    """
    Bootstraps all agents, wires shared services, and exposes the
    primary dispatch interface for the rest of the application.

    Usage:
        async with AgentOrchestrator.create() as orchestrator:
            response = await orchestrator.dispatch(task)
    """

    def __init__(
        self,
        llm: BaseChatModel,
        context: SharedContext,
        registry: AgentRegistry,
        router: AgentRouter,
        queue: TaskQueue,
    ) -> None:
        self.llm = llm
        self.context = context
        self.registry = registry
        self.router = router
        self.queue = queue
        self._worker_task: asyncio.Task[None] | None = None

    # -----------------------------------------------------------------------
    # Factory
    # -----------------------------------------------------------------------

    @classmethod
    async def create(
        cls,
        llm: BaseChatModel | None = None,
        model: str = "claude-sonnet-4-6",
        anthropic_api_key: str | None = None,
        worker_count: int = 4,
    ) -> "AgentOrchestrator":
        """
        Create and fully initialise the orchestrator.

        If `llm` is not provided, a ChatAnthropic instance is created
        using `model` and `anthropic_api_key` (or ANTHROPIC_API_KEY env var).
        """
        if llm is None:
            kwargs: dict[str, Any] = {"model": model}
            if anthropic_api_key:
                kwargs["api_key"] = anthropic_api_key
            llm = ChatAnthropic(**kwargs)

        context = SharedContext()
        registry = AgentRegistry()
        queue = TaskQueue()

        orchestrator = cls(
            llm=llm,
            context=context,
            registry=registry,
            router=AgentRouter(registry),
            queue=queue,
        )

        await orchestrator._register_all_agents()
        await orchestrator._seed_context()
        orchestrator._start_workers(worker_count)
        return orchestrator

    # -----------------------------------------------------------------------
    # Agent registration
    # -----------------------------------------------------------------------

    async def _register_all_agents(self) -> None:
        agent_classes = [
            ChiefArchitectAgent,
            FrontendLeadAgent,
            BackendLeadAgent,
            UIUXAgent,
            ResponsiveAgent,
            APIAgent,
            DatabaseAgent,
            AIAgent,
            SkillsAgent,
            DevOpsAgent,
            SecurityAgent,
            QAAgent,
            PerformanceAgent,
        ]

        for AgentCls in agent_classes:
            agent = AgentCls(
                llm=self.llm,
                registry=self.registry,
                context=self.context,
            )
            # Inject registry back-reference so agents can delegate
            agent._registry = self.registry
            await self.registry.register(agent)

        logger.info(
            "Registered %d agents: %s",
            len(agent_classes),
            [c.__name__ for c in agent_classes],
        )

    async def _seed_context(self) -> None:
        """Populate shared context with platform-wide configuration."""
        await self.context.set_many(
            {
                "platform.name": "InvestmentDashboard",
                "platform.version": "1.0.0",
                "platform.stack.frontend": "React 18 + TypeScript + Vite",
                "platform.stack.backend": "FastAPI + Python 3.12",
                "platform.stack.database": "PostgreSQL 16 + TimescaleDB",
                "platform.stack.cache": "Redis 7",
                "platform.stack.infra": "Kubernetes on AWS EKS",
                "platform.auth": "JWT RS256 + RBAC",
                "platform.ai": "LangChain + Anthropic Claude",
                "platform.ui": "Dark mode + Tailwind CSS + Shadcn/ui",
            },
            agent_id="orchestrator",
        )

    # -----------------------------------------------------------------------
    # Worker pool (queue consumer)
    # -----------------------------------------------------------------------

    def _start_workers(self, count: int) -> None:
        async def _worker() -> None:
            while True:
                task = await self.queue.dequeue(timeout=1.0)
                if task is None:
                    continue
                try:
                    await self.router.dispatch(task)
                    await self.queue.mark_complete(task.task_id)
                except Exception:
                    logger.exception("Worker failed for task %s", task.task_id)
                finally:
                    self.queue.task_done()

        loop = asyncio.get_event_loop()
        for i in range(count):
            t = loop.create_task(_worker(), name=f"agent-worker-{i}")
            if i == 0:
                self._worker_task = t

    # -----------------------------------------------------------------------
    # Public dispatch interface
    # -----------------------------------------------------------------------

    async def dispatch(self, task: AgentTask) -> AgentResponse:
        """Route a task directly (bypass queue) — for synchronous request/reply."""
        return await self.router.dispatch(task)

    async def enqueue(self, task: AgentTask) -> None:
        """Enqueue a task for async background processing."""
        await self.queue.enqueue(task)

    async def dispatch_to(
        self, agent_type: AgentType, task: AgentTask
    ) -> AgentResponse:
        """Dispatch directly to a specific agent type."""
        agents = self.registry.get_by_type(agent_type)
        if not agents:
            raise RuntimeError(f"No agent registered for type {agent_type.value}")
        return await agents[0].run(task)

    # -----------------------------------------------------------------------
    # Convenience builders
    # -----------------------------------------------------------------------

    def build_task(
        self,
        task_type: str,
        payload: dict[str, Any] | None = None,
        priority: TaskPriority = TaskPriority.NORMAL,
        dependencies: list[str] | None = None,
    ) -> AgentTask:
        return AgentTask(
            task_type=task_type,
            payload=payload or {},
            priority=priority,
            dependencies=dependencies or [],
        )

    # -----------------------------------------------------------------------
    # Introspection
    # -----------------------------------------------------------------------

    def health(self) -> dict[str, Any]:
        return {
            "agents": self.registry.health_summary(),
            "queue": self.queue.metrics(),
            "context_keys": len(self.context._store),
        }

    def routing_table(self) -> dict[str, str]:
        return self.router.routing_table()

    # -----------------------------------------------------------------------
    # Context manager support
    # -----------------------------------------------------------------------

    async def close(self) -> None:
        if self._worker_task:
            self._worker_task.cancel()
        logger.info("AgentOrchestrator shutdown complete")

    async def __aenter__(self) -> "AgentOrchestrator":
        return self

    async def __aexit__(self, *_: Any) -> None:
        await self.close()


# ---------------------------------------------------------------------------
# asynccontextmanager helper
# ---------------------------------------------------------------------------

@asynccontextmanager
async def create_orchestrator(
    model: str = "claude-sonnet-4-6",
    anthropic_api_key: str | None = None,
    worker_count: int = 4,
) -> AsyncIterator[AgentOrchestrator]:
    orchestrator = await AgentOrchestrator.create(
        model=model,
        anthropic_api_key=anthropic_api_key,
        worker_count=worker_count,
    )
    try:
        yield orchestrator
    finally:
        await orchestrator.close()
