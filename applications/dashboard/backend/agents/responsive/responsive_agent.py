"""
ResponsiveAgent — mobile/tablet/desktop adaptive layouts.
"""

from __future__ import annotations

from typing import ClassVar

from ..core.base_agent import BaseAgent
from ..core.models import AgentResponse, AgentTask, AgentType, Artifact
from ..shared.prompts import RESPONSIVE_SYSTEM


class ResponsiveAgent(BaseAgent):
    """
    Ensures every UI component and layout works across all viewport sizes.
    """

    agent_type: ClassVar[AgentType] = AgentType.RESPONSIVE

    capabilities: ClassVar[list[str]] = [
        "responsive_layout",
        "mobile_adaptation",
        "breakpoint_design",
        "adaptive_navigation",
        "touch_optimisation",
        "responsive_audit",
    ]

    system_prompt: ClassVar[str] = RESPONSIVE_SYSTEM

    # Tailwind breakpoints used in this project
    BREAKPOINTS = {
        "xs": "320px",
        "sm": "640px",
        "md": "768px",
        "lg": "1024px",
        "xl": "1280px",
        "2xl": "1536px",
    }

    async def process_task(self, task: AgentTask) -> AgentResponse:
        dispatch = {
            "responsive_layout": self._design_responsive_layout,
            "mobile_adaptation": self._adapt_for_mobile,
            "breakpoint_design": self._design_breakpoints,
            "adaptive_navigation": self._design_navigation,
            "touch_optimisation": self._optimise_touch,
            "responsive_audit": self._audit_responsive,
        }
        handler = dispatch.get(task.task_type)
        if handler:
            return await handler(task)
        return await self._generic(task)

    async def _design_responsive_layout(self, task: AgentTask) -> AgentResponse:
        layout_name = task.payload.get("layout_name", "Dashboard")
        sections = task.payload.get("sections", [])
        prompt = (
            f"Design a fully responsive layout for `{layout_name}` with sections: {sections}\n\n"
            f"Breakpoints: {self.BREAKPOINTS}\n\n"
            f"For each breakpoint specify:\n"
            f"1. Grid columns and gap\n"
            f"2. Which sections collapse / stack\n"
            f"3. Sidebar behaviour (fixed / drawer / hidden)\n"
            f"4. Header changes (full nav → hamburger)\n"
            f"5. Data table adaptations (horizontal scroll vs card view)\n\n"
            f"Output: Tailwind CSS classes + React layout component."
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _adapt_for_mobile(self, task: AgentTask) -> AgentResponse:
        component = task.payload.get("component", "")
        code = task.payload.get("code", "")
        prompt = (
            f"Adapt the following component for mobile (< 640px) while preserving "
            f"desktop behaviour:\n\n"
            f"Component: {component}\n"
            f"```tsx\n{code}\n```\n\n"
            f"Apply:\n"
            f"1. Touch targets ≥ 44×44px\n"
            f"2. Collapsed sections with expand/collapse\n"
            f"3. Bottom sheet instead of modals\n"
            f"4. Swipeable tab bars\n"
            f"5. Reduced data density (key metrics only)\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _design_breakpoints(self, task: AgentTask) -> AgentResponse:
        component = task.payload.get("component", "")
        prompt = (
            f"Define Tailwind breakpoint classes for `{component}`.\n\n"
            f"Provide a table mapping each breakpoint to CSS property values, "
            f"then generate the responsive Tailwind class string.\n"
            f"Breakpoints available: sm (640px), md (768px), lg (1024px), xl (1280px), 2xl (1536px)"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _design_navigation(self, task: AgentTask) -> AgentResponse:
        nav_items = task.payload.get("nav_items", [])
        prompt = (
            f"Design adaptive navigation for the investment dashboard.\n\n"
            f"Nav items: {nav_items}\n\n"
            f"Desktop (≥ 1024px): fixed left sidebar with icon + label\n"
            f"Tablet (768–1023px): collapsible sidebar (icons only, hover tooltip)\n"
            f"Mobile (< 768px): bottom tab bar (max 5 items) + hamburger drawer\n\n"
            f"Output: React component with Tailwind + Framer Motion drawer animation."
        )
        content = await self.invoke_llm(prompt)
        artifact = Artifact(
            artifact_type="code",
            name="AdaptiveNavigation.tsx",
            content=content,
            metadata={"responsive": True},
        )
        return self._success_response(task, content, artifacts=[artifact])

    async def _optimise_touch(self, task: AgentTask) -> AgentResponse:
        component = task.payload.get("component", "")
        prompt = (
            f"Optimise `{component}` for touch interaction:\n\n"
            f"1. Increase tap targets (min 44px)\n"
            f"2. Add swipe gesture handlers (react-swipeable)\n"
            f"3. Disable hover states on touch devices\n"
            f"4. Add haptic feedback hooks (Vibration API)\n"
            f"5. Prevent accidental double-taps\n"
            f"6. Long-press context menus\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _audit_responsive(self, task: AgentTask) -> AgentResponse:
        code = task.payload.get("code", "")
        prompt = (
            f"Audit the following code for responsive design issues:\n\n"
            f"```tsx\n{code}\n```\n\n"
            f"Check: fixed pixel widths, non-responsive images, missing breakpoint "
            f"classes, overflow issues, and touch target sizes."
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _generic(self, task: AgentTask) -> AgentResponse:
        content = await self.invoke_llm(
            f"Responsive design request — {task.task_type}: {task.payload}"
        )
        return self._success_response(task, content)
