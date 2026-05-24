"""
QAAgent — unit, integration, frontend, and E2E test generation.
"""

from __future__ import annotations

from typing import ClassVar

from ..core.base_agent import BaseAgent
from ..core.models import AgentResponse, AgentTask, AgentType, Artifact
from ..shared.prompts import QA_SYSTEM


class QAAgent(BaseAgent):
    """
    Generates test suites, fixtures, and CI coverage enforcement for
    all layers of the investment platform.
    """

    agent_type: ClassVar[AgentType] = AgentType.QA

    capabilities: ClassVar[list[str]] = [
        "unit_test",
        "integration_test",
        "e2e_test",
        "test_strategy",
        "fixture_factory",
        "coverage_report",
        "contract_test",
    ]

    system_prompt: ClassVar[str] = QA_SYSTEM

    async def process_task(self, task: AgentTask) -> AgentResponse:
        dispatch = {
            "unit_test": self._generate_unit_tests,
            "integration_test": self._generate_integration_tests,
            "e2e_test": self._generate_e2e_tests,
            "test_strategy": self._design_test_strategy,
            "fixture_factory": self._generate_fixtures,
            "coverage_report": self._analyse_coverage,
            "contract_test": self._generate_contract_tests,
        }
        handler = dispatch.get(task.task_type)
        if handler:
            return await handler(task)
        return await self._generic(task)

    async def _generate_unit_tests(self, task: AgentTask) -> AgentResponse:
        code = task.payload.get("code", "")
        module = task.payload.get("module", "")
        framework = task.payload.get("framework", "pytest")

        prompt = (
            f"Generate comprehensive unit tests for the following code using {framework}.\n\n"
            f"Module: {module}\n\n"
            f"```python\n{code}\n```\n\n"
            f"Requirements:\n"
            f"1. Test each public function / method\n"
            f"2. Happy path + edge cases + error cases\n"
            f"3. Parametrize repetitive cases (@pytest.mark.parametrize)\n"
            f"4. Mock external dependencies (database, HTTP, LLM)\n"
            f"5. Fixtures for test data (use factory pattern)\n"
            f"6. Aim for >90% coverage of the provided code\n"
            f"7. Descriptive test names (test_<unit>_<condition>_<expected>)\n"
        )
        content = await self.invoke_llm(prompt)
        artifact = Artifact(
            artifact_type="code",
            name=f"test_{module.replace('.', '_')}.py",
            content=content,
            metadata={"framework": framework, "type": "unit_test"},
        )
        return self._success_response(task, content, artifacts=[artifact])

    async def _generate_integration_tests(self, task: AgentTask) -> AgentResponse:
        endpoint = task.payload.get("endpoint", "")
        method = task.payload.get("method", "GET")
        scenarios = task.payload.get("scenarios", [])

        prompt = (
            f"Generate FastAPI integration tests for {method} {endpoint}.\n\n"
            f"Scenarios: {scenarios}\n\n"
            f"Use:\n"
            f"1. httpx.AsyncClient with FastAPI TestClient\n"
            f"2. pytest-asyncio for async tests\n"
            f"3. Real database (SQLite in-memory or test PostgreSQL)\n"
            f"4. No mocks for core business logic\n"
            f"5. Database state setup and teardown per test\n"
            f"6. Auth token fixture (bypass real OAuth)\n"
            f"7. Test all HTTP status codes for the endpoint\n"
        )
        content = await self.invoke_llm(prompt)
        artifact = Artifact(
            artifact_type="code",
            name=f"test_integration_{endpoint.replace('/', '_').strip('_')}.py",
            content=content,
            metadata={"type": "integration_test", "endpoint": endpoint},
        )
        return self._success_response(task, content, artifacts=[artifact])

    async def _generate_e2e_tests(self, task: AgentTask) -> AgentResponse:
        user_journey = task.payload.get("user_journey", "")
        steps = task.payload.get("steps", [])

        prompt = (
            f"Generate Playwright E2E tests for the user journey: {user_journey}\n\n"
            f"Steps: {steps}\n\n"
            f"Requirements:\n"
            f"1. Page Object Model (separate page classes)\n"
            f"2. Test fixtures for authenticated user state\n"
            f"3. API mocking for external data (MSW / Playwright route)\n"
            f"4. Screenshot on failure\n"
            f"5. Accessibility checks (axe-core)\n"
            f"6. Cross-browser (Chrome + Firefox)\n"
            f"7. CI-compatible (headed:false, retries:2)\n"
        )
        content = await self.invoke_llm(prompt)
        artifact = Artifact(
            artifact_type="code",
            name=f"e2e_{user_journey.replace(' ', '_')}.spec.ts",
            content=content,
            metadata={"type": "e2e", "framework": "playwright"},
        )
        return self._success_response(task, content, artifacts=[artifact])

    async def _design_test_strategy(self, task: AgentTask) -> AgentResponse:
        scope = task.payload.get("scope", "full platform")
        prompt = (
            f"Design the test strategy for: {scope}\n\n"
            f"Define:\n"
            f"1. Test pyramid (unit / integration / E2E proportions)\n"
            f"2. Coverage targets per layer (>90% unit, >80% integration)\n"
            f"3. Test tooling choices with rationale\n"
            f"4. CI enforcement (fail if below threshold)\n"
            f"5. Performance test strategy (k6 load tests)\n"
            f"6. Security test integration (SAST, DAST)\n"
            f"7. Test data management (factories, seeds, snapshots)\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _generate_fixtures(self, task: AgentTask) -> AgentResponse:
        domain = task.payload.get("domain", "")
        entities = task.payload.get("entities", [])

        prompt = (
            f"Generate test fixtures and factories for the `{domain}` domain.\n\n"
            f"Entities: {entities}\n\n"
            f"Provide:\n"
            f"1. Factory-boy (Python) or factory functions for each entity\n"
            f"2. Realistic fake data (Faker library)\n"
            f"3. Relationship builders (create user with portfolios)\n"
            f"4. pytest fixtures at module and function scope\n"
            f"5. Database seeding script for local dev\n"
        )
        content = await self.invoke_llm(prompt)
        artifact = Artifact(
            artifact_type="code",
            name=f"factories_{domain}.py",
            content=content,
            metadata={"domain": domain, "type": "fixtures"},
        )
        return self._success_response(task, content, artifacts=[artifact])

    async def _analyse_coverage(self, task: AgentTask) -> AgentResponse:
        coverage_report = task.payload.get("coverage_report", "")
        threshold = task.payload.get("threshold", 80)

        prompt = (
            f"Analyse the following test coverage report and identify gaps:\n\n"
            f"{coverage_report}\n\n"
            f"Target: >{threshold}% coverage\n\n"
            f"Report:\n"
            f"1. Modules below threshold\n"
            f"2. Critical untested paths (error handlers, auth logic)\n"
            f"3. Recommended tests to add (with priority)\n"
            f"4. Quick wins (easy tests that add significant coverage)\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _generate_contract_tests(self, task: AgentTask) -> AgentResponse:
        consumer = task.payload.get("consumer", "frontend")
        provider = task.payload.get("provider", "backend")
        endpoints = task.payload.get("endpoints", [])

        prompt = (
            f"Generate Pact contract tests between {consumer} and {provider}.\n\n"
            f"Endpoints: {endpoints}\n\n"
            f"Include:\n"
            f"1. Consumer-side Pact test (React)\n"
            f"2. Provider-side verification (FastAPI)\n"
            f"3. Pact broker configuration\n"
            f"4. CI integration (publish + verify on PR)\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _generic(self, task: AgentTask) -> AgentResponse:
        content = await self.invoke_llm(
            f"QA request — {task.task_type}: {task.payload}"
        )
        return self._success_response(task, content)
