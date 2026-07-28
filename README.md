# CASCAQit Jupyter

CASCAQit-Jupyter is the JupyterLab 4 and Notebook 7 integration for the CASCAQit neutral-atom quantum programming SDK. The current source preview contains an installable Python kernel companion and a prebuilt, data-only MIME renderer for public CASCAQit Program, Result, Diagnostics, and Visualization IR objects.

Install a released CASCAQit `>=1.0.5a,<1.1` wheel first, then install this source checkout and verify that Jupyter can discover the extension:

```console
npm ci
python -m pip install -e ".[lab,test]"
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

The renderer creates text-only DOM nodes from versioned JSON payloads; it does not execute HTML or JavaScript carried by a result. This preview is read-only. Versioned `EditorDocumentIR`, MIME, and low-level kernel comm contracts are available, including kernel-epoch, document-revision, timeout, and cooperative-cancel semantics, but the renderer does not open that comm automatically yet. Job execution controls, the Digital editor, the Analog register/waveform editor, save/reopen synchronization, and the `detached` conflict workflow are not implemented yet.

The implementation consumes released public CASCAQit APIs only. It does not import `cascaqit._internal`, depend on `cascaqit-compat`, copy simulator code, contact live hardware or CASCAQit Cloud, or depend on CASCAQit-Skills.
