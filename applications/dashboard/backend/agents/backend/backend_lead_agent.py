"""
BackendLeadAgent — governs backend service architecture.
"""

from __future__ import annotations

from typing import ClassVar

from ..core.base_agent import BaseAgent
from ..core.models import AgentResponse, AgentTask, AgentType, Artifact
from ..shared.prompts import BACKEND_LEAD_SYSTEM


class BackendLeadAgent(BaseAgent):
    """
    Manages FastAPI service architecture, cross-service concerns,
    dependency injection, and middleware configuration.
    """

    agent_type: ClassVar[AgentType] = AgentType.BACKEND_LEAD

    capabilities: ClassVar[list[str]] = [
        "backend_service",
        "backend_architecture",
        "microservice_design",
        "middleware_setup",
        "dependency_injection",
        "error_handling",
        "backend_review",
    ]

    system_prompt: ClassVar[str] = BACKEND_LEAD_SYSTEM

    async def process_task(self, task: AgentTask) -> AgentResponse:
        dispatch = {
            "backend_service": self._generate_service,
            "backend_architecture": self._design_architecture,
            "microservice_design": self._design_microservice,
            "middleware_setup": self._setup_middleware,
            "dependency_injection": self._design_di,
            "error_handling": self._design_error_handling,
            "backend_review": self._review_backend,
        }
        handler = dispatch.get(task.task_type)
        if handler:
            return await handler(task)
        return await self._generic(task)

    async def _generate_service(self, task: AgentTask) -> AgentResponse:
        domain = task.payload.get("domain", "")
        operations = task.payload.get("operations", [])

        prompt = (
            f"Generate a FastAPI service layer for the `{domain}` domain.\n\n"
            f"Operations: {operations}\n\n"
            f"Produce:\n"
            f"1. Service class with async methods\n"
            f"2. Pydantic request/response schemas\n"
            f"3. Repository interface (abstract base)\n"
            f"4. FastAPI router with endpoints (versioned under /api/v1/)\n"
            f"5. Dependency injection setup\n"
            f"6. Custom exception classes\n\n"
            f"Follow: async/await throughout, full type hints, docstrings on public methods."
        )
        content = await self.invoke_llm(prompt)
        artifact = Artifact(
            artifact_type="code",
            name=f"{domain}_service.py",
            content=content,
            metadata={"framework": "FastAPI", "language": "python"},
        )
        return self._success_response(task, content, artifacts=[artifact])

    async def _design_architecture(self, task: AgentTask) -> AgentResponse:
        feature = task.payload.get("feature", "")
        prompt = (
            f"Design the backend architecture for: {feature}\n\n"
            f"Cover:\n"
            f"1. Service / repository layer separation\n"
            f"2. Domain model (entities, value objects)\n"
            f"3. Use-case / application service design\n"
            f"4. Event publishing (for async side-effects)\n"
            f"5. Background tasks (Celery vs FastAPI BackgroundTasks)\n"
            f"6. Observability (structured logging, tracing headers)\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _design_microservice(self, task: AgentTask) -> AgentResponse:
        service_name = task.payload.get("service_name", "")
        responsibilities = task.payload.get("responsibilities", [])

        prompt = (
            f"Design the microservice `{service_name}` for the investment platform.\n\n"
            f"Responsibilities: {responsibilities}\n\n"
            f"Define:\n"
            f"1. Service boundary (what it owns, what it delegates)\n"
            f"2. Public API contracts\n"
            f"3. Async event contracts (consumed / produced)\n"
            f"4. Data store requirements\n"
            f"5. Health-check endpoint\n"
            f"6. Service-to-service authentication\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _setup_middleware(self, task: AgentTask) -> AgentResponse:
        prompt = (
            f"Generate FastAPI middleware stack for the investment platform.\n\n"
            f"Include:\n"
            f"1. CORS middleware (configurable origins)\n"
            f"2. Request ID / trace ID injection\n"
            f"3. Structured request/response logging\n"
            f"4. Rate limiting (slowapi)\n"
            f"5. JWT verification middleware\n"
            f"6. Compression (gzip) middleware\n"
            f"7. Security headers (HSTS, X-Frame-Options, etc.)\n"
        )
        content = await self.invoke_llm(prompt)
        artifact = Artifact(
            artifact_type="code",
            name="middleware.py",
            content=content,
            metadata={"framework": "FastAPI"},
        )
        return self._success_response(task, content, artifacts=[artifact])

    async def _design_di(self, task: AgentTask) -> AgentResponse:
        prompt = (
            f"Design the dependency injection container for the FastAPI backend.\n\n"
            f"Cover:\n"
            f"1. Database session factory (asyncpg / SQLAlchemy async)\n"
            f"2. Redis client singleton\n"
            f"3. Service / repository bindings\n"
            f"4. Settings injection (Pydantic BaseSettings)\n"
            f"5. LLM client injection\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _design_error_handling(self, task: AgentTask) -> AgentResponse:
        prompt = (
            f"Design a consistent error handling strategy for the FastAPI backend.\n\n"
            f"Provide:\n"
            f"1. Custom exception hierarchy (AppError, NotFoundError, etc.)\n"
            f"2. Global exception handler (returns RFC 7807 Problem JSON)\n"
            f"3. Validation error formatting\n"
            f"4. Error logging with context\n"
            f"5. Correlation ID propagation\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _review_backend(self, task: AgentTask) -> AgentResponse:
        code = task.payload.get("code", "")
        prompt = (
            f"Review the following Python backend code:\n\n"
            f"```python\n{code}\n```\n\n"
            f"Check: type hints, async correctness, error handling, security, "
            f"performance, and adherence to platform conventions."
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _generic(self, task: AgentTask) -> AgentResponse:
        content = await self.invoke_llm(
            f"Backend architecture request — {task.task_type}: {task.payload}"
        )
        return self._success_response(task, content)
