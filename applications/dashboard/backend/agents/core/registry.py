"""
AgentRegistry — tracks all live agent instances and routes delegations.
"""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Any

from .models import AgentType, DelegationRequest, DelegationResponse

if TYPE_CHECKING:
    from .base_agent import BaseAgent

logger = logging.getLogger(__name__)


class AgentRegistry:
    """
    Central registry for all agent instances.

    Responsibilities:
    - Register / deregister agents
    - Look up agents by type or capability
    - Route DelegationRequests to the correct agent
    - Expose a lightweight health-check map
    """

    def __init__(self) -> None:
        self._agents: dict[str, "BaseAgent"] = {}
        self._type_index: dict[AgentType, list[str]] = {}
        self._capability_index: dict[str, list[str]] = {}
        self._lock = asyncio.Lock()

    # -----------------------------------------------------------------------
    # Registration
    # -----------------------------------------------------------------------

    async def register(self, agent: "BaseAgent") -> None:
        async with self._lock:
            agent_id = agent.agent_id
            self._agents[agent_id] = agent

            # type index
            self._type_index.setdefault(agent.agent_type, [])
            if agent_id not in self._type_index[agent.agent_type]:
                self._type_index[agent.agent_type].append(agent_id)

            # capability index
            for cap in agent.capabilities:
                self._capability_index.setdefault(cap, [])
                if agent_id not in self._capability_index[cap]:
                    self._capability_index[cap].append(agent_id)

        logger.info("Registered agent %s (type=%s)", agent_id, agent.agent_type.value)

    async def deregister(self, agent_id: str) -> None:
        async with self._lock:
            agent = self._agents.pop(agent_id, None)
            if agent is None:
                return

            ids = self._type_index.get(agent.agent_type, [])
            if agent_id in ids:
                ids.remove(agent_id)

            for cap in agent.capabilities:
                ids = self._capability_index.get(cap, [])
                if agent_id in ids:
                    ids.remove(agent_id)

        logger.info("Deregistered agent %s", agent_id)

    # -----------------------------------------------------------------------
    # Lookup
    # -----------------------------------------------------------------------

    def get_agent(self, agent_id: str) -> "BaseAgent | None":
        return self._agents.get(agent_id)

    def get_by_type(self, agent_type: AgentType) -> list["BaseAgent"]:
        ids = self._type_index.get(agent_type, [])
        return [self._agents[i] for i in ids if i in self._agents]

    def get_by_capability(self, capability: str) -> list["BaseAgent"]:
        ids = self._capability_index.get(capability, [])
        return [self._agents[i] for i in ids if i in self._agents]

    def all_agents(self) -> list["BaseAgent"]:
        return list(self._agents.values())

    def agent_ids(self) -> list[str]:
        return list(self._agents.keys())

    # -----------------------------------------------------------------------
    # Delegation routing
    # -----------------------------------------------------------------------

    async def route_delegation(self, request: DelegationRequest) -> Any:
        """Route a delegation request to the first available agent of the target type."""
        candidates = self.get_by_type(request.to_agent_type)
        if not candidates:
            from .models import AgentResponse, ResponseStatus

            return AgentResponse(
                task_id=request.task.task_id,
                agent_id="registry",
                agent_type=request.to_agent_type,
                status=ResponseStatus.ERROR,
                content=f"No agent available for type {request.to_agent_type.value}",
            )

        # Simple round-robin: pick first agent (extend with load-balancing later)
        target = candidates[0]
        logger.info(
            "Routing delegation for task %s from %s → %s",
            request.task.task_id,
            request.from_agent,
            target.agent_id,
        )
        return await target.run(request.task)

    # -----------------------------------------------------------------------
    # Health
    # -----------------------------------------------------------------------

    def health_summary(self) -> dict[str, Any]:
        return {
            "total_agents": len(self._agents),
            "by_type": {
                t.value: len(ids) for t, ids in self._type_index.items() if ids
            },
        }

    def __repr__(self) -> str:
        return f"<AgentRegistry agents={len(self._agents)}>"
