"""
ChiefArchitectAgent — top-level coordinator and architecture enforcer.
"""

from __future__ import annotations

import asyncio
from typing import ClassVar

from ..core.base_agent import BaseAgent
from ..core.models import (
    AgentResponse,
    AgentTask,
    AgentType,
    Artifact,
    TaskPriority,
)
from ..shared.prompts import CHIEF_ARCHITECT_SYSTEM


class ChiefArchitectAgent(BaseAgent):
    """
    Orchestrates all specialist agents and enforces enterprise architecture.

    Capabilities:
    - architecture_review: Validate a proposed design against standards
    - code_review: Review generated code for consistency and quality
    - design_decision: Make architectural decisions and record ADRs
    - consistency_check: Cross-agent consistency validation
    - orchestrate: Decompose complex tasks and delegate to specialist agents
    """

    agent_type: ClassVar[AgentType] = AgentType.CHIEF_ARCHITECT

    capabilities: ClassVar[list[str]] = [
        "architecture_review",
        "code_review",
        "design_decision",
        "consistency_check",
        "orchestrate",
    ]

    system_prompt: ClassVar[str] = CHIEF_ARCHITECT_SYSTEM

    # ------------------------------------------------------------------
    # Task dispatch
    # ------------------------------------------------------------------

    async def process_task(self, task: AgentTask) -> AgentResponse:
        dispatch = {
            "architecture_review": self._review_architecture,
            "code_review": self._review_code,
            "design_decision": self._make_decision,
            "consistency_check": self._check_consistency,
            "orchestrate": self._orchestrate,
        }
        handler = dispatch.get(task.task_type)
        if handler:
            return await handler(task)
        return await self._generic_task(task)

    # ------------------------------------------------------------------
    # Handlers
    # ------------------------------------------------------------------

    async def _review_architecture(self, task: AgentTask) -> AgentResponse:
        design = task.payload.get("design", "")
        context = task.payload.get("context", "")

        prompt = (
            f"Review the following architecture design for compliance with enterprise standards.\n\n"
            f"Context: {context}\n\n"
            f"Design:\n{design}\n\n"
            f"Evaluate:\n"
            f"1. Scalability (can this serve 10k+ concurrent users?)\n"
            f"2. Security (auth, authorisation, data protection)\n"
            f"3. Maintainability (clean architecture, SOLID)\n"
            f"4. Consistency with the existing platform\n"
            f"5. Missing concerns (observability, error handling, etc.)\n\n"
            f"Provide: APPROVED / NEEDS_REVISION / REJECTED with specific feedback."
        )

        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _review_code(self, task: AgentTask) -> AgentResponse:
        code = task.payload.get("code", "")
        language = task.payload.get("language", "python")
        file_path = task.payload.get("file_path", "unknown")

        prompt = (
            f"Review the following {language} code from `{file_path}` "
            f"for architecture quality, security issues, and platform consistency.\n\n"
            f"```{language}\n{code}\n```\n\n"
            f"Check for:\n"
            f"- Type safety (no `any` in TypeScript, full type hints in Python)\n"
            f"- Security vulnerabilities (injection, auth bypass, insecure defaults)\n"
            f"- Performance anti-patterns\n"
            f"- Deviations from platform conventions\n"
            f"- Missing error handling\n\n"
            f"Return a structured review with PASS/FAIL per category."
        )

        content = await self.invoke_llm(prompt)
        artifact = Artifact(
            artifact_type="review_report",
            name=f"review_{file_path}",
            content=content,
            metadata={"language": language, "file_path": file_path},
        )
        return self._success_response(task, content, artifacts=[artifact])

    async def _make_decision(self, task: AgentTask) -> AgentResponse:
        question = task.payload.get("question", "")
        options = task.payload.get("options", [])
        constraints = task.payload.get("constraints", [])

        options_text = "\n".join(f"- Option {i+1}: {o}" for i, o in enumerate(options))
        constraints_text = "\n".join(f"- {c}" for c in constraints)

        prompt = (
            f"Make an architectural decision for the investment platform.\n\n"
            f"Decision required: {question}\n\n"
            f"Options:\n{options_text}\n\n"
            f"Constraints:\n{constraints_text}\n\n"
            f"Respond with:\n"
            f"1. DECISION: chosen option with rationale\n"
            f"2. TRADE-OFFS: what we give up\n"
            f"3. ADR: Architecture Decision Record (title, context, decision, consequences)\n"
        )

        content = await self.invoke_llm(prompt)
        self.set_context(f"decision.{task.task_id}", content)
        return self._success_response(task, content)

    async def _check_consistency(self, task: AgentTask) -> AgentResponse:
        components = task.payload.get("components", [])
        components_text = "\n".join(f"- {c}" for c in components)

        prompt = (
            f"Check cross-component consistency for the investment platform.\n\n"
            f"Components to validate:\n{components_text}\n\n"
            f"Verify:\n"
            f"1. API contract consistency (naming, versioning, error formats)\n"
            f"2. Shared type definitions (no duplication)\n"
            f"3. Authentication flow compatibility\n"
            f"4. Logging and observability consistency\n"
            f"5. Configuration management alignment\n\n"
            f"Report any inconsistencies found with remediation steps."
        )

        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _orchestrate(self, task: AgentTask) -> AgentResponse:
        """Decompose a complex task and delegate sub-tasks concurrently."""
        description = task.payload.get("description", "")
        domains = task.payload.get("domains", [])

        prompt = (
            f"Decompose the following feature request into specialist sub-tasks:\n\n"
            f"{description}\n\n"
            f"Domains involved: {', '.join(domains) or 'all applicable'}\n\n"
            f"For each sub-task specify:\n"
            f"- agent_type (from: frontend_lead, backend_lead, uiux, responsive, api, "
            f"database, ai, skills, devops, security, qa, performance)\n"
            f"- task_type\n"
            f"- description\n"
            f"- priority (critical/high/normal/low)\n"
            f"- dependencies (task numbers that must complete first)\n\n"
            f"Format as a numbered list."
        )

        orchestration_plan = await self.invoke_llm(prompt)
        return self._success_response(
            task,
            orchestration_plan,
            metadata={"orchestration": True, "domains": domains},
        )

    async def _generic_task(self, task: AgentTask) -> AgentResponse:
        prompt = (
            f"As the Chief Architect, address the following request:\n\n"
            f"Task: {task.task_type}\n"
            f"Details: {task.payload}"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)
