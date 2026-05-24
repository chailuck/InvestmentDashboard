"""
Shared LangChain tools available to all agents.
"""

from __future__ import annotations

import json
from typing import Any

from langchain_core.tools import BaseTool, tool


@tool
def format_code_artifact(code: str, language: str, filename: str) -> str:
    """
    Format a code snippet as a structured artifact JSON string.

    Args:
        code: The source code content.
        language: Programming language (python, typescript, yaml, sql, etc.)
        filename: Suggested filename for the artifact.
    """
    return json.dumps(
        {
            "artifact_type": "code",
            "language": language,
            "filename": filename,
            "content": code,
        },
        indent=2,
    )


@tool
def create_task_summary(
    task_type: str,
    outcome: str,
    files_affected: list[str],
    next_steps: list[str],
) -> str:
    """
    Create a structured task completion summary.

    Args:
        task_type: The type of task completed.
        outcome: Human-readable outcome description.
        files_affected: List of files created or modified.
        next_steps: Recommended follow-up actions.
    """
    return json.dumps(
        {
            "task_type": task_type,
            "outcome": outcome,
            "files_affected": files_affected,
            "next_steps": next_steps,
        },
        indent=2,
    )


@tool
def validate_typescript_types(code: str) -> str:
    """
    Validate that a TypeScript snippet uses proper typing conventions.
    Returns a JSON report.

    Args:
        code: TypeScript source code to check.
    """
    issues: list[str] = []
    warnings: list[str] = []

    if ": any" in code or "<any>" in code:
        issues.append("Found `any` type — replace with specific types")
    if "// @ts-ignore" in code:
        warnings.append("Contains @ts-ignore directives")
    if "as unknown as" in code:
        warnings.append("Double cast detected — review type safety")

    return json.dumps(
        {
            "valid": len(issues) == 0,
            "issues": issues,
            "warnings": warnings,
        },
        indent=2,
    )


@tool
def generate_openapi_snippet(
    method: str,
    path: str,
    summary: str,
    request_schema: dict[str, Any],
    response_schema: dict[str, Any],
    tags: list[str],
) -> str:
    """
    Generate an OpenAPI 3.1 path snippet for an endpoint.

    Args:
        method: HTTP method (get, post, put, patch, delete).
        path: API path (e.g. /api/v1/portfolios/{id}).
        summary: Short endpoint description.
        request_schema: JSON Schema dict for the request body.
        response_schema: JSON Schema dict for the 200 response.
        tags: List of OpenAPI tags.
    """
    snippet: dict[str, Any] = {
        path: {
            method.lower(): {
                "tags": tags,
                "summary": summary,
                "requestBody": {
                    "required": True,
                    "content": {
                        "application/json": {
                            "schema": request_schema,
                        }
                    },
                }
                if method.lower() not in ("get", "delete")
                else None,
                "responses": {
                    "200": {
                        "description": "Success",
                        "content": {
                            "application/json": {
                                "schema": response_schema,
                            }
                        },
                    },
                    "422": {"description": "Validation error"},
                    "401": {"description": "Unauthorised"},
                },
            }
        }
    }
    return json.dumps(snippet, indent=2)


# Registry of tools available to all agents
SHARED_TOOLS: list[BaseTool] = [
    format_code_artifact,  # type: ignore[list-item]
    create_task_summary,  # type: ignore[list-item]
    validate_typescript_types,  # type: ignore[list-item]
    generate_openapi_snippet,  # type: ignore[list-item]
]
