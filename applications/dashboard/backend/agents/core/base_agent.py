"""
Abstract BaseAgent — all specialist agents extend this class.
"""

from __future__ import annotations

import abc
import asyncio
import logging
import time
import uuid
from typing import Any, ClassVar

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from langchain_core.prompts import ChatPromptTemplate

from .memory import AgentMemory
from .models import (
    AgentEvent,
    AgentResponse,
    AgentTask,
    AgentType,
    DelegationRequest,
    ResponseStatus,
    TaskStatus,
)

logger = logging.getLogger(__name__)


class BaseAgent(abc.ABC):
    """
    Abstract base for all agents in the investment platform.

    Each subclass must declare:
      - agent_type: AgentType
      - capabilities: list[str]  (task types this agent handles)
      - system_prompt: str
    """

    agent_type: ClassVar[AgentType]
    capabilities: ClassVar[list[str]]
    system_prompt: ClassVar[str] = ""

    # -----------------------------------------------------------------------
    # Construction
    # -----------------------------------------------------------------------

    def __init__(
        self,
        llm: BaseChatModel,
        memory: AgentMemory | None = None,
        registry: Any | None = None,
        context: Any | None = None,
    ) -> None:
        self.agent_id: str = f"{self.agent_type.value}_{uuid.uuid4().hex[:8]}"
        self.llm = llm
        self.memory = memory or AgentMemory(agent_id=self.agent_id)
        self._registry = registry
        self._context = context
        self._running = False
        self._event_subscribers: list[Any] = []
        self.logger = logging.getLogger(f"agents.{self.agent_type.value}")

    # -----------------------------------------------------------------------
    # Public interface
    # -----------------------------------------------------------------------

    async def run(self, task: AgentTask) -> AgentResponse:
        """Entry point: validate, process, return response."""
        self.logger.info(
            "Agent %s processing task %s (type=%s)",
            self.agent_id,
            task.task_id,
            task.task_type,
        )
        start = time.monotonic()
        task.mark_in_progress(self.agent_id)

        try:
            await self._emit_event("task_started", {"task_id": task.task_id})
            response = await self.process_task(task)
            task.mark_completed()
            await self._emit_event(
                "task_completed",
                {"task_id": task.task_id, "status": response.status},
            )
        except Exception as exc:
            self.logger.exception("Task %s failed: %s", task.task_id, exc)
            task.mark_failed()
            response = self._error_response(task, str(exc))
            await self._emit_event("task_failed", {"task_id": task.task_id, "error": str(exc)})

        response.execution_time_ms = (time.monotonic() - start) * 1000
        return response

    @abc.abstractmethod
    async def process_task(self, task: AgentTask) -> AgentResponse:
        """Implement domain-specific task handling."""

    async def can_handle(self, task: AgentTask) -> bool:
        return task.task_type in self.capabilities

    # -----------------------------------------------------------------------
    # LLM helpers
    # -----------------------------------------------------------------------

    async def invoke_llm(
        self,
        user_message: str,
        extra_context: str = "",
        temperature: float | None = None,
    ) -> str:
        """Send a message to the LLM with the agent's system prompt."""
        messages: list[BaseMessage] = [
            SystemMessage(content=self._build_system_prompt(extra_context)),
        ]

        history = self.memory.get_recent_history()
        messages.extend(history)
        messages.append(HumanMessage(content=user_message))

        kwargs: dict[str, Any] = {}
        if temperature is not None:
            kwargs["temperature"] = temperature

        result = await self.llm.ainvoke(messages, **kwargs)
        answer = str(result.content)

        self.memory.add_exchange(user_message, answer)
        return answer

    async def invoke_llm_with_prompt(
        self,
        prompt_template: ChatPromptTemplate,
        variables: dict[str, Any],
    ) -> str:
        chain = prompt_template | self.llm
        result = await chain.ainvoke(variables)
        return str(result.content)

    # -----------------------------------------------------------------------
    # Delegation
    # -----------------------------------------------------------------------

    async def delegate_task(
        self,
        target_type: AgentType,
        task: AgentTask,
        reason: str = "",
    ) -> AgentResponse:
        """Delegate a task to another agent via the registry."""
        if self._registry is None:
            return self._error_response(task, "No registry available for delegation")

        request = DelegationRequest(
            from_agent=self.agent_id,
            to_agent_type=target_type,
            task=task,
            reason=reason,
            context_snapshot=self._context.snapshot() if self._context else {},
        )

        self.logger.info(
            "Delegating task %s from %s to %s: %s",
            task.task_id,
            self.agent_id,
            target_type.value,
            reason,
        )

        task.status = TaskStatus.DELEGATED
        return await self._registry.route_delegation(request)

    async def delegate_tasks_parallel(
        self,
        delegations: list[tuple[AgentType, AgentTask, str]],
    ) -> list[AgentResponse]:
        """Delegate multiple tasks concurrently and await all responses."""
        coros = [self.delegate_task(t, task, reason) for t, task, reason in delegations]
        return list(await asyncio.gather(*coros, return_exceptions=False))

    # -----------------------------------------------------------------------
    # Context helpers
    # -----------------------------------------------------------------------

    def get_context(self, key: str, default: Any = None) -> Any:
        if self._context:
            return self._context.get(key, default)
        return default

    def set_context(self, key: str, value: Any) -> None:
        if self._context:
            self._context.set(key, value)

    # -----------------------------------------------------------------------
    # Event system
    # -----------------------------------------------------------------------

    def subscribe(self, handler: Any) -> None:
        self._event_subscribers.append(handler)

    async def _emit_event(self, event_type: str, payload: dict[str, Any]) -> None:
        event = AgentEvent(
            event_type=event_type,
            source_agent=self.agent_id,
            payload=payload,
        )
        for handler in self._event_subscribers:
            try:
                if asyncio.iscoroutinefunction(handler):
                    await handler(event)
                else:
                    handler(event)
            except Exception:
                self.logger.exception("Event handler error for event %s", event_type)

    # -----------------------------------------------------------------------
    # Internal helpers
    # -----------------------------------------------------------------------

    def _build_system_prompt(self, extra_context: str = "") -> str:
        prompt = self.system_prompt
        if extra_context:
            prompt = f"{prompt}\n\nAdditional context:\n{extra_context}"
        return prompt

    def _success_response(
        self,
        task: AgentTask,
        content: str,
        artifacts: list[Any] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> AgentResponse:
        return AgentResponse(
            task_id=task.task_id,
            agent_id=self.agent_id,
            agent_type=self.agent_type,
            status=ResponseStatus.SUCCESS,
            content=content,
            artifacts=artifacts or [],
            metadata=metadata or {},
        )

    def _error_response(self, task: AgentTask, error: str) -> AgentResponse:
        return AgentResponse(
            task_id=task.task_id,
            agent_id=self.agent_id,
            agent_type=self.agent_type,
            status=ResponseStatus.ERROR,
            content=f"Error: {error}",
        )

    def _delegated_response(
        self,
        task: AgentTask,
        sub_responses: list[AgentResponse],
        summary: str = "",
    ) -> AgentResponse:
        return AgentResponse(
            task_id=task.task_id,
            agent_id=self.agent_id,
            agent_type=self.agent_type,
            status=ResponseStatus.DELEGATED,
            content=summary or f"Task delegated to {len(sub_responses)} agents",
            sub_responses=sub_responses,
        )

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__} id={self.agent_id}>"
