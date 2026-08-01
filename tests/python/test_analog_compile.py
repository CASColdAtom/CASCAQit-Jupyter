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
    assert "times=[0.0, 0.4, 0.8, 1.2]" in first.generated_source
    assert "1.2000000000000002" not in first.generated_source


@pytest.mark.parametrize(
    ("shape", "method", "layout_update", "positions"),
    [
        ("line", "line", {}, ((0.0, 0.0), (5.0, 0.0))),
        (
            "square",
            "square",
            {"rows": 2, "columns": 2},
            ((0.0, 0.0), (5.0, 0.0), (0.0, 5.0), (5.0, 5.0)),
        ),
        (
            "rectangle",
            "rectangular",
            {"rows": 2, "columns": 3, "spacing_y": 6.0},
            ((0.0, 0.0), (5.0, 0.0), (10.0, 0.0), (0.0, 6.0)),
        ),
        (
            "triangle",
            "triangular",
            {"rows": 3, "columns": 3},
            (
                (0.0, 0.0),
                (0.0, 4.330127),
                (5.0, 4.330127),
                (0.0, 8.660254),
                (5.0, 8.660254),
                (10.0, 8.660254),
            ),
        ),
    ],
)
def test_fixed_layouts_compile_through_public_atom_register_factories(
    shape: str,
    method: str,
    layout_update: dict[str, Any],
    positions: tuple[tuple[float, float], ...],
) -> None:
    raw = analog_document()
    raw["editor_model"]["register"]["sites"] = [
        {"id": f"s{index}", "x": x, "y": y, "occupied": True}
        for index, (x, y) in enumerate(positions)
    ]
    layout = {
        "shape": shape,
        "atom_count": len(positions),
        "rows": 1,
        "columns": len(positions),
        "spacing_x": 5.0,
        "spacing_y": 5.0,
        "radius": 8.0,
        "rings": 1,
        "center_x": 0.0,
        "center_y": 0.0,
        **layout_update,
    }
    raw["editor_model"]["register"]["layout_tool"] = layout

    result = compile_analog_document(EditorDocumentIR.from_dict(raw))

    assert result.generated_source is not None
    assert f"AtomRegister.{method}(" in result.generated_source
    assert "layout_positions = tuple(" in result.generated_source
    assert result.program is not None
    assert [site.site_id for site in result.program.register.sites] == [
        f"s{index}" for index in range(len(positions))
    ]
    assert [site.position for site in result.program.register.sites] == list(positions)
    namespace: dict[str, Any] = {}
    exec(result.generated_source, namespace)  # noqa: S102 - generated source contract
    assert namespace["program"].stable_hash() == result.program_hash


def test_mismatched_layout_metadata_falls_back_to_explicit_coordinates() -> None:
    raw = analog_document()
    raw["editor_model"]["register"]["layout_tool"] = {
        "shape": "line",
        "atom_count": 2,
        "rows": 1,
        "columns": 2,
        "spacing_x": 6.0,
        "spacing_y": 5.0,
        "radius": 8.0,
        "rings": 1,
        "center_x": 2.5,
        "center_y": 0.0,
    }

    result = compile_analog_document(EditorDocumentIR.from_dict(raw))

    assert result.generated_source is not None
    assert "AtomRegister.line(" not in result.generated_source
    assert "register = AtomRegister.custom(" in result.generated_source


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
            lambda raw: raw["editor_model"]["measurement"].update({"enabled": False}),
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
