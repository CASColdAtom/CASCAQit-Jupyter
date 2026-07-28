from __future__ import annotations

import copy

import pytest

from cascaqit_jupyter.editor_ir import (
    EditorDocumentIR,
    UnsupportedEditorSchemaVersion,
    migrate_editor_document,
)
from cascaqit_jupyter.schema import SchemaContractError, load_schema
from tests.python.support import digital_document


def test_packaged_schemas_are_valid_draft_2020_12() -> None:
    for name in ("comm", "editor_document", "mime"):
        assert load_schema(name)["$schema"].endswith("draft/2020-12/schema")


def test_editor_document_round_trip_and_hash_are_stable() -> None:
    raw = digital_document(revision=2)
    document = EditorDocumentIR.from_dict(raw)

    assert document.to_dict() == raw
    assert EditorDocumentIR.from_dict(document.to_dict()).stable_hash() == (
        document.stable_hash()
    )

    raw["metadata"] = {"changed": True}
    assert document.metadata == {}


def test_current_migration_is_identity_without_aliasing() -> None:
    raw = digital_document()
    migrated = migrate_editor_document(raw)
    assert migrated == raw
    assert migrated is not raw
    assert migrated["editor_model"] is not raw["editor_model"]


def test_unknown_schema_major_is_rejected_without_guessing() -> None:
    raw = digital_document()
    raw["schema_version"] = "2.0"
    with pytest.raises(UnsupportedEditorSchemaVersion, match="2.0"):
        EditorDocumentIR.from_dict(raw)


def test_program_kind_and_editor_model_discriminator_must_match() -> None:
    raw = digital_document()
    invalid = copy.deepcopy(raw)
    invalid["program_kind"] = "analog"

    with pytest.raises(SchemaContractError, match="SCHEMA_VALIDATION_FAILED"):
        EditorDocumentIR.from_dict(invalid)
