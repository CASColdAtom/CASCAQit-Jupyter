"""Versioned JSON MIME bundles derived from public CASCAQit contracts."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any, Union

from cascaqit.diagnostics import DiagnosticsIR
from cascaqit.digital import DigitalProgramIR
from cascaqit.hybrid import HybridProgramIR
from cascaqit.native_ir import ProgramIR
from cascaqit.results import ResultIR
from cascaqit.visualization import (
    CountsHistogramVisualizationIR,
    HybridTimelineVisualizationIR,
    PulseTimelineVisualizationIR,
    RegisterVisualizationIR,
)

PROGRAM_MIME = "application/vnd.cascaqit.program+json"
RESULT_MIME = "application/vnd.cascaqit.result+json"
DIAGNOSTICS_MIME = "application/vnd.cascaqit.diagnostics+json"
VISUALIZATION_MIME = "application/vnd.cascaqit.visualization+json"
PROTOCOL_VERSION = "1.0"

ProgramLike = Union[ProgramIR, DigitalProgramIR, HybridProgramIR]
VisualizationLike = Union[
    RegisterVisualizationIR,
    PulseTimelineVisualizationIR,
    CountsHistogramVisualizationIR,
    HybridTimelineVisualizationIR,
]


@dataclass(frozen=True)
class CASCAQitDisplay:
    """A safe IPython display object carrying JSON plus a text fallback."""

    mime_type: str
    payload: dict[str, Any]
    text: str

    def _repr_mimebundle_(
        self,
        include: set[str] | None = None,
        exclude: set[str] | None = None,
    ) -> dict[str, object]:
        """Return an IPython-compatible MIME bundle without executable content."""
        bundle: dict[str, object] = {
            self.mime_type: self.payload,
            "text/plain": self.text,
        }
        if include is not None:
            bundle = {key: value for key, value in bundle.items() if key in include}
        if exclude is not None:
            bundle = {key: value for key, value in bundle.items() if key not in exclude}
        return bundle


def display_program(program: ProgramLike) -> CASCAQitDisplay:
    """Build a display bundle for a public Digital, Analog, or Hybrid program IR."""
    if not isinstance(program, (ProgramIR, DigitalProgramIR, HybridProgramIR)):
        raise TypeError("program must be a public CASCAQit program IR.")
    data = program.to_dict()
    source_id = str(data["program_id"])
    return _display(
        mime_type=PROGRAM_MIME,
        kind="program",
        source_id=source_id,
        source_hash=program.stable_hash(),
        data=data,
    )


def display_result(result: ResultIR) -> CASCAQitDisplay:
    """Build a display bundle for a public CASCAQit result IR."""
    if not isinstance(result, ResultIR):
        raise TypeError("result must be a CASCAQit ResultIR.")
    return _display(
        mime_type=RESULT_MIME,
        kind="result",
        source_id=result.result_id,
        source_hash=result.stable_hash(),
        data=result.to_dict(),
    )


def display_diagnostics(
    diagnostics: DiagnosticsIR | tuple[DiagnosticsIR, ...] | list[DiagnosticsIR],
    *,
    source_id: str = "diagnostics",
) -> CASCAQitDisplay:
    """Build one display bundle while preserving all structured diagnostics."""
    items = (diagnostics,) if isinstance(diagnostics, DiagnosticsIR) else diagnostics
    if not isinstance(items, (tuple, list)) or not all(
        isinstance(item, DiagnosticsIR) for item in items
    ):
        raise TypeError("diagnostics must contain only CASCAQit DiagnosticsIR values.")
    if not isinstance(source_id, str) or not source_id.strip():
        raise ValueError("source_id must be a non-empty string.")
    data = {"items": [item.to_dict() for item in items]}
    return _display(
        mime_type=DIAGNOSTICS_MIME,
        kind="diagnostics",
        source_id=source_id,
        source_hash=_stable_hash(data),
        data=data,
    )


def display_visualization(visualization: VisualizationLike) -> CASCAQitDisplay:
    """Build a display bundle from public, data-only Visualization IR."""
    supported = (
        RegisterVisualizationIR,
        PulseTimelineVisualizationIR,
        CountsHistogramVisualizationIR,
        HybridTimelineVisualizationIR,
    )
    if not isinstance(visualization, supported):
        raise TypeError("visualization must be a public CASCAQit Visualization IR.")
    data = visualization.to_dict()
    source_id = str(data["spec"]["visualization_id"])
    return _display(
        mime_type=VISUALIZATION_MIME,
        kind="visualization",
        source_id=source_id,
        source_hash=visualization.stable_hash(),
        data=data,
    )


def _display(
    *,
    mime_type: str,
    kind: str,
    source_id: str,
    source_hash: str,
    data: dict[str, Any],
) -> CASCAQitDisplay:
    payload = {
        "protocol_version": PROTOCOL_VERSION,
        "kind": kind,
        "source": {"id": source_id, "hash": source_hash},
        "cascaqit_schema_version": data.get("schema_version"),
        "data": data,
    }
    return CASCAQitDisplay(
        mime_type=mime_type,
        payload=payload,
        text=f"CASCAQit {kind}: {source_id} [{source_hash[:12]}]",
    )


def _stable_hash(value: object) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()
