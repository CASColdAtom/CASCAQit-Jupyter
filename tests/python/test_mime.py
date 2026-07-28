from __future__ import annotations

import json

import pytest
from cascaqit import Circuit, build_counts_histogram
from cascaqit.diagnostics import DiagnosticsIR

from cascaqit_jupyter import (
    DIAGNOSTICS_MIME,
    PROGRAM_MIME,
    RESULT_MIME,
    VISUALIZATION_MIME,
    display_diagnostics,
    display_program,
    display_result,
    display_visualization,
)


@pytest.fixture
def bell_circuit() -> Circuit:
    circuit = Circuit(2, program_id="program.test.jupyter.bell")
    circuit.h(0).cx(0, 1).measure_all()
    return circuit


def test_public_program_contract_produces_versioned_json(bell_circuit: Circuit) -> None:
    program = bell_circuit.to_program()

    display = display_program(program)
    bundle = display._repr_mimebundle_()
    payload = bundle[PROGRAM_MIME]

    assert isinstance(payload, dict)
    assert payload["protocol_version"] == "1.0"
    assert payload["kind"] == "program"
    assert payload["source"] == {
        "id": program.program_id,
        "hash": program.stable_hash(),
    }
    assert payload["data"] == program.to_dict()
    json.dumps(payload)
    assert "text/html" not in bundle
    assert "application/javascript" not in bundle


def test_result_and_visualization_preserve_source_identity(
    bell_circuit: Circuit,
) -> None:
    result = bell_circuit.run(shots=16, seed=2026, return_probabilities=True)
    histogram = build_counts_histogram(result)

    result_payload = display_result(result)._repr_mimebundle_()[RESULT_MIME]
    visualization_payload = display_visualization(
        histogram
    )._repr_mimebundle_()[VISUALIZATION_MIME]

    assert isinstance(result_payload, dict)
    assert result_payload["source"]["id"] == result.result_id
    assert result_payload["data"]["program_hash"] == result.program_hash
    assert sum(result_payload["data"]["counts"].values()) == 16
    assert isinstance(visualization_payload, dict)
    assert visualization_payload["source"]["id"] == histogram.spec.visualization_id
    assert visualization_payload["data"] == histogram.to_dict()


def test_diagnostics_keep_machine_fields_and_filter_mime_bundle() -> None:
    diagnostic = DiagnosticsIR(
        diagnostic_id="diagnostic.test",
        stage="validation",
        severity="error",
        code="TEST_INVALID",
        message="The test program is invalid.",
        object_path="circuit.gates[0]",
        suggestion="Replace the unsupported gate.",
    )

    display = display_diagnostics((diagnostic,), source_id="program.test")
    payload = display._repr_mimebundle_(include={DIAGNOSTICS_MIME})[
        DIAGNOSTICS_MIME
    ]

    assert isinstance(payload, dict)
    assert payload["data"]["items"][0]["code"] == "TEST_INVALID"
    assert payload["data"]["items"][0]["object_path"] == "circuit.gates[0]"
    assert payload["data"]["items"][0]["suggestion"]
    assert "text/plain" not in display._repr_mimebundle_(exclude={"text/plain"})


def test_display_rejects_non_contract_values() -> None:
    with pytest.raises(TypeError, match="public CASCAQit program IR"):
        display_program(object())  # type: ignore[arg-type]
    with pytest.raises(TypeError, match="DiagnosticsIR"):
        display_diagnostics([object()])  # type: ignore[list-item]
    with pytest.raises(ValueError, match="non-empty"):
        display_diagnostics([], source_id="")
