"""Deterministic Analog editor compilation through public CASCAQit APIs."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, replace
from typing import Any, NoReturn

from cascaqit import AHSProgram, AtomRegister, MockNeutralAtomTarget, Waveform
from cascaqit.diagnostics import DiagnosticsIR
from cascaqit.exceptions import CASCAQitError
from cascaqit.native_ir import ProgramIR

from cascaqit_jupyter.compile import build_cell_metadata, source_hash
from cascaqit_jupyter.editor_ir import EditorDocumentIR

TARGET_SHOTS = 100


@dataclass(frozen=True)
class AnalogCompileError(ValueError):
    """A bounded Analog editor failure with element-scoped diagnostics."""

    diagnostics: tuple[DiagnosticsIR, ...]

    def __str__(self) -> str:
        return self.diagnostics[0].message


@dataclass(frozen=True)
class AnalogCompileResult:
    """Compilation or Detached decision returned to a Notebook client."""

    document: EditorDocumentIR
    generated_source: str | None
    generated_source_hash: str | None
    program: ProgramIR | None
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
            "cell_metadata": self.cell_metadata,
            "detached": self.detached,
            "diagnostics": [item.to_dict() for item in self.diagnostics],
        }


def compile_analog_document(
    document: EditorDocumentIR,
    *,
    generated_cell_id: str | None = None,
    current_source: str | None = None,
) -> AnalogCompileResult:
    """Compile one Analog document or preserve a modified cell as Detached."""
    if document.program_kind != "analog":
        _fail(
            code="EDITOR_PROGRAM_KIND_UNSUPPORTED",
            message="Analog compilation requires an Analog editor document.",
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
        diagnostic = DiagnosticsIR(
            diagnostic_id="diagnostic.jupyter.generated_cell_detached",
            stage="validation",
            severity="warning",
            code="GENERATED_CELL_DETACHED",
            message="The generated cell was modified after its last editor sync.",
            object_path="generated_cell_id",
            suggestion="Keep the user source unchanged or create a new generated cell.",
        )
        return AnalogCompileResult(
            document=detached,
            generated_source=None,
            generated_source_hash=document.generated_source_hash,
            program=None,
            program_hash=document.source_program_hash,
            cell_metadata=build_cell_metadata(detached),
            detached=True,
            diagnostics=(diagnostic,),
        )

    model = document.editor_model
    sites = _sites(model)
    channels = {
        channel: _channel(model, channel)
        for channel in ("rabi", "detuning", "phase")
    }
    durations = {channel: values[0][-1] for channel, values in channels.items()}
    if not math.isclose(
        max(durations.values()), min(durations.values()), abs_tol=1e-12
    ):
        _fail(
            code="EDITOR_ANALOG_CHANNEL_DURATION_MISMATCH",
            message="Global Analog control channels must have the same duration.",
            object_path="editor_model.controls",
            suggestion="Adjust segment durations so every channel ends together.",
        )
    measurement = model.get("measurement")
    assert isinstance(measurement, dict)
    if measurement.get("enabled") is not True:
        _fail(
            code="EDITOR_ANALOG_MEASUREMENT_REQUIRED",
            message="A runnable Analog editor document requires terminal measurement.",
            object_path="editor_model.measurement.enabled",
            suggestion="Enable terminal measurement before generating code.",
        )

    program_id = _program_id(document.document_id)
    source = _generate_source(sites=sites, channels=channels, program_id=program_id)
    try:
        builder = _build_program(sites=sites, channels=channels, program_id=program_id)
        program = builder.to_ir()
        validation = builder.validate(MockNeutralAtomTarget.v0_1(), shots=TARGET_SHOTS)
    except CASCAQitError as exc:
        diagnostic = exc.to_diagnostic()
        raise AnalogCompileError((_map_diagnostic(diagnostic),)) from exc
    except (TypeError, ValueError) as exc:
        _fail(
            code="EDITOR_ANALOG_BUILDER_INVALID",
            message=f"CASCAQit rejected the Analog editor document: {exc}",
            object_path="editor_model",
            suggestion="Review the register and waveform values.",
        )

    diagnostics = tuple(_map_diagnostic(item) for item in validation.diagnostics)
    errors = tuple(item for item in diagnostics if item.severity == "error")
    if errors:
        raise AnalogCompileError(errors)

    generated_hash = source_hash(source)
    program_hash = program.stable_hash()
    compiled = replace(
        document,
        compile_status="ready",
        generated_source_hash=generated_hash,
        generated_cell_id=generated_cell_id,
        source_program_hash=program_hash,
    )
    return AnalogCompileResult(
        document=compiled,
        generated_source=source,
        generated_source_hash=generated_hash,
        program=program,
        program_hash=program_hash,
        cell_metadata=build_cell_metadata(compiled),
        detached=False,
        diagnostics=diagnostics,
    )


def _sites(model: dict[str, Any]) -> tuple[dict[str, Any], ...]:
    register = model.get("register")
    assert isinstance(register, dict)
    values = register.get("sites")
    assert isinstance(values, list)
    normalized = tuple(dict(item) for item in values)
    ids = tuple(str(item["id"]) for item in normalized)
    if len(set(ids)) != len(ids):
        _fail(
            code="EDITOR_ANALOG_SITE_ID_DUPLICATE",
            message="Analog register site IDs must be unique.",
            object_path="editor_model.register.sites",
            suggestion="Rename or remove the duplicate site.",
        )
    if not any(item["occupied"] is True for item in normalized):
        _fail(
            code="EDITOR_ANALOG_REGISTER_EMPTY",
            message="The Analog register must contain at least one occupied site.",
            object_path="editor_model.register.sites",
            suggestion="Mark at least one register site as occupied.",
        )
    for index, item in enumerate(normalized):
        if not all(math.isfinite(float(item[key])) for key in ("x", "y")):
            _fail(
                code="EDITOR_ANALOG_SITE_POSITION_NONFINITE",
                message="Analog register coordinates must be finite.",
                object_path=f"editor_model.register.sites[{index}]",
                suggestion="Enter finite x and y coordinates in micrometers.",
            )
    return normalized


def _channel(
    model: dict[str, Any], channel: str
) -> tuple[tuple[float, ...], tuple[float, ...]]:
    controls = model.get("controls")
    assert isinstance(controls, dict)
    value = controls.get(channel)
    assert isinstance(value, dict)
    segments = value.get("segments")
    assert isinstance(segments, list)
    if not segments:
        _fail(
            code="EDITOR_ANALOG_CHANNEL_EMPTY",
            message=f"The global {channel} channel requires at least one segment.",
            object_path=f"editor_model.controls.{channel}.segments",
            suggestion="Add a positive-duration waveform segment.",
        )
    ids = tuple(str(item["id"]) for item in segments)
    if len(set(ids)) != len(ids):
        _fail(
            code="EDITOR_ANALOG_SEGMENT_ID_DUPLICATE",
            message=f"The global {channel} segment IDs must be unique.",
            object_path=f"editor_model.controls.{channel}.segments",
            suggestion="Assign each waveform segment a unique ID.",
        )
    times = [0.0]
    values = [float(segments[0]["start_value"])]
    previous_end = values[0]
    for index, item in enumerate(segments):
        duration = float(item["duration"])
        start = float(item["start_value"])
        end = float(item["end_value"])
        if not all(math.isfinite(number) for number in (duration, start, end)):
            _fail(
                code="EDITOR_ANALOG_SEGMENT_NONFINITE",
                message=f"The global {channel} segment values must be finite.",
                object_path=f"editor_model.controls.{channel}.segments[{index}]",
                suggestion="Enter finite duration, start, and end values.",
            )
        if index > 0 and not math.isclose(start, previous_end, abs_tol=1e-12):
            _fail(
                code="EDITOR_ANALOG_SEGMENT_DISCONTINUITY",
                message=f"The global {channel} waveform segments must be continuous.",
                object_path=f"editor_model.controls.{channel}.segments[{index}]",
                suggestion="Match this segment start to the previous segment end.",
            )
        times.append(times[-1] + duration)
        values.append(end)
        previous_end = end
    return tuple(times), tuple(values)


def _build_program(
    *,
    sites: tuple[dict[str, Any], ...],
    channels: dict[str, tuple[tuple[float, ...], tuple[float, ...]]],
    program_id: str,
) -> AHSProgram:
    site_ids = tuple(str(item["id"]) for item in sites)
    register = AtomRegister.custom(
        tuple((float(item["x"]), float(item["y"])) for item in sites),
        site_ids=site_ids,
        atom_ids=site_ids,
    )
    for index, site in enumerate(sites):
        if site["occupied"] is not True:
            register = register.with_site_status(
                str(site["id"]),
                status="vacant",
                lifecycle_stage="planned",
                snapshot_id=f"register.editor.vacant.{index}",
            )
    waveforms = {
        channel: Waveform.piecewise_linear(
            times=times,
            values=values,
            waveform_id=channel,
            value_unit="rad" if channel == "phase" else "rad/us",
        )
        for channel, (times, values) in channels.items()
    }
    return (
        AHSProgram(register, program_id=program_id)
        .drive(
            rabi=waveforms["rabi"],
            detuning=waveforms["detuning"],
            phase=waveforms["phase"],
        )
        .measure()
    )


def _generate_source(
    *,
    sites: tuple[dict[str, Any], ...],
    channels: dict[str, tuple[tuple[float, ...], tuple[float, ...]]],
    program_id: str,
) -> str:
    site_ids = [str(item["id"]) for item in sites]
    positions = [[float(item["x"]), float(item["y"])] for item in sites]
    lines = [
        (
            "from cascaqit import AHSProgram, AtomRegister, "
            "MockNeutralAtomTarget, Waveform"
        ),
        "",
        "register = AtomRegister.custom(",
        f"    {_position_literal(positions)},",
        f"    site_ids={_literal(site_ids)},",
        f"    atom_ids={_literal(site_ids)},",
        ")",
    ]
    for index, site in enumerate(sites):
        if site["occupied"] is not True:
            lines.extend(
                [
                    "register = register.with_site_status(",
                    f"    {_literal(site['id'])}, status=\"vacant\",",
                    "    lifecycle_stage=\"planned\",",
                    f"    snapshot_id=\"register.editor.vacant.{index}\",",
                    ")",
                ]
            )
    lines.append("")
    for channel, (times, values) in channels.items():
        lines.extend(
            [
                f"{channel} = Waveform.piecewise_linear(",
                f"    times={_literal(list(times))},",
                f"    values={_literal(list(values))},",
                f"    waveform_id={_literal(channel)},",
                (
                    "    value_unit="
                    f"{_literal('rad' if channel == 'phase' else 'rad/us')},"
                ),
                ")",
            ]
        )
    lines.extend(
        [
            "",
            f"builder = AHSProgram(register, program_id={_literal(program_id)})",
            "builder.drive(rabi=rabi, detuning=detuning, phase=phase).measure()",
            "program = builder.to_ir()",
            "validation = builder.validate(MockNeutralAtomTarget.v0_1(), shots=100)",
            "",
        ]
    )
    return "\n".join(lines)


def _map_diagnostic(diagnostic: DiagnosticsIR) -> DiagnosticsIR:
    path = diagnostic.object_path
    if path is not None:
        mappings = (
            ("register", "editor_model.register"),
            ("hamiltonian.terms.rabi", "editor_model.controls.rabi"),
            ("hamiltonian.terms.detuning", "editor_model.controls.detuning"),
            ("hamiltonian.terms.phase", "editor_model.controls.phase"),
            ("measurements", "editor_model.measurement"),
        )
        for source, target in mappings:
            if path.startswith(source):
                path = target + path[len(source) :]
                break
    return DiagnosticsIR(
        diagnostic_id=diagnostic.diagnostic_id,
        stage=diagnostic.stage,
        severity=diagnostic.severity,
        code=diagnostic.code,
        message=diagnostic.message,
        schema_version=diagnostic.schema_version,
        object_path=path,
        suggestion=diagnostic.suggestion,
        metadata=dict(diagnostic.metadata),
    )


def _literal(value: object) -> str:
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(", ", ": "))


def _position_literal(positions: list[list[float]]) -> str:
    values = ", ".join(f"({x!r}, {y!r})" for x, y in positions)
    suffix = "," if len(positions) == 1 else ""
    return f"({values}{suffix})"


def _program_id(document_id: str) -> str:
    return f"program.{document_id.removeprefix('document.')}"


def _fail(
    *, code: str, message: str, object_path: str, suggestion: str | None
) -> NoReturn:
    raise AnalogCompileError(
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
