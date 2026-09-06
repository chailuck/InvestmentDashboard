"""Pydantic models for the database backup / restore API (format v2.0)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

RestoreMode = Literal["skip_if_conflict", "replace_all"]


class RestoreOptions(BaseModel):
    """Optional request body for the stored-file restore endpoint."""

    mode: RestoreMode = "skip_if_conflict"
    confirm: str | None = Field(
        default=None,
        description="Required literal 'REPLACE ALL DATA' when mode='replace_all'.",
    )


class TableInfo(BaseModel):
    name: str
    row_count: int
    owner_service: str
    restorable: bool
    in_conflict_check: bool
    note: str | None = None
    row_count_estimated: bool = False


class BackupTablesResponse(BaseModel):
    database: str
    generated_at: str
    total_tables: int
    insert_order: list[str]
    tables: list[TableInfo]


class CreateBackupResult(BaseModel):
    filename: str
    created_at: str
    size_kb: float
    total_rows: int
    version: str
    covered_tables: list[str]
    row_counts: dict[str, int]
    checksums: dict[str, str]


class BackupListItem(BaseModel):
    filename: str
    size_kb: float
    created_at: str
    version: str
    covered_table_count: int | None = None


class RestoreResult(BaseModel):
    version: str | None = None
    mode: str
    legacy_backup: bool = False
    restored: dict[str, int] = {}
    total_rows: int = 0
    errors: list[str] = []
    covered_tables: list[str] = []
    uncovered_tables: list[str] = []
    file_tables_not_in_db: list[str] = []
    checksum_verification: dict[str, str] = {}
    schema_version_drift: dict[str, Any] = {}
    source_created_at: str | None = None
