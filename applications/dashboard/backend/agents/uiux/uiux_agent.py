"""
UIUXAgent — dark-mode fintech design system and interaction patterns.
"""

from __future__ import annotations

from typing import ClassVar

from ..core.base_agent import BaseAgent
from ..core.models import AgentResponse, AgentTask, AgentType, Artifact
from ..shared.prompts import UIUX_SYSTEM


class UIUXAgent(BaseAgent):
    """
    Owns the visual design system: colour tokens, typography, animations,
    and interaction patterns for the fintech investment dashboard.
    """

    agent_type: ClassVar[AgentType] = AgentType.UIUX

    capabilities: ClassVar[list[str]] = [
        "design_system",
        "dark_mode",
        "animation",
        "interaction_pattern",
        "fintech_ux",
        "data_visualisation",
        "accessibility_audit",
    ]

    system_prompt: ClassVar[str] = UIUX_SYSTEM

    async def process_task(self, task: AgentTask) -> AgentResponse:
        dispatch = {
            "design_system": self._generate_design_system,
            "dark_mode": self._generate_dark_mode_tokens,
            "animation": self._generate_animations,
            "interaction_pattern": self._design_interaction,
            "fintech_ux": self._design_fintech_pattern,
            "data_visualisation": self._design_chart,
            "accessibility_audit": self._audit_accessibility,
        }
        handler = dispatch.get(task.task_type)
        if handler:
            return await handler(task)
        return await self._generic(task)

    async def _generate_design_system(self, task: AgentTask) -> AgentResponse:
        prompt = (
            f"Generate the complete design system token set for the investment dashboard.\n\n"
            f"Produce Tailwind CSS config and CSS custom properties for:\n"
            f"1. Color palette: primary (blue/indigo), success (green), danger (red), "
            f"warning (amber), neutral scale — dark mode variants\n"
            f"2. Typography: font families, size scale (fluid), line heights, letter spacing\n"
            f"3. Spacing scale (4px base)\n"
            f"4. Border radius tokens\n"
            f"5. Shadow tokens (glass-morphism style for cards)\n"
            f"6. Z-index scale\n"
            f"7. Animation duration and easing tokens\n"
        )
        content = await self.invoke_llm(prompt)
        artifacts = [
            Artifact(
                artifact_type="code",
                name="tailwind.config.ts",
                content=content,
                metadata={"type": "design_tokens"},
            ),
            Artifact(
                artifact_type="code",
                name="tokens.css",
                content=content,
                metadata={"type": "css_variables"},
            ),
        ]
        return self._success_response(task, content, artifacts=artifacts)

    async def _generate_dark_mode_tokens(self, task: AgentTask) -> AgentResponse:
        component = task.payload.get("component", "global")
        prompt = (
            f"Define the dark-mode color tokens for: {component}\n\n"
            f"Follow fintech dark UI conventions:\n"
            f"- Background: #0B0F1A (deep navy), not pure black\n"
            f"- Surface: #131929 (card), #1C2333 (elevated)\n"
            f"- Border: #2A3450\n"
            f"- Text: #E2E8F0 (primary), #94A3B8 (muted), #64748B (disabled)\n"
            f"- Accent: #3B82F6 (blue), glow effects for focus states\n"
            f"- Numbers: green (#22C55E) for gains, red (#EF4444) for losses\n\n"
            f"Output: CSS variables + Tailwind dark-mode class mappings."
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _generate_animations(self, task: AgentTask) -> AgentResponse:
        component = task.payload.get("component", "")
        animation_type = task.payload.get("animation_type", "enter")

        prompt = (
            f"Create Framer Motion animations for: {component} ({animation_type})\n\n"
            f"Design for fintech feel:\n"
            f"- Snappy entry (duration 150-200ms, ease-out)\n"
            f"- Number counter animations for metrics\n"
            f"- Chart draw-on animations\n"
            f"- Stagger children for list renders\n"
            f"- Skeleton loading states\n"
            f"- Spring physics for interactive elements\n\n"
            f"Output: Framer Motion variants object + usage example."
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _design_interaction(self, task: AgentTask) -> AgentResponse:
        pattern = task.payload.get("pattern", "")
        prompt = (
            f"Design the interaction pattern for: {pattern}\n\n"
            f"Consider:\n"
            f"1. Mouse hover states (cursor, colour shift, shadow)\n"
            f"2. Keyboard navigation (focus ring, tab order)\n"
            f"3. Touch / mobile gestures\n"
            f"4. Loading / pending states\n"
            f"5. Error / validation feedback\n"
            f"6. Confirmation dialogs for destructive actions\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _design_fintech_pattern(self, task: AgentTask) -> AgentResponse:
        feature = task.payload.get("feature", "")
        prompt = (
            f"Design the fintech UX pattern for: {feature}\n\n"
            f"Apply investment dashboard conventions:\n"
            f"1. Data density: show maximum useful info without clutter\n"
            f"2. Sparklines and mini-charts inline with data rows\n"
            f"3. P&L colouring (green/red with colour-blind safe fallbacks)\n"
            f"4. Real-time update animations (pulse, smooth number transitions)\n"
            f"5. Contextual tooltips with detailed breakdowns\n"
            f"6. Keyboard shortcuts for power users\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _design_chart(self, task: AgentTask) -> AgentResponse:
        chart_type = task.payload.get("chart_type", "line")
        data_domain = task.payload.get("data_domain", "portfolio")
        prompt = (
            f"Design a {chart_type} chart for {data_domain} data using Recharts.\n\n"
            f"Requirements:\n"
            f"1. Responsive container (100% width)\n"
            f"2. Dark-mode compatible (custom stroke/fill colours)\n"
            f"3. Custom tooltip component\n"
            f"4. Reference lines (benchmarks, zero line)\n"
            f"5. Animated on data change\n"
            f"6. Empty/loading state handling\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _audit_accessibility(self, task: AgentTask) -> AgentResponse:
        component_code = task.payload.get("code", "")
        prompt = (
            f"Audit the following component for WCAG 2.1 AA accessibility:\n\n"
            f"```tsx\n{component_code}\n```\n\n"
            f"Check: contrast ratios, ARIA labels, keyboard nav, focus management, "
            f"screen reader announcements, and colour-only information encoding."
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _generic(self, task: AgentTask) -> AgentResponse:
        content = await self.invoke_llm(
            f"UI/UX design request — {task.task_type}: {task.payload}"
        )
        return self._success_response(task, content)
