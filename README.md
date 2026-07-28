# CASCAQit Jupyter

CASCAQit-Jupyter is the JupyterLab 4 and Notebook 7 integration for the CASCAQit neutral-atom quantum programming SDK. The current source preview contains an installable Python kernel companion and a prebuilt, data-only MIME renderer for public CASCAQit Program, Result, Diagnostics, and Visualization IR objects.

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

The renderer currently provides:

- Digital circuit wires, gates, controls, targets, and terminal measurements.
- Analog atom-register and global Rabi, detuning, and phase views.
- Result counts, shots, target identity, explicit bit ordering, and execution diagnostics.
- Counts histogram, register, pulse timeline, and plan-only Hybrid timeline Visualization IR views.
- Non-color diagnostic severity labels with code, object path, message, and suggestion fields.

Open [`examples/read_only_renderers.ipynb`](examples/read_only_renderers.ipynb) to inspect every current view with deterministic local data. The renderer creates controlled DOM and SVG elements from versioned JSON payloads; dynamic values are assigned through `textContent`, so HTML or JavaScript carried in a diagnostic is displayed as text rather than executed.

This preview is read-only. Versioned `EditorDocumentIR`, MIME, and low-level kernel comm contracts are available, including kernel-epoch, document-revision, timeout, and cooperative-cancel semantics, but the renderer does not open that comm automatically yet. Job execution controls, the Digital editor, the Analog register/waveform editor, save/reopen synchronization, and the `detached` conflict workflow are not implemented yet.

The implementation consumes released public CASCAQit APIs only. It does not import `cascaqit._internal`, depend on `cascaqit-compat`, copy simulator code, contact live hardware or CASCAQit Cloud, or depend on CASCAQit-Skills.
