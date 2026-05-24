"""
AgentRouter — maps incoming tasks to the appropriate agent type.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from .models import AgentTask, AgentType

if TYPE_CHECKING:
    from .registry import AgentRegistry

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Static routing rules
# ---------------------------------------------------------------------------

TASK_TYPE_ROUTES: dict[str, AgentType] = {
    # Architecture
    "architecture_review": AgentType.CHIEF_ARCHITECT,
    "code_review": AgentType.CHIEF_ARCHITECT,
    "design_decision": AgentType.CHIEF_ARCHITECT,
    "consistency_check": AgentType.CHIEF_ARCHITECT,

    # Frontend
    "frontend_component": AgentType.FRONTEND_LEAD,
    "frontend_architecture": AgentType.FRONTEND_LEAD,
    "state_management": AgentType.FRONTEND_LEAD,

    # Backend
    "backend_service": AgentType.BACKEND_LEAD,
    "backend_architecture": AgentType.BACKEND_LEAD,
    "microservice_design": AgentType.BACKEND_LEAD,

    # UI/UX
    "design_system": AgentType.UIUX,
    "dark_mode": AgentType.UIUX,
    "animation": AgentType.UIUX,
    "interaction_pattern": AgentType.UIUX,
    "fintech_ux": AgentType.UIUX,

    # Responsive
    "responsive_layout": AgentType.RESPONSIVE,
    "mobile_adaptation": AgentType.RESPONSIVE,
    "breakpoint_design": AgentType.RESPONSIVE,

    # API
    "api_design": AgentType.API,
    "rest_endpoint": AgentType.API,
    "websocket_api": AgentType.API,
    "api_versioning": AgentType.API,
    "api_validation": AgentType.API,

    # Database
    "schema_design": AgentType.DATABASE,
    "migration": AgentType.DATABASE,
    "index_optimization": AgentType.DATABASE,
    "query_optimization": AgentType.DATABASE,

    # AI
    "ai_copilot": AgentType.AI,
    "llm_integration": AgentType.AI,
    "streaming_chat": AgentType.AI,
    "ai_orchestration": AgentType.AI,
    "prompt_engineering": AgentType.AI,

    # Skills
    "portfolio_analytics": AgentType.SKILLS,
    "risk_calculation": AgentType.SKILLS,
    "ai_insight": AgentType.SKILLS,
    "reusable_skill": AgentType.SKILLS,

    # DevOps
    "dockerfile": AgentType.DEVOPS,
    "kubernetes_manifest": AgentType.DEVOPS,
    "ci_cd_pipeline": AgentType.DEVOPS,
    "infrastructure": AgentType.DEVOPS,
    "deployment": AgentType.DEVOPS,

    # Security
    "jwt_setup": AgentType.SECURITY,
    "rbac_policy": AgentType.SECURITY,
    "security_hardening": AgentType.SECURITY,
    "secret_management": AgentType.SECURITY,
    "vulnerability_scan": AgentType.SECURITY,

    # QA
    "unit_test": AgentType.QA,
    "integration_test": AgentType.QA,
    "e2e_test": AgentType.QA,
    "test_strategy": AgentType.QA,

    # Performance
    "frontend_perf": AgentType.PERFORMANCE,
    "backend_perf": AgentType.PERFORMANCE,
    "websocket_scaling": AgentType.PERFORMANCE,
    "cache_strategy": AgentType.PERFORMANCE,
    "load_testing": AgentType.PERFORMANCE,
}


class RoutingRule:
    """Pluggable routing rule evaluated before the static table."""

    def matches(self, task: AgentTask) -> bool:
        raise NotImplementedError

    def resolve(self, task: AgentTask) -> AgentType:
        raise NotImplementedError


class AgentRouter:
    """
    Routes tasks to the appropriate AgentType.

    Resolution order:
    1. Custom RoutingRule instances (pluggable)
    2. Static TASK_TYPE_ROUTES table
    3. Fallback to ChiefArchitect
    """

    FALLBACK = AgentType.CHIEF_ARCHITECT

    def __init__(self, registry: "AgentRegistry") -> None:
        self._registry = registry
        self._custom_rules: list[RoutingRule] = []

    def add_rule(self, rule: RoutingRule) -> None:
        self._custom_rules.append(rule)

    def resolve_agent_type(self, task: AgentTask) -> AgentType:
        # Custom rules first
        for rule in self._custom_rules:
            if rule.matches(task):
                return rule.resolve(task)

        # Static table
        if task.task_type in TASK_TYPE_ROUTES:
            return TASK_TYPE_ROUTES[task.task_type]

        # Capability index fallback
        candidates = self._registry.get_by_capability(task.task_type)
        if candidates:
            return candidates[0].agent_type

        logger.warning(
            "No routing rule for task_type=%s — falling back to %s",
            task.task_type,
            self.FALLBACK.value,
        )
        return self.FALLBACK

    async def dispatch(self, task: AgentTask) -> Any:
        """Resolve agent type and dispatch the task immediately."""
        agent_type = self.resolve_agent_type(task)
        agents = self._registry.get_by_type(agent_type)
        if not agents:
            raise RuntimeError(f"No agent registered for type {agent_type.value}")
        return await agents[0].run(task)

    def routing_table(self) -> dict[str, str]:
        """Return the static routing table as a plain dict (for inspection)."""
        return {k: v.value for k, v in TASK_TYPE_ROUTES.items()}
