# CASCAQit Jupyter

CASCAQit-Jupyter is the JupyterLab 4 and Notebook 7 integration for the CASCAQit neutral-atom quantum programming SDK. The current source preview contains an installable Python kernel companion, visual Digital and Analog editors, and safe MIME renderers for public CASCAQit Program, Result, Diagnostics, and Visualization IR objects.

Install a released CASCAQit `>=1.0.5a,<1.1` wheel first, then install this source checkout and verify that Jupyter can discover the extension:

```console
npm ci
python -m pip install ".[lab,test]"
jupyter labextension list
```

`@cascaqit/jupyter` should be listed as `enabled` and `OK`. Display a deterministic local Digital program and result from the current kernel with:

```python
from cascaqit import Circuit, build_counts_histogram
from cascaqit_jupyter import display_program, display_result, display_visualization
from IPython.display import display

circuit = Circuit(2, program_id="program.notebook.bell")
circuit.h(0).cx(0, 1).measure_all()
program = circuit.to_program()
result = circuit.run(shots=32, seed=2026, return_probabilities=True)

display(display_program(program))
display(display_result(result))
display(display_visualization(build_counts_histogram(result)))
```

To build a Digital circuit visually, open a Notebook with a running Python kernel and choose **Digital** in the Notebook toolbar. The same editor is available from the Command Palette as `CASCAQit: Open Digital Editor` and with `Alt+Shift+Q` while the Notebook has focus. Add or rename qubits, compose and reorder gates, set the terminal measurement, then choose **Generate cell**. The editor compiles through the kernel companion and writes deterministic, ordinary CASCAQit Python into a code cell.

After generation, choose **Run** in **Local execution** to execute through the public CASCAQit `LocalBackend` in the current kernel. Shots and seed are explicit inputs. The editor displays queued/running/terminal state, cooperative cancellation, diagnostics, and the Result inline. Run recompiles the editor document and verifies the exact generated source hash first; modified generated Python is rejected as `Detached` and remains untouched.

The generated cell stores a versioned editor document and exact source hash in Notebook metadata. Saving and reopening the Notebook restores the visual document. If the generated Python has been edited since the last synchronization, **Update cell** enters the explicit `Detached` state and preserves the user source instead of overwriting it. Open [`examples/digital_editor.ipynb`](examples/digital_editor.ipynb) for a small editor-ready Notebook.

To build an Analog program, choose **Analog** in the Notebook toolbar, run `CASCAQit: Open Analog Editor` from the Command Palette, or press `Alt+Shift+A`. Edit atom site IDs, coordinates and occupancy; compose the global Rabi, detuning and phase segments; then enable terminal measurement and choose **Generate cell**. Compilation uses the released `AtomRegister`, `Waveform`, `AHSProgram`, and offline `MockNeutralAtomTarget` public APIs. Validation failures retain their CASCAQit diagnostic code, path and suggestion and mark the matching register, waveform, or measurement control. The generated cell remains ordinary Python and is never executed implicitly. Analog local execution additionally exposes the simulation time-step count. Open [`examples/analog_editor.ipynb`](examples/analog_editor.ipynb) for an editor-ready two-site program.

The renderer currently provides:

- Digital circuit wires, gates, controls, targets, and terminal measurements.
- Analog atom-register and global Rabi, detuning, and phase views.
- Result counts, probabilities, observables, seed, Result/program identity, target, explicit bit ordering, execution boundary, simulation resource estimate/usage, and execution diagnostics.
- Counts histogram, register, pulse timeline, and plan-only Hybrid timeline Visualization IR views.
- Non-color diagnostic severity labels with code, object path, message, and suggestion fields.

Open [`examples/read_only_renderers.ipynb`](examples/read_only_renderers.ipynb) to inspect every current view with deterministic local data. The renderer creates controlled DOM and SVG elements from versioned JSON payloads; dynamic values are assigned through `textContent`, so HTML or JavaScript carried in a diagnostic is displayed as text rather than executed.

The Digital editor currently supports `H`, `X`, `Y`, `Z`, `RX`, `RY`, `RZ`, `CX`, `CZ`, and `SWAP`; rotation parameters must be numeric and terminal measurement is required before code generation. The Analog editor currently supports a two-dimensional global register, vacant sites, piecewise-linear global Rabi/detuning/phase controls, and terminal ground/Rydberg measurement. Its three channels must have equal duration and adjacent segments must be continuous. Neither editor parses arbitrary Python back into the canvas. Local Analog controls and OpenQASM import/export are not implemented.

Local execution is offline and kernel-owned; it is not a sandbox. Cancellation is cooperative and reports a request separately from the state observed from CASCAQit, so it does not promise immediate interruption of active numerical work. Notebook metadata persists the last Job and Result identity, options, status evidence, and execution boundary. Reopening a Notebook restores that historical identity, but a kernel restart invalidates the live Job registry and an inline Result payload is not reconstructed from metadata.

The implementation consumes released public CASCAQit APIs only. It does not import `cascaqit._internal`, depend on `cascaqit-compat`, copy simulator code, contact live hardware or CASCAQit Cloud, or depend on CASCAQit-Skills.
