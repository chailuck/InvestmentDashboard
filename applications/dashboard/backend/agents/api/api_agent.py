"""
APIAgent — REST and WebSocket API design and implementation.
"""

from __future__ import annotations

from typing import ClassVar

from ..core.base_agent import BaseAgent
from ..core.models import AgentResponse, AgentTask, AgentType, Artifact
from ..shared.prompts import API_SYSTEM


class APIAgent(BaseAgent):
    """
    Designs and implements REST endpoints, WebSocket handlers,
    API versioning, and request/response validation.
    """

    agent_type: ClassVar[AgentType] = AgentType.API

    capabilities: ClassVar[list[str]] = [
        "api_design",
        "rest_endpoint",
        "websocket_api",
        "api_versioning",
        "api_validation",
        "openapi_schema",
        "rate_limiting",
    ]

    system_prompt: ClassVar[str] = API_SYSTEM

    async def process_task(self, task: AgentTask) -> AgentResponse:
        dispatch = {
            "api_design": self._design_api,
            "rest_endpoint": self._generate_endpoint,
            "websocket_api": self._generate_websocket,
            "api_versioning": self._setup_versioning,
            "api_validation": self._generate_validation,
            "openapi_schema": self._generate_openapi,
            "rate_limiting": self._setup_rate_limiting,
        }
        handler = dispatch.get(task.task_type)
        if handler:
            return await handler(task)
        return await self._generic(task)

    async def _design_api(self, task: AgentTask) -> AgentResponse:
        domain = task.payload.get("domain", "")
        operations = task.payload.get("operations", [])
        prompt = (
            f"Design the REST API for the `{domain}` domain.\n\n"
            f"Operations: {operations}\n\n"
            f"For each endpoint provide:\n"
            f"1. HTTP method + path (versioned: /api/v1/...)\n"
            f"2. Request schema (Pydantic model)\n"
            f"3. Response schema (success + error)\n"
            f"4. Authentication requirement\n"
            f"5. Rate limit class (public / authenticated / admin)\n"
            f"6. Idempotency considerations\n\n"
            f"Follow REST best practices: plural nouns, proper status codes, HATEOAS links."
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _generate_endpoint(self, task: AgentTask) -> AgentResponse:
        method = task.payload.get("method", "GET")
        path = task.payload.get("path", "/")
        description = task.payload.get("description", "")
        auth_required = task.payload.get("auth_required", True)

        prompt = (
            f"Generate a FastAPI endpoint:\n\n"
            f"Method: {method}\n"
            f"Path: {path}\n"
            f"Description: {description}\n"
            f"Auth required: {auth_required}\n\n"
            f"Include:\n"
            f"1. Pydantic request/response models\n"
            f"2. FastAPI path operation with proper status codes\n"
            f"3. Dependency injection (db session, current user)\n"
            f"4. Error handling (404, 422, 401, 403)\n"
            f"5. OpenAPI docstring\n"
        )
        content = await self.invoke_llm(prompt)
        artifact = Artifact(
            artifact_type="code",
            name=f"endpoint_{path.replace('/', '_').strip('_')}.py",
            content=content,
            metadata={"method": method, "path": path},
        )
        return self._success_response(task, content, artifacts=[artifact])

    async def _generate_websocket(self, task: AgentTask) -> AgentResponse:
        channel = task.payload.get("channel", "market_data")
        event_types = task.payload.get("event_types", [])

        prompt = (
            f"Generate a FastAPI WebSocket handler for the `{channel}` channel.\n\n"
            f"Event types: {event_types}\n\n"
            f"Include:\n"
            f"1. WebSocket endpoint with connection manager\n"
            f"2. JWT authentication on upgrade\n"
            f"3. Room/subscription management\n"
            f"4. JSON message schema (type + payload)\n"
            f"5. Heartbeat / ping-pong\n"
            f"6. Graceful disconnect handling\n"
            f"7. Error recovery (reconnect logic on client side)\n"
        )
        content = await self.invoke_llm(prompt)
        artifact = Artifact(
            artifact_type="code",
            name=f"ws_{channel}.py",
            content=content,
            metadata={"channel": channel, "type": "websocket"},
        )
        return self._success_response(task, content, artifacts=[artifact])

    async def _setup_versioning(self, task: AgentTask) -> AgentResponse:
        prompt = (
            f"Design the API versioning strategy for the investment platform.\n\n"
            f"Cover:\n"
            f"1. URL versioning structure (/api/v1/, /api/v2/)\n"
            f"2. FastAPI router mounting pattern\n"
            f"3. Deprecation policy and sunset headers\n"
            f"4. Version negotiation via Accept header\n"
            f"5. Changelog documentation strategy\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _generate_validation(self, task: AgentTask) -> AgentResponse:
        model_name = task.payload.get("model_name", "")
        fields = task.payload.get("fields", [])

        prompt = (
            f"Generate Pydantic v2 validation models for `{model_name}`.\n\n"
            f"Fields: {fields}\n\n"
            f"Include:\n"
            f"1. Input model with field validators\n"
            f"2. Output model (with computed fields)\n"
            f"3. Update model (all fields optional)\n"
            f"4. Custom validators for business rules\n"
            f"5. Example values for OpenAPI docs\n"
        )
        content = await self.invoke_llm(prompt)
        artifact = Artifact(
            artifact_type="code",
            name=f"schemas_{model_name.lower()}.py",
            content=content,
            metadata={"model": model_name},
        )
        return self._success_response(task, content, artifacts=[artifact])

    async def _generate_openapi(self, task: AgentTask) -> AgentResponse:
        prompt = (
            f"Generate the OpenAPI 3.1 configuration for the investment platform API.\n\n"
            f"Include:\n"
            f"1. Info block (title, version, description, contact)\n"
            f"2. Server blocks (dev, staging, production)\n"
            f"3. Security scheme (BearerAuth with JWT)\n"
            f"4. Tags with descriptions\n"
            f"5. Default error response components\n"
            f"6. FastAPI app configuration to expose /api/v1/docs\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _setup_rate_limiting(self, task: AgentTask) -> AgentResponse:
        prompt = (
            f"Implement rate limiting for the FastAPI investment platform API.\n\n"
            f"Use slowapi (limits library):\n"
            f"1. Per-IP limits for public endpoints\n"
            f"2. Per-user limits for authenticated endpoints\n"
            f"3. Burst allowance and sliding window\n"
            f"4. Redis backend for distributed rate counting\n"
            f"5. Custom 429 response with Retry-After header\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _generic(self, task: AgentTask) -> AgentResponse:
        content = await self.invoke_llm(
            f"API design request — {task.task_type}: {task.payload}"
        )
        return self._success_response(task, content)
