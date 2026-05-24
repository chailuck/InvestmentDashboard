"""
SkillsAgent — portfolio analytics, risk calculation, and AI insights.
"""

from __future__ import annotations

from typing import ClassVar

from ..core.base_agent import BaseAgent
from ..core.models import AgentResponse, AgentTask, AgentType, Artifact
from ..shared.prompts import SKILLS_SYSTEM


class SkillsAgent(BaseAgent):
    """
    Implements reusable quantitative finance skill modules:
    portfolio analytics, risk metrics, and AI-driven insights.
    """

    agent_type: ClassVar[AgentType] = AgentType.SKILLS

    capabilities: ClassVar[list[str]] = [
        "portfolio_analytics",
        "risk_calculation",
        "ai_insight",
        "reusable_skill",
        "performance_attribution",
        "market_analytics",
        "backtesting",
    ]

    system_prompt: ClassVar[str] = SKILLS_SYSTEM

    async def process_task(self, task: AgentTask) -> AgentResponse:
        dispatch = {
            "portfolio_analytics": self._build_analytics,
            "risk_calculation": self._build_risk,
            "ai_insight": self._build_insight,
            "reusable_skill": self._build_skill,
            "performance_attribution": self._build_attribution,
            "market_analytics": self._build_market_analytics,
            "backtesting": self._build_backtest,
        }
        handler = dispatch.get(task.task_type)
        if handler:
            return await handler(task)
        return await self._generic(task)

    async def _build_analytics(self, task: AgentTask) -> AgentResponse:
        metrics = task.payload.get("metrics", [
            "total_return", "annualised_return", "sharpe_ratio",
            "max_drawdown", "calmar_ratio", "sortino_ratio",
        ])
        prompt = (
            f"Implement a portfolio analytics module for metrics: {metrics}\n\n"
            f"Requirements:\n"
            f"1. Pure Python with NumPy/Pandas — no external finance libraries assumed\n"
            f"2. All functions must accept a pd.DataFrame of daily returns\n"
            f"3. Vectorised operations (no loops over rows)\n"
            f"4. Full type hints and docstrings\n"
            f"5. Unit-testable pure functions\n"
            f"6. Annualisation parameter (daily/weekly/monthly data)\n\n"
            f"Output each metric as a separate function + a compute_all() dispatcher."
        )
        content = await self.invoke_llm(prompt)
        artifact = Artifact(
            artifact_type="code",
            name="portfolio_analytics.py",
            content=content,
            metadata={"domain": "quantitative_finance"},
        )
        return self._success_response(task, content, artifacts=[artifact])

    async def _build_risk(self, task: AgentTask) -> AgentResponse:
        risk_models = task.payload.get("models", [
            "value_at_risk", "conditional_var", "beta", "correlation_matrix",
        ])
        confidence = task.payload.get("confidence", 0.95)

        prompt = (
            f"Implement risk calculation functions: {risk_models}\n\n"
            f"Confidence level: {confidence}\n\n"
            f"For each model:\n"
            f"1. Historical simulation method\n"
            f"2. Parametric method\n"
            f"3. Monte Carlo simulation (configurable paths)\n"
            f"4. Numpy-vectorised implementation\n"
            f"5. Input validation (return NaN on insufficient data)\n"
        )
        content = await self.invoke_llm(prompt)
        artifact = Artifact(
            artifact_type="code",
            name="risk_models.py",
            content=content,
            metadata={"domain": "risk_management"},
        )
        return self._success_response(task, content, artifacts=[artifact])

    async def _build_insight(self, task: AgentTask) -> AgentResponse:
        insight_type = task.payload.get("insight_type", "portfolio_health")
        prompt = (
            f"Design the AI insight generation pipeline for `{insight_type}`.\n\n"
            f"Include:\n"
            f"1. Data preparation function (raw data → LLM-ready summary)\n"
            f"2. Structured prompt template with placeholders\n"
            f"3. LangChain chain definition\n"
            f"4. Output parser (Pydantic model)\n"
            f"5. Caching strategy (don't regenerate if data unchanged)\n"
            f"6. Streaming support\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _build_skill(self, task: AgentTask) -> AgentResponse:
        skill_name = task.payload.get("skill_name", "")
        description = task.payload.get("description", "")

        prompt = (
            f"Build a reusable skill module named `{skill_name}`.\n\n"
            f"Description: {description}\n\n"
            f"Structure:\n"
            f"1. Skill class with a standardised `.execute(params)` interface\n"
            f"2. Pydantic input/output schemas\n"
            f"3. Async execution support\n"
            f"4. Caching decorator\n"
            f"5. Skill metadata (name, description, version, tags)\n"
            f"6. Registration hook for the skills registry\n"
        )
        content = await self.invoke_llm(prompt)
        artifact = Artifact(
            artifact_type="code",
            name=f"skill_{skill_name.lower().replace(' ', '_')}.py",
            content=content,
            metadata={"skill_name": skill_name},
        )
        return self._success_response(task, content, artifacts=[artifact])

    async def _build_attribution(self, task: AgentTask) -> AgentResponse:
        prompt = (
            f"Implement a Brinson-Hood-Beebower performance attribution model.\n\n"
            f"Calculate:\n"
            f"1. Allocation effect\n"
            f"2. Selection effect\n"
            f"3. Interaction effect\n"
            f"4. Total active return decomposition\n\n"
            f"Output: pandas DataFrame + visualisation-ready dict."
        )
        content = await self.invoke_llm(prompt)
        artifact = Artifact(
            artifact_type="code",
            name="performance_attribution.py",
            content=content,
            metadata={"model": "BHB"},
        )
        return self._success_response(task, content, artifacts=[artifact])

    async def _build_market_analytics(self, task: AgentTask) -> AgentResponse:
        analyses = task.payload.get("analyses", [])
        prompt = (
            f"Implement market analytics functions: {analyses}\n\n"
            f"Requirements:\n"
            f"1. Moving averages (SMA, EMA, VWAP)\n"
            f"2. Momentum indicators (RSI, MACD)\n"
            f"3. Volatility measures (rolling std, GARCH wrapper)\n"
            f"4. Market regime detection\n"
            f"5. Anomaly detection (z-score, IQR)\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _build_backtest(self, task: AgentTask) -> AgentResponse:
        strategy = task.payload.get("strategy", "")
        prompt = (
            f"Design a backtesting framework for strategy: {strategy}\n\n"
            f"Include:\n"
            f"1. Event-driven engine (bar-by-bar)\n"
            f"2. Transaction cost model\n"
            f"3. Portfolio valuation at each step\n"
            f"4. Benchmark comparison\n"
            f"5. Results report (metrics + equity curve data)\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _generic(self, task: AgentTask) -> AgentResponse:
        content = await self.invoke_llm(
            f"Skills/analytics request — {task.task_type}: {task.payload}"
        )
        return self._success_response(task, content)
