"""Versioned editor state that remains separate from CASCAQit Program IR."""

from __future__ import annotations

import copy
import hashlib
import json
from dataclasses import dataclass, field
from typing import Any, Literal

from cascaqit_jupyter.schema import validate_contract

EDITOR_SCHEMA_VERSION = "1.0"
ProgramKind = Literal["digital", "analog", "hybrid"]
CompileStatus = Literal[
    "draft",
    "invalid",
    "ready",
    "running",
    "completed",
    "failed",
    "cancelled",
    "detached",
]


@dataclass(frozen=True)
class UnsupportedEditorSchemaVersion(ValueError):
    """Raised when an editor document uses an unknown or future schema."""

    schema_version: object

    def __str__(self) -> str:
        return f"Unsupported EditorDocumentIR schema version: {self.schema_version!r}"


@dataclass(frozen=True)
class EditorDocumentIR:
    """Authoritative, versioned state for one visual editor document."""

    document_id: str
    revision: int
    program_kind: ProgramKind
    editor_model: dict[str, Any]
    compile_status: CompileStatus = "draft"
    generated_source_hash: str | None = None
    generated_cell_id: str | None = None
    source_program_hash: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    schema_version: str = EDITOR_SCHEMA_VERSION

    def __post_init__(self) -> None:
        normalized = self.to_dict()
        validate_contract("editor_document", normalized)
        object.__setattr__(self, "editor_model", copy.deepcopy(self.editor_model))
        object.__setattr__(self, "metadata", copy.deepcopy(self.metadata))

    def to_dict(self) -> dict[str, Any]:
        """Return a detached JSON-compatible document representation."""
        return {
            "schema_version": self.schema_version,
            "document_id": self.document_id,
            "revision": self.revision,
            "program_kind": self.program_kind,
            "editor_model": copy.deepcopy(self.editor_model),
            "generated_source_hash": self.generated_source_hash,
            "generated_cell_id": self.generated_cell_id,
            "compile_status": self.compile_status,
            "source_program_hash": self.source_program_hash,
            "metadata": copy.deepcopy(self.metadata),
        }

    def stable_hash(self) -> str:
        """Return a deterministic SHA-256 for saved editor state."""
        encoded = json.dumps(
            self.to_dict(),
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> EditorDocumentIR:
        """Validate and construct the current editor document schema."""
        normalized = migrate_editor_document(value)
        validate_contract("editor_document", normalized)
        return cls(
            schema_version=str(normalized["schema_version"]),
            document_id=str(normalized["document_id"]),
            revision=int(normalized["revision"]),
            program_kind=normalized["program_kind"],
            editor_model=dict(normalized["editor_model"]),
            generated_source_hash=normalized["generated_source_hash"],
            generated_cell_id=normalized["generated_cell_id"],
            compile_status=normalized["compile_status"],
            source_program_hash=normalized["source_program_hash"],
            metadata=dict(normalized["metadata"]),
        )


def migrate_editor_document(value: dict[str, Any]) -> dict[str, Any]:
    """Return a current document copy or reject versions without a migration."""
    if not isinstance(value, dict):
        raise TypeError("EditorDocumentIR input must be an object.")
    version = value.get("schema_version")
    if version != EDITOR_SCHEMA_VERSION:
        raise UnsupportedEditorSchemaVersion(version)
    return copy.deepcopy(value)
