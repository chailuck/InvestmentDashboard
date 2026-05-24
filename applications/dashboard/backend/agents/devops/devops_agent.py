"""
DevOpsAgent — Docker, Kubernetes, CI/CD, and infrastructure automation.
"""

from __future__ import annotations

from typing import ClassVar

from ..core.base_agent import BaseAgent
from ..core.models import AgentResponse, AgentTask, AgentType, Artifact
from ..shared.prompts import DEVOPS_SYSTEM


class DevOpsAgent(BaseAgent):
    """
    Generates Docker configs, Kubernetes manifests, Helm charts,
    and GitHub Actions CI/CD pipelines for the investment platform.
    """

    agent_type: ClassVar[AgentType] = AgentType.DEVOPS

    capabilities: ClassVar[list[str]] = [
        "dockerfile",
        "kubernetes_manifest",
        "ci_cd_pipeline",
        "infrastructure",
        "deployment",
        "helm_chart",
        "monitoring_setup",
        "gitops",
    ]

    system_prompt: ClassVar[str] = DEVOPS_SYSTEM

    async def process_task(self, task: AgentTask) -> AgentResponse:
        dispatch = {
            "dockerfile": self._generate_dockerfile,
            "kubernetes_manifest": self._generate_k8s,
            "ci_cd_pipeline": self._generate_pipeline,
            "infrastructure": self._design_infrastructure,
            "deployment": self._generate_deployment,
            "helm_chart": self._generate_helm,
            "monitoring_setup": self._setup_monitoring,
            "gitops": self._setup_gitops,
        }
        handler = dispatch.get(task.task_type)
        if handler:
            return await handler(task)
        return await self._generic(task)

    async def _generate_dockerfile(self, task: AgentTask) -> AgentResponse:
        service = task.payload.get("service", "backend")
        base_image = task.payload.get("base_image", "python:3.12-slim")
        port = task.payload.get("port", 8000)

        prompt = (
            f"Generate an optimised multi-stage Dockerfile for the `{service}` service.\n\n"
            f"Base image: {base_image}\n"
            f"Port: {port}\n\n"
            f"Requirements:\n"
            f"1. Multi-stage build (builder + runtime)\n"
            f"2. Non-root user (UID 1001)\n"
            f"3. Layer caching optimisation (copy requirements before source)\n"
            f"4. Minimal runtime image (no build tools in final stage)\n"
            f"5. Health-check INSTRUCTION\n"
            f"6. .dockerignore companion file\n"
            f"7. Build args for environment (dev/prod)\n"
        )
        content = await self.invoke_llm(prompt)
        artifacts = [
            Artifact(
                artifact_type="code",
                name=f"Dockerfile.{service}",
                content=content,
                metadata={"service": service},
            ),
            Artifact(
                artifact_type="code",
                name=".dockerignore",
                content=content,
                metadata={"type": "dockerignore"},
            ),
        ]
        return self._success_response(task, content, artifacts=artifacts)

    async def _generate_k8s(self, task: AgentTask) -> AgentResponse:
        service = task.payload.get("service", "backend")
        replicas = task.payload.get("replicas", 3)
        resources = task.payload.get("resources", {"cpu": "500m", "memory": "512Mi"})

        prompt = (
            f"Generate Kubernetes manifests for the `{service}` service.\n\n"
            f"Replicas: {replicas}\n"
            f"Resources: {resources}\n\n"
            f"Generate:\n"
            f"1. Deployment (with rolling update strategy, readiness/liveness probes)\n"
            f"2. Service (ClusterIP)\n"
            f"3. HorizontalPodAutoscaler (CPU + memory triggers)\n"
            f"4. PodDisruptionBudget (minAvailable: 2)\n"
            f"5. ConfigMap for non-secret config\n"
            f"6. ServiceAccount\n"
            f"7. NetworkPolicy\n"
        )
        content = await self.invoke_llm(prompt)
        artifact = Artifact(
            artifact_type="code",
            name=f"k8s-{service}.yaml",
            content=content,
            metadata={"service": service, "type": "kubernetes"},
        )
        return self._success_response(task, content, artifacts=[artifact])

    async def _generate_pipeline(self, task: AgentTask) -> AgentResponse:
        trigger = task.payload.get("trigger", "push to main")
        steps = task.payload.get("steps", ["lint", "test", "build", "deploy"])

        prompt = (
            f"Generate a GitHub Actions CI/CD pipeline.\n\n"
            f"Trigger: {trigger}\n"
            f"Steps: {steps}\n\n"
            f"Include:\n"
            f"1. Matrix strategy for Python 3.11 + 3.12\n"
            f"2. Docker build with layer caching (buildx + GitHub cache)\n"
            f"3. Test step with coverage upload (Codecov)\n"
            f"4. Security scan (Trivy for containers, Bandit for Python)\n"
            f"5. Semantic versioning tag on merge to main\n"
            f"6. Kubernetes rolling deployment via kubectl\n"
            f"7. Slack notification on failure\n"
        )
        content = await self.invoke_llm(prompt)
        artifact = Artifact(
            artifact_type="code",
            name=".github/workflows/ci-cd.yml",
            content=content,
            metadata={"type": "github_actions"},
        )
        return self._success_response(task, content, artifacts=[artifact])

    async def _design_infrastructure(self, task: AgentTask) -> AgentResponse:
        environment = task.payload.get("environment", "production")
        cloud = task.payload.get("cloud", "AWS")

        prompt = (
            f"Design the {cloud} infrastructure for the investment platform ({environment}).\n\n"
            f"Cover:\n"
            f"1. EKS cluster topology (node groups, spot instances)\n"
            f"2. RDS PostgreSQL (Multi-AZ, read replica)\n"
            f"3. ElastiCache Redis cluster\n"
            f"4. ALB + Ingress configuration\n"
            f"5. S3 for static assets + CloudFront CDN\n"
            f"6. IAM roles and policies (least privilege)\n"
            f"7. VPC layout (public/private subnets)\n"
            f"8. Terraform module structure\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _generate_deployment(self, task: AgentTask) -> AgentResponse:
        strategy = task.payload.get("strategy", "rolling")
        service = task.payload.get("service", "")

        prompt = (
            f"Generate a {strategy} deployment configuration for `{service}`.\n\n"
            f"Provide:\n"
            f"1. Deployment manifest with strategy spec\n"
            f"2. Pre/post deployment hooks\n"
            f"3. Rollback procedure\n"
            f"4. Database migration job (run before deploy)\n"
            f"5. Smoke test job (run after deploy)\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _generate_helm(self, task: AgentTask) -> AgentResponse:
        chart_name = task.payload.get("chart_name", "investment-dashboard")
        prompt = (
            f"Generate a Helm chart for `{chart_name}`.\n\n"
            f"Include:\n"
            f"1. Chart.yaml (metadata)\n"
            f"2. values.yaml (defaults for dev/staging/prod)\n"
            f"3. Deployment, Service, Ingress templates\n"
            f"4. _helpers.tpl with named templates\n"
            f"5. ConfigMap template with .Values interpolation\n"
            f"6. Secret template (references external secrets operator)\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _setup_monitoring(self, task: AgentTask) -> AgentResponse:
        prompt = (
            f"Set up observability for the investment platform on Kubernetes.\n\n"
            f"Include:\n"
            f"1. Prometheus ServiceMonitor for FastAPI metrics (prometheus-fastapi-instrumentator)\n"
            f"2. Grafana dashboard JSON (key metrics: latency, error rate, throughput)\n"
            f"3. Alert rules (p99 > 500ms, error rate > 1%, pod restarts)\n"
            f"4. Loki log aggregation setup\n"
            f"5. Jaeger / OpenTelemetry tracing config\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _setup_gitops(self, task: AgentTask) -> AgentResponse:
        prompt = (
            f"Configure ArgoCD GitOps for the investment platform.\n\n"
            f"Include:\n"
            f"1. ArgoCD Application manifests per environment\n"
            f"2. App-of-apps pattern for multi-service deployment\n"
            f"3. Image updater configuration\n"
            f"4. Sync policy (automated with self-heal)\n"
            f"5. RBAC for ArgoCD projects\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _generic(self, task: AgentTask) -> AgentResponse:
        content = await self.invoke_llm(
            f"DevOps request — {task.task_type}: {task.payload}"
        )
        return self._success_response(task, content)
