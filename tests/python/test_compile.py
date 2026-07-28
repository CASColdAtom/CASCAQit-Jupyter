from __future__ import annotations

import copy
from typing import Any

import pytest
from cascaqit.digital import DigitalProgramIR

from cascaqit_jupyter.compile import (
    CELL_METADATA_KEY,
    DigitalCompileError,
    compile_digital_document,
    source_hash,
)
from cascaqit_jupyter.editor_ir import EditorDocumentIR
from tests.python.support import digital_document


def test_bell_document_compiles_to_deterministic_public_builder_source() -> None:
    document = EditorDocumentIR.from_dict(digital_document())

    first = compile_digital_document(document, generated_cell_id="cell-bell")
    second = compile_digital_document(document, generated_cell_id="cell-bell")

    expected = """from cascaqit import Circuit

circuit = Circuit(["q0", "q1"], program_id="program.digital.bell")
circuit.h("q0")
circuit.cx("q0", "q1")
circuit.measure_all(key="m")
program = circuit.to_program()
"""
    assert first.generated_source == expected
    assert first.generated_source_hash == source_hash(expected)
    assert first.generated_source == second.generated_source
    assert first.program_hash == second.program_hash
    assert first.document.compile_status == "ready"
    assert first.document.generated_cell_id == "cell-bell"
    assert first.document.source_program_hash == first.program_hash

    namespace: dict[str, Any] = {}
    exec(expected, namespace)  # noqa: S102 - generated user-visible code contract
    executed = namespace["program"]
    assert isinstance(executed, DigitalProgramIR)
    assert executed.stable_hash() == first.program_hash


def test_numeric_gate_parameters_are_stable_and_executable() -> None:
    raw = digital_document()
    raw["editor_model"]["gates"].insert(
        1,
        {
            "id": "g-rotation",
            "gate": "rx",
            "targets": ["q1"],
            "parameters": {"theta": 0.5},
        },
    )

    result = compile_digital_document(EditorDocumentIR.from_dict(raw))

    assert result.generated_source is not None
    assert (
        'circuit.append("rx", ["q1"], parameters={"theta": 0.5})'
        in result.generated_source
    )
    assert result.program is not None
    assert result.program.circuit.gates[1].parameters == {"theta": 0.5}


@pytest.mark.parametrize(
    ("mutate", "code", "path"),
    [
        (
            lambda raw: raw["editor_model"]["qubits"].append({"id": "q0"}),
            "EDITOR_DIGITAL_QUBIT_ID_DUPLICATE",
            "editor_model.qubits",
        ),
        (
            lambda raw: raw["editor_model"]["gates"][0].update(
                {"targets": ["missing"]}
            ),
            "EDITOR_DIGITAL_GATE_TARGET_UNKNOWN",
            "editor_model.gates[0].targets",
        ),
        (
            lambda raw: raw["editor_model"]["measurement"].update(
                {"terminal": False}
            ),
            "EDITOR_DIGITAL_TERMINAL_MEASUREMENT_REQUIRED",
            "editor_model.measurement.terminal",
        ),
        (
            lambda raw: raw["editor_model"]["gates"].append(
                {
                    "id": "g-symbolic",
                    "gate": "rx",
                    "targets": ["q0"],
                    "parameters": {"theta": "theta"},
                }
            ),
            "EDITOR_DIGITAL_SYMBOLIC_PARAMETER_UNBOUND",
            "editor_model.gates[2].parameters",
        ),
    ],
)
def test_invalid_editor_semantics_return_element_diagnostics(
    mutate: Any,
    code: str,
    path: str,
) -> None:
    raw = copy.deepcopy(digital_document())
    mutate(raw)

    with pytest.raises(DigitalCompileError) as error:
        compile_digital_document(EditorDocumentIR.from_dict(raw))

    diagnostic = error.value.diagnostics[0]
    assert diagnostic.code == code
    assert diagnostic.object_path == path
    assert diagnostic.suggestion


def test_user_modified_source_enters_detached_without_replacement() -> None:
    initial = compile_digital_document(
        EditorDocumentIR.from_dict(digital_document()),
        generated_cell_id="cell-bell",
    )
    assert initial.generated_source is not None
    user_source = initial.generated_source + "# user change\n"

    detached = compile_digital_document(
        initial.document,
        generated_cell_id="cell-bell",
        current_source=user_source,
    )

    assert detached.detached is True
    assert detached.document.compile_status == "detached"
    assert detached.generated_source is None
    assert detached.program is None
    assert detached.diagnostics[0].code == "GENERATED_CELL_DETACHED"
    assert detached.document.generated_source_hash == initial.generated_source_hash


def test_cell_metadata_restores_editor_identity_after_reopen() -> None:
    result = compile_digital_document(
        EditorDocumentIR.from_dict(digital_document(revision=3)),
        generated_cell_id="cell-bell",
    )

    metadata = result.cell_metadata[CELL_METADATA_KEY]
    restored = EditorDocumentIR.from_dict(metadata["editor_document"])

    assert metadata["schema_version"] == "1.0"
    assert metadata["document_revision"] == 3
    assert metadata["generated_cell_id"] == "cell-bell"
    assert restored == result.document
    assert restored.generated_source_hash == result.generated_source_hash
