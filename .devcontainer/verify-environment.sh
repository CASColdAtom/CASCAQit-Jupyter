#!/usr/bin/env bash
set -euo pipefail

extension_output="$(jupyter labextension list 2>&1)"
printf '%s\n' "${extension_output}"
printf '%s\n' "${extension_output}" | grep -F "@cascaqit/jupyter" >/dev/null
printf '%s\n' "${extension_output}" | grep -F "enabled" >/dev/null
printf '%s\n' "${extension_output}" | grep -F "OK" >/dev/null

python - <<'PY'
from cascaqit import Circuit
from cascaqit_jupyter import PROGRAM_MIME, RESULT_MIME, display_program, display_result

circuit = Circuit(2, program_id="program.codespaces.smoke")
circuit.h(0).cx(0, 1).measure_all()
program = circuit.to_program()
result = circuit.run(shots=16, seed=2026, return_probabilities=True)

assert PROGRAM_MIME in display_program(program)._repr_mimebundle_()
assert RESULT_MIME in display_result(result)._repr_mimebundle_()
assert sum(result.counts.values()) == 16
print("CASCAQit Codespaces smoke test passed.")
PY
