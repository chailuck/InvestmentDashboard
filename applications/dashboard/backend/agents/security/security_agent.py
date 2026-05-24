"""
SecurityAgent — JWT, RBAC, hardening, and secret management.
"""

from __future__ import annotations

from typing import ClassVar

from ..core.base_agent import BaseAgent
from ..core.models import AgentResponse, AgentTask, AgentType, Artifact
from ..shared.prompts import SECURITY_SYSTEM


class SecurityAgent(BaseAgent):
    """
    Implements authentication, authorisation, security hardening,
    and secret management for the enterprise investment platform.
    """

    agent_type: ClassVar[AgentType] = AgentType.SECURITY

    capabilities: ClassVar[list[str]] = [
        "jwt_setup",
        "rbac_policy",
        "security_hardening",
        "secret_management",
        "vulnerability_scan",
        "auth_flow",
        "audit_logging",
        "owasp_review",
    ]

    system_prompt: ClassVar[str] = SECURITY_SYSTEM

    async def process_task(self, task: AgentTask) -> AgentResponse:
        dispatch = {
            "jwt_setup": self._setup_jwt,
            "rbac_policy": self._design_rbac,
            "security_hardening": self._harden,
            "secret_management": self._manage_secrets,
            "vulnerability_scan": self._scan_vulnerabilities,
            "auth_flow": self._design_auth_flow,
            "audit_logging": self._setup_audit_logging,
            "owasp_review": self._owasp_review,
        }
        handler = dispatch.get(task.task_type)
        if handler:
            return await handler(task)
        return await self._generic(task)

    async def _setup_jwt(self, task: AgentTask) -> AgentResponse:
        algorithm = task.payload.get("algorithm", "RS256")
        access_ttl = task.payload.get("access_ttl_minutes", 15)
        refresh_ttl = task.payload.get("refresh_ttl_days", 7)

        prompt = (
            f"Implement JWT authentication for the FastAPI investment platform.\n\n"
            f"Algorithm: {algorithm}\n"
            f"Access token TTL: {access_ttl} minutes\n"
            f"Refresh token TTL: {refresh_ttl} days\n\n"
            f"Include:\n"
            f"1. Token generation (access + refresh) with PyJWT\n"
            f"2. Token verification dependency (FastAPI Depends)\n"
            f"3. Refresh token rotation (invalidate old on use)\n"
            f"4. Token blacklist (Redis set for revoked JTIs)\n"
            f"5. RS256 key pair generation and rotation strategy\n"
            f"6. Secure cookie storage option\n"
            f"7. Token claims structure (sub, exp, iat, jti, roles)\n"
        )
        content = await self.invoke_llm(prompt)
        artifact = Artifact(
            artifact_type="code",
            name="auth_jwt.py",
            content=content,
            metadata={"algorithm": algorithm},
        )
        return self._success_response(task, content, artifacts=[artifact])

    async def _design_rbac(self, task: AgentTask) -> AgentResponse:
        roles = task.payload.get("roles", ["admin", "analyst", "viewer"])
        resources = task.payload.get("resources", [])

        prompt = (
            f"Design the RBAC system for the investment platform.\n\n"
            f"Roles: {roles}\n"
            f"Resources: {resources}\n\n"
            f"Define:\n"
            f"1. Role hierarchy and inheritance\n"
            f"2. Permission matrix (role × resource × action)\n"
            f"3. FastAPI dependency for permission checking\n"
            f"4. Database schema for dynamic role assignment\n"
            f"5. Permission caching (Redis, 5 min TTL)\n"
            f"6. Audit trail for permission changes\n"
            f"7. Row-level security for multi-tenant data\n"
        )
        content = await self.invoke_llm(prompt)
        artifact = Artifact(
            artifact_type="code",
            name="rbac.py",
            content=content,
            metadata={"roles": roles},
        )
        return self._success_response(task, content, artifacts=[artifact])

    async def _harden(self, task: AgentTask) -> AgentResponse:
        component = task.payload.get("component", "fastapi")
        prompt = (
            f"Apply security hardening to the `{component}` component.\n\n"
            f"Implement:\n"
            f"1. Security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options)\n"
            f"2. CORS policy (explicit origins, no wildcard in prod)\n"
            f"3. Input sanitisation and SQL injection prevention\n"
            f"4. Rate limiting (per-IP and per-user)\n"
            f"5. Request size limits\n"
            f"6. HTTPS enforcement and HSTS preload\n"
            f"7. Dependency vulnerability scanning (pip-audit / Snyk)\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _manage_secrets(self, task: AgentTask) -> AgentResponse:
        provider = task.payload.get("provider", "aws_secrets_manager")
        secrets = task.payload.get("secrets", [])

        prompt = (
            f"Design secret management using {provider}.\n\n"
            f"Secrets to manage: {secrets}\n\n"
            f"Include:\n"
            f"1. Secret naming convention\n"
            f"2. Access policy (least privilege IAM)\n"
            f"3. Kubernetes ExternalSecrets operator config\n"
            f"4. Secret rotation procedure\n"
            f"5. Application secret loading (at startup, not hardcoded)\n"
            f"6. Audit logging for secret access\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _scan_vulnerabilities(self, task: AgentTask) -> AgentResponse:
        code = task.payload.get("code", "")
        scan_type = task.payload.get("scan_type", "owasp")
        prompt = (
            f"Perform a {scan_type} vulnerability scan on the following code:\n\n"
            f"```python\n{code}\n```\n\n"
            f"Check for:\n"
            f"1. Injection vulnerabilities (SQL, command, LDAP)\n"
            f"2. Broken authentication patterns\n"
            f"3. Sensitive data exposure\n"
            f"4. Security misconfiguration\n"
            f"5. Using components with known vulnerabilities\n"
            f"6. Insecure logging (PII, tokens in logs)\n\n"
            f"Return: severity (CRITICAL/HIGH/MEDIUM/LOW), location, and remediation."
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _design_auth_flow(self, task: AgentTask) -> AgentResponse:
        flow_type = task.payload.get("flow_type", "oauth2_pkce")
        prompt = (
            f"Design the {flow_type} authentication flow for the investment platform.\n\n"
            f"Cover:\n"
            f"1. Step-by-step flow diagram (textual)\n"
            f"2. Frontend implementation (React + PKCE)\n"
            f"3. Backend token exchange endpoint\n"
            f"4. Session management strategy\n"
            f"5. MFA integration point\n"
            f"6. SSO / IdP integration (Cognito / Auth0)\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _setup_audit_logging(self, task: AgentTask) -> AgentResponse:
        prompt = (
            f"Implement audit logging for the investment platform.\n\n"
            f"Log all:\n"
            f"1. Authentication events (login, logout, token refresh, failed attempts)\n"
            f"2. Authorisation decisions (grants and denials)\n"
            f"3. Data access events (who read what portfolio data)\n"
            f"4. Admin actions (user management, permission changes)\n"
            f"5. AI copilot interactions (prompt + response hash)\n\n"
            f"Implementation:\n"
            f"- FastAPI middleware for automatic capture\n"
            f"- Structured JSON logs to dedicated audit table\n"
            f"- Tamper-evident log chaining (hash previous entry)\n"
            f"- Retention policy (7 years for financial compliance)\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _owasp_review(self, task: AgentTask) -> AgentResponse:
        code = task.payload.get("code", "")
        prompt = (
            f"Review the following code against OWASP Top 10 2021:\n\n"
            f"```\n{code}\n```\n\n"
            f"Check all 10 categories: A01 Broken Access Control, A02 Cryptographic Failures, "
            f"A03 Injection, A04 Insecure Design, A05 Security Misconfiguration, "
            f"A06 Vulnerable Components, A07 Auth Failures, A08 Software Integrity, "
            f"A09 Logging Failures, A10 SSRF.\n\n"
            f"Rate each as: NOT_APPLICABLE / PASS / FINDING, with findings including severity."
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _generic(self, task: AgentTask) -> AgentResponse:
        content = await self.invoke_llm(
            f"Security request — {task.task_type}: {task.payload}"
        )
        return self._success_response(task, content)
