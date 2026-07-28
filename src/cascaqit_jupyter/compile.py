"""Deterministic Digital editor compilation through public CASCAQit APIs."""

from __future__ import annotations

import copy
import hashlib
import json
from dataclasses import dataclass, replace
from typing import Any, NoReturn

from cascaqit import Circuit
from cascaqit.diagnostics import DiagnosticsIR
from cascaqit.digital import DigitalProgramIR
from cascaqit.exceptions import CASCAQitError

from cascaqit_jupyter.editor_ir import EditorDocumentIR

CELL_METADATA_KEY = "cascaqit_jupyter"
CELL_METADATA_VERSION = "1.0"


@dataclass(frozen=True)
class DigitalCompileError(ValueError):
    """A bounded Digital editor failure with machine-readable diagnostics."""

    diagnostics: tuple[DiagnosticsIR, ...]

    def __str__(self) -> str:
        return self.diagnostics[0].message


@dataclass(frozen=True)
class DigitalCompileResult:
    """Compilation or Detached decision returned to a Notebook client."""

    document: EditorDocumentIR
    generated_source: str | None
    generated_source_hash: str | None
    program: DigitalProgramIR | None
    program_hash: str | None
    cell_metadata: dict[str, Any]
    detached: bool
    diagnostics: tuple[DiagnosticsIR, ...] = ()

    def to_payload(self) -> dict[str, Any]:
        """Return the JSON-compatible comm response payload."""
        return {
            "document": self.document.to_dict(),
            "generated_source": self.generated_source,
            "generated_source_hash": self.generated_source_hash,
            "program": None if self.program is None else self.program.to_dict(),
            "program_hash": self.program_hash,
            "cell_metadata": copy.deepcopy(self.cell_metadata),
            "detached": self.detached,
            "diagnostics": [item.to_dict() for item in self.diagnostics],
        }


def compile_digital_document(
    document: EditorDocumentIR,
    *,
    generated_cell_id: str | None = None,
    current_source: str | None = None,
) -> DigitalCompileResult:
    """Compile one Digital document or preserve a user-modified cell as Detached."""
    if document.program_kind != "digital":
        _fail(
            code="EDITOR_PROGRAM_KIND_UNSUPPORTED",
            message="Digital compilation requires a Digital editor document.",
            object_path="program_kind",
            suggestion="Open this document in its matching editor.",
        )
    if generated_cell_id is not None and not generated_cell_id.strip():
        raise ValueError("generated_cell_id must be non-empty when provided.")
    if (
        document.generated_source_hash is not None
        and current_source is not None
        and source_hash(current_source) != document.generated_source_hash
    ):
        detached = replace(document, compile_status="detached")
        return DigitalCompileResult(
            document=detached,
            generated_source=None,
            generated_source_hash=document.generated_source_hash,
            program=None,
            program_hash=document.source_program_hash,
            cell_metadata=build_cell_metadata(detached),
            detached=True,
            diagnostics=(
                DiagnosticsIR(
                    diagnostic_id="diagnostic.jupyter.generated_cell_detached",
                    stage="validation",
                    severity="warning",
                    code="GENERATED_CELL_DETACHED",
                    message=(
                        "The generated cell was modified after its last editor sync."
                    ),
                    object_path="generated_cell_id",
                    suggestion=(
                        "Keep the user source unchanged or create a new generated cell."
                    ),
                ),
            ),
        )

    model = document.editor_model
    qubits = _qubit_ids(model)
    gates = _gates(model, qubits)
    measurement = _measurement(model)
    program_id = _program_id(document.document_id)
    source = _generate_source(
        qubits=qubits,
        gates=gates,
        measurement_key=measurement["key"],
        program_id=program_id,
    )
    try:
        circuit = Circuit(qubits, program_id=program_id)
        for index, gate in enumerate(gates):
            try:
                circuit.append(
                    gate["gate"],
                    gate["targets"],
                    parameters=gate["parameters"],
                )
            except CASCAQitError as exc:
                _fail_from_cascaqit(exc, index)
        circuit.measure_all(key=measurement["key"])
        program = circuit.to_program()
    except DigitalCompileError:
        raise
    except CASCAQitError as exc:
        _fail_from_cascaqit(exc)

    generated_hash = source_hash(source)
    program_hash = program.stable_hash()
    compiled = replace(
        document,
        compile_status="ready",
        generated_source_hash=generated_hash,
        generated_cell_id=generated_cell_id,
        source_program_hash=program_hash,
    )
    return DigitalCompileResult(
        document=compiled,
        generated_source=source,
        generated_source_hash=generated_hash,
        program=program,
        program_hash=program_hash,
        cell_metadata=build_cell_metadata(compiled),
        detached=False,
    )


def build_cell_metadata(document: EditorDocumentIR) -> dict[str, Any]:
    """Build versioned metadata sufficient for save/reopen association checks."""
    return {
        CELL_METADATA_KEY: {
            "schema_version": CELL_METADATA_VERSION,
            "document_id": document.document_id,
            "document_revision": document.revision,
            "generated_source_hash": document.generated_source_hash,
            "generated_cell_id": document.generated_cell_id,
            "source_program_hash": document.source_program_hash,
            "editor_document": document.to_dict(),
        }
    }


def source_hash(source: str) -> str:
    """Hash exact generated cell text without newline normalization."""
    if not isinstance(source, str):
        raise TypeError("source must be a string.")
    return hashlib.sha256(source.encode("utf-8")).hexdigest()


def _qubit_ids(model: dict[str, Any]) -> tuple[str, ...]:
    values = model.get("qubits")
    assert isinstance(values, list)
    qubits = tuple(str(item["id"]) for item in values)
    if len(set(qubits)) != len(qubits):
        _fail(
            code="EDITOR_DIGITAL_QUBIT_ID_DUPLICATE",
            message="Digital qubit IDs must be unique.",
            object_path="editor_model.qubits",
            suggestion="Rename or remove the duplicate qubit.",
        )
    return qubits


def _gates(
    model: dict[str, Any],
    qubits: tuple[str, ...],
) -> tuple[dict[str, Any], ...]:
    values = model.get("gates")
    assert isinstance(values, list)
    gate_ids: set[str] = set()
    normalized: list[dict[str, Any]] = []
    for index, value in enumerate(values):
        assert isinstance(value, dict)
        gate_id = str(value["id"])
        if gate_id in gate_ids:
            _fail(
                code="EDITOR_DIGITAL_GATE_ID_DUPLICATE",
                message="Digital gate IDs must be unique.",
                object_path=f"editor_model.gates[{index}].id",
                suggestion="Assign each gate a stable unique ID.",
            )
        gate_ids.add(gate_id)
        targets = tuple(str(item) for item in value["targets"])
        unknown = tuple(target for target in targets if target not in qubits)
        if unknown:
            _fail(
                code="EDITOR_DIGITAL_GATE_TARGET_UNKNOWN",
                message="A Digital gate targets an unknown qubit.",
                object_path=f"editor_model.gates[{index}].targets",
                suggestion="Select targets from the current qubit list.",
            )
        parameters = dict(value["parameters"])
        symbolic = tuple(
            name for name, parameter in parameters.items() if isinstance(parameter, str)
        )
        if symbolic:
            _fail(
                code="EDITOR_DIGITAL_SYMBOLIC_PARAMETER_UNBOUND",
                message="Symbolic gate parameters must be numeric before compilation.",
                object_path=f"editor_model.gates[{index}].parameters",
                suggestion="Enter a finite numeric value for each gate parameter.",
            )
        normalized.append(
            {
                "id": gate_id,
                "gate": str(value["gate"]).lower(),
                "targets": targets,
                "parameters": parameters,
            }
        )
    return tuple(normalized)


def _measurement(model: dict[str, Any]) -> dict[str, Any]:
    value = model.get("measurement")
    assert isinstance(value, dict)
    if value.get("terminal") is not True:
        _fail(
            code="EDITOR_DIGITAL_TERMINAL_MEASUREMENT_REQUIRED",
            message="A runnable Digital editor document requires terminal measurement.",
            object_path="editor_model.measurement.terminal",
            suggestion="Enable terminal measurement before generating code.",
        )
    return value


def _generate_source(
    *,
    qubits: tuple[str, ...],
    gates: tuple[dict[str, Any], ...],
    measurement_key: str,
    program_id: str,
) -> str:
    lines = [
        "from cascaqit import Circuit",
        "",
        "circuit = Circuit("
        f"{_literal(list(qubits))}, program_id={_literal(program_id)})",
    ]
    for gate in gates:
        parameters = gate["parameters"]
        arguments = [*(_literal(target) for target in gate["targets"])]
        if parameters:
            lines.append(
                "circuit.append("
                f"{_literal(gate['gate'])}, {_literal(list(gate['targets']))}, "
                f"parameters={_literal(parameters)})"
            )
        else:
            lines.append(f"circuit.{gate['gate']}({', '.join(arguments)})")
    lines.extend(
        [
            f"circuit.measure_all(key={_literal(measurement_key)})",
            "program = circuit.to_program()",
            "",
        ]
    )
    return "\n".join(lines)


def _literal(value: object) -> str:
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(", ", ": "))


def _program_id(document_id: str) -> str:
    suffix = document_id.removeprefix("document.")
    return f"program.{suffix}"


def _fail_from_cascaqit(exc: CASCAQitError, gate_index: int | None = None) -> NoReturn:
    diagnostic = exc.to_diagnostic()
    _fail(
        code=diagnostic.code,
        message=diagnostic.message,
        object_path=(
            diagnostic.object_path or "editor_model"
            if gate_index is None
            else f"editor_model.gates[{gate_index}]"
        ),
        suggestion=diagnostic.suggestion,
    )


def _fail(
    *,
    code: str,
    message: str,
    object_path: str,
    suggestion: str | None,
) -> NoReturn:
    raise DigitalCompileError(
        (
            DiagnosticsIR(
                diagnostic_id=f"diagnostic.jupyter.{code.lower()}",
                stage="validation",
                severity="error",
                code=code,
                message=message,
                object_path=object_path,
                suggestion=suggestion,
            ),
        )
    )
