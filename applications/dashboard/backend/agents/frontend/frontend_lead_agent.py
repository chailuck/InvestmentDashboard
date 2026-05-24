"""
FrontendLeadAgent — manages frontend architecture and coordinates UI agents.
"""

from __future__ import annotations

from typing import ClassVar

from ..core.base_agent import BaseAgent
from ..core.models import AgentResponse, AgentTask, AgentType, Artifact
from ..shared.prompts import FRONTEND_LEAD_SYSTEM


class FrontendLeadAgent(BaseAgent):
    """
    Governs frontend architecture: component library, state management,
    routing, and build configuration for the React 18 / TypeScript dashboard.
    """

    agent_type: ClassVar[AgentType] = AgentType.FRONTEND_LEAD

    capabilities: ClassVar[list[str]] = [
        "frontend_component",
        "frontend_architecture",
        "state_management",
        "routing_setup",
        "build_configuration",
        "frontend_review",
    ]

    system_prompt: ClassVar[str] = FRONTEND_LEAD_SYSTEM

    async def process_task(self, task: AgentTask) -> AgentResponse:
        dispatch = {
            "frontend_component": self._generate_component,
            "frontend_architecture": self._design_architecture,
            "state_management": self._design_state,
            "routing_setup": self._design_routing,
            "build_configuration": self._configure_build,
            "frontend_review": self._review_frontend,
        }
        handler = dispatch.get(task.task_type)
        if handler:
            return await handler(task)
        return await self._generic(task)

    async def _generate_component(self, task: AgentTask) -> AgentResponse:
        name = task.payload.get("name", "Component")
        description = task.payload.get("description", "")
        props = task.payload.get("props", [])
        has_state = task.payload.get("has_state", False)
        uses_api = task.payload.get("uses_api", False)

        prompt = (
            f"Generate a production-ready React 18 TypeScript component.\n\n"
            f"Component: {name}\n"
            f"Description: {description}\n"
            f"Props: {props}\n"
            f"Needs local state: {has_state}\n"
            f"Fetches from API: {uses_api}\n\n"
            f"Requirements:\n"
            f"- Strict TypeScript (no `any`), explicit prop interface\n"
            f"- Tailwind CSS + Shadcn/ui components where applicable\n"
            f"- Dark mode compatible (use CSS variables / Tailwind dark:)\n"
            f"- React Query for async data, Zustand for shared state\n"
            f"- Accessible (ARIA roles, keyboard nav)\n"
            f"- Memoised where appropriate (React.memo, useMemo, useCallback)\n"
        )

        content = await self.invoke_llm(prompt)
        artifact = Artifact(
            artifact_type="code",
            name=f"{name}.tsx",
            content=content,
            metadata={"framework": "React 18", "language": "typescript"},
        )
        return self._success_response(task, content, artifacts=[artifact])

    async def _design_architecture(self, task: AgentTask) -> AgentResponse:
        feature = task.payload.get("feature", "")
        prompt = (
            f"Design the frontend architecture for the following feature on the investment "
            f"dashboard:\n\n{feature}\n\n"
            f"Cover:\n"
            f"1. Component hierarchy (tree diagram)\n"
            f"2. State management approach (local vs Zustand store)\n"
            f"3. Data fetching strategy (React Query keys, stale times)\n"
            f"4. Route structure (React Router v6 paths and loaders)\n"
            f"5. Code-splitting boundaries\n"
            f"6. Error boundaries and loading states\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _design_state(self, task: AgentTask) -> AgentResponse:
        domain = task.payload.get("domain", "")
        prompt = (
            f"Design the Zustand state management for the `{domain}` domain.\n\n"
            f"Provide:\n"
            f"1. Store slice definition (TypeScript interface)\n"
            f"2. Actions and selectors\n"
            f"3. Integration with React Query (server state vs client state)\n"
            f"4. Persistence strategy (localStorage? sessionStorage?)\n"
            f"5. DevTools middleware setup\n"
        )
        content = await self.invoke_llm(prompt)
        artifact = Artifact(
            artifact_type="code",
            name=f"{domain}Store.ts",
            content=content,
            metadata={"library": "zustand"},
        )
        return self._success_response(task, content, artifacts=[artifact])

    async def _design_routing(self, task: AgentTask) -> AgentResponse:
        pages = task.payload.get("pages", [])
        prompt = (
            f"Design the React Router v6 routing structure for these pages: {pages}\n\n"
            f"Include:\n"
            f"1. Route definitions with loaders and actions\n"
            f"2. Nested layout routes\n"
            f"3. Protected route wrapper (JWT guard)\n"
            f"4. Lazy-loaded route chunks\n"
            f"5. Error element setup\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _configure_build(self, task: AgentTask) -> AgentResponse:
        prompt = (
            f"Generate a Vite 5 build configuration for the investment dashboard.\n\n"
            f"Include:\n"
            f"1. vite.config.ts with path aliases, env handling, code-split chunks\n"
            f"2. tsconfig.json (strict mode, path mappings)\n"
            f"3. ESLint + Prettier config for React/TypeScript\n"
            f"4. Tailwind CSS config with custom design tokens\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _review_frontend(self, task: AgentTask) -> AgentResponse:
        code = task.payload.get("code", "")
        prompt = (
            f"Review the following frontend code for quality and platform consistency:\n\n"
            f"```tsx\n{code}\n```\n\n"
            f"Check: TypeScript strictness, hook rules, performance, accessibility, "
            f"dark mode support, error handling."
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _generic(self, task: AgentTask) -> AgentResponse:
        content = await self.invoke_llm(
            f"Frontend architecture request — {task.task_type}: {task.payload}"
        )
        return self._success_response(task, content)
