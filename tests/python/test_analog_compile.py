from __future__ import annotations

import copy
from typing import Any

import pytest

from cascaqit_jupyter.analog_compile import (
    AnalogCompileError,
    compile_analog_document,
)
from cascaqit_jupyter.compile import CELL_METADATA_KEY, source_hash
from cascaqit_jupyter.editor_ir import EditorDocumentIR
from tests.python.support import analog_document


def test_two_site_document_compiles_to_deterministic_validated_source() -> None:
    document = EditorDocumentIR.from_dict(analog_document())

    first = compile_analog_document(document, generated_cell_id="cell-analog")
    second = compile_analog_document(document, generated_cell_id="cell-analog")

    assert first.generated_source is not None
    assert first.generated_source_hash == source_hash(first.generated_source)
    assert first.generated_source == second.generated_source
    assert first.program_hash == second.program_hash
    assert first.program is not None
    assert first.program.program_type == "analog"
    assert first.document.compile_status == "ready"
    assert first.document.generated_cell_id == "cell-analog"
    namespace: dict[str, Any] = {}
    exec(first.generated_source, namespace)  # noqa: S102 - generated source contract
    assert namespace["program"].stable_hash() == first.program_hash
    diagnostics = namespace["validation"].diagnostics
    assert not any(item.severity == "error" for item in diagnostics)


@pytest.mark.parametrize(
    ("mutate", "code", "path"),
    [
        (
            lambda raw: raw["editor_model"]["register"]["sites"][1].update(
                {"id": "s0"}
            ),
            "EDITOR_ANALOG_SITE_ID_DUPLICATE",
            "editor_model.register.sites",
        ),
        (
            lambda raw: raw["editor_model"]["controls"]["rabi"]["segments"][1].update(
                {"start_value": 1.0}
            ),
            "EDITOR_ANALOG_SEGMENT_DISCONTINUITY",
            "editor_model.controls.rabi.segments[1]",
        ),
        (
            lambda raw: raw["editor_model"]["controls"]["phase"]["segments"][0].update(
                {"duration": 1.0}
            ),
            "EDITOR_ANALOG_CHANNEL_DURATION_MISMATCH",
            "editor_model.controls",
        ),
        (
            lambda raw: raw["editor_model"]["measurement"].update(
                {"enabled": False}
            ),
            "EDITOR_ANALOG_MEASUREMENT_REQUIRED",
            "editor_model.measurement.enabled",
        ),
    ],
)
def test_editor_semantics_return_element_diagnostics(
    mutate: Any, code: str, path: str
) -> None:
    raw = copy.deepcopy(analog_document())
    mutate(raw)

    with pytest.raises(AnalogCompileError) as error:
        compile_analog_document(EditorDocumentIR.from_dict(raw))

    diagnostic = error.value.diagnostics[0]
    assert diagnostic.code == code
    assert diagnostic.object_path == path
    assert diagnostic.suggestion


def test_target_validation_maps_register_diagnostics_to_editor_path() -> None:
    raw = analog_document()
    raw["editor_model"]["register"]["sites"][1]["x"] = 1.0

    with pytest.raises(AnalogCompileError) as error:
        compile_analog_document(EditorDocumentIR.from_dict(raw))

    diagnostic = error.value.diagnostics[0]
    assert diagnostic.code == "ATOM_SPACING_TOO_SMALL"
    assert diagnostic.object_path == "editor_model.register.sites"


def test_vacant_site_is_preserved_in_generated_program() -> None:
    raw = analog_document()
    raw["editor_model"]["register"]["sites"][1]["occupied"] = False

    result = compile_analog_document(EditorDocumentIR.from_dict(raw))

    assert result.program is not None
    assert result.program.register.sites[1].status == "vacant"
    assert result.program.register.sites[1].atom_id is None
    assert "with_site_status" in (result.generated_source or "")


def test_modified_source_detaches_and_metadata_restores_identity() -> None:
    initial = compile_analog_document(
        EditorDocumentIR.from_dict(analog_document(revision=2)),
        generated_cell_id="cell-analog",
    )
    assert initial.generated_source is not None

    detached = compile_analog_document(
        initial.document,
        generated_cell_id="cell-analog",
        current_source=initial.generated_source + "# user change\n",
    )

    assert detached.detached is True
    assert detached.document.compile_status == "detached"
    assert detached.generated_source is None
    assert detached.diagnostics[0].code == "GENERATED_CELL_DETACHED"
    metadata = initial.cell_metadata[CELL_METADATA_KEY]
    assert metadata["editor_document"] == initial.document.to_dict()
