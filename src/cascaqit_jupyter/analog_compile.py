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
DERIVED_DECIMAL_PLACES = 6


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


@dataclass(frozen=True)
class _RegisterFactory:
    """One public AtomRegister shape call that reproduces editor coordinates."""

    shape: str
    count: int
    rows: int
    columns: int
    spacing_x: float
    spacing_y: float
    origin: tuple[float, float]


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
    register_factory = _register_factory(model, sites)
    channels = {
        channel: _channel(model, channel) for channel in ("rabi", "detuning", "phase")
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
    source = _generate_source(
        sites=sites,
        channels=channels,
        program_id=program_id,
        register_factory=register_factory,
    )
    try:
        builder = _build_program(
            sites=sites,
            channels=channels,
            program_id=program_id,
            register_factory=register_factory,
        )
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
        times.append(_round_derived(times[-1] + duration))
        values.append(end)
        previous_end = end
    return tuple(times), tuple(values)


def _build_program(
    *,
    sites: tuple[dict[str, Any], ...],
    channels: dict[str, tuple[tuple[float, ...], tuple[float, ...]]],
    program_id: str,
    register_factory: _RegisterFactory | None,
) -> AHSProgram:
    site_ids = tuple(str(item["id"]) for item in sites)
    positions = tuple((float(item["x"]), float(item["y"])) for item in sites)
    if register_factory is not None:
        shaped = _build_shape_register(register_factory)
        positions = tuple(
            (_round_derived(site.position[0]), _round_derived(site.position[1]))
            for site in shaped.sites[: len(sites)]
        )
    register = AtomRegister.custom(
        positions,
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
    register_factory: _RegisterFactory | None,
) -> str:
    site_ids = [str(item["id"]) for item in sites]
    positions = [[float(item["x"]), float(item["y"])] for item in sites]
    lines = [
        (
            "from cascaqit import AHSProgram, AtomRegister, "
            "MockNeutralAtomTarget, Waveform"
        ),
        "",
    ]
    if register_factory is None:
        lines.extend(
            [
                "register = AtomRegister.custom(",
                f"    {_position_literal(positions)},",
            ]
        )
    else:
        lines.extend(_shape_register_source(register_factory))
        lines.extend(
            [
                "layout_positions = tuple(",
                (
                    f"    (round(site.position[0], {DERIVED_DECIMAL_PLACES}), "
                    f"round(site.position[1], {DERIVED_DECIMAL_PLACES}))"
                ),
                f"    for site in layout_register.sites[:{len(sites)}]",
                ")",
                "register = AtomRegister.custom(",
                "    layout_positions,",
            ]
        )
    lines.extend(
        [
            f"    site_ids={_literal(site_ids)},",
            f"    atom_ids={_literal(site_ids)},",
            ")",
        ]
    )
    for index, site in enumerate(sites):
        if site["occupied"] is not True:
            lines.extend(
                [
                    "register = register.with_site_status(",
                    f'    {_literal(site["id"])}, status="vacant",',
                    '    lifecycle_stage="planned",',
                    f'    snapshot_id="register.editor.vacant.{index}",',
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


def _register_factory(
    model: dict[str, Any], sites: tuple[dict[str, Any], ...]
) -> _RegisterFactory | None:
    register = model.get("register")
    assert isinstance(register, dict)
    layout = register.get("layout_tool")
    if not isinstance(layout, dict):
        return None
    shape = layout.get("shape")
    if shape not in ("line", "square", "rectangle", "triangle"):
        return None
    count = len(sites)
    factory = _RegisterFactory(
        shape=str(shape),
        count=count,
        rows=int(layout["rows"]),
        columns=int(layout["columns"]),
        spacing_x=float(layout["spacing_x"]),
        spacing_y=float(layout["spacing_y"]),
        origin=(float(sites[0]["x"]), float(sites[0]["y"])),
    )
    shaped = _build_shape_register(factory)
    if len(shaped.sites) < count:
        return None
    for source, generated in zip(sites, shaped.sites):
        expected = (float(source["x"]), float(source["y"]))
        if not all(
            math.isclose(actual, target, rel_tol=0.0, abs_tol=1e-6)
            for actual, target in zip(generated.position, expected)
        ):
            return None
    return factory


def _build_shape_register(factory: _RegisterFactory) -> AtomRegister:
    if factory.shape == "line":
        return AtomRegister.line(
            count=factory.count,
            spacing=factory.spacing_x,
            origin=factory.origin,
        )
    if factory.shape == "square":
        return AtomRegister.square(
            side=factory.columns,
            spacing=factory.spacing_x,
            origin=factory.origin,
        )
    if factory.shape == "rectangle":
        return AtomRegister.rectangular(
            rows=factory.rows,
            columns=factory.columns,
            spacing_x=factory.spacing_x,
            spacing_y=factory.spacing_y,
            origin=factory.origin,
        )
    if factory.shape == "triangle":
        return AtomRegister.triangular(
            rows=factory.rows,
            spacing=factory.spacing_x,
            origin=factory.origin,
        )
    raise ValueError(f"Unsupported AtomRegister factory shape: {factory.shape!r}.")


def _shape_register_source(factory: _RegisterFactory) -> list[str]:
    origin = f"({factory.origin[0]!r}, {factory.origin[1]!r})"
    if factory.shape == "line":
        arguments = [
            f"    count={factory.count},",
            f"    spacing={factory.spacing_x!r},",
        ]
        method = "line"
    elif factory.shape == "square":
        arguments = [
            f"    side={factory.columns},",
            f"    spacing={factory.spacing_x!r},",
        ]
        method = "square"
    elif factory.shape == "rectangle":
        arguments = [
            f"    rows={factory.rows},",
            f"    columns={factory.columns},",
            f"    spacing_x={factory.spacing_x!r},",
            f"    spacing_y={factory.spacing_y!r},",
        ]
        method = "rectangular"
    elif factory.shape == "triangle":
        arguments = [
            f"    rows={factory.rows},",
            f"    spacing={factory.spacing_x!r},",
        ]
        method = "triangular"
    else:
        raise ValueError(f"Unsupported AtomRegister factory shape: {factory.shape!r}.")
    return [
        f"layout_register = AtomRegister.{method}(",
        *arguments,
        f"    origin={origin},",
        ")",
    ]


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


def _round_derived(value: float) -> float:
    rounded = round(value, DERIVED_DECIMAL_PLACES)
    return 0.0 if rounded == 0 else rounded


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
