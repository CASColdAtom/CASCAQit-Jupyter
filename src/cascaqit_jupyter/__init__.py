"""Public entry points for the CASCAQit Jupyter kernel companion."""

from __future__ import annotations

from cascaqit_jupyter.analog_compile import (
    AnalogCompileError,
    AnalogCompileResult,
    compile_analog_document,
)
from cascaqit_jupyter.comm import COMM_TARGET, KernelSession, register_kernel_comm
from cascaqit_jupyter.compile import (
    CELL_METADATA_KEY,
    DigitalCompileError,
    DigitalCompileResult,
    build_cell_metadata,
    compile_digital_document,
    source_hash,
)
from cascaqit_jupyter.editor_ir import EditorDocumentIR
from cascaqit_jupyter.mime import (
    DIAGNOSTICS_MIME,
    PROGRAM_MIME,
    RESULT_MIME,
    VISUALIZATION_MIME,
    CASCAQitDisplay,
    display_diagnostics,
    display_program,
    display_result,
    display_visualization,
)

__all__ = [
    "CASCAQitDisplay",
    "CELL_METADATA_KEY",
    "COMM_TARGET",
    "DIAGNOSTICS_MIME",
    "PROGRAM_MIME",
    "RESULT_MIME",
    "VISUALIZATION_MIME",
    "EditorDocumentIR",
    "AnalogCompileError",
    "AnalogCompileResult",
    "DigitalCompileError",
    "DigitalCompileResult",
    "KernelSession",
    "display_diagnostics",
    "display_program",
    "display_result",
    "display_visualization",
    "build_cell_metadata",
    "compile_digital_document",
    "compile_analog_document",
    "register_kernel_comm",
    "source_hash",
]

__version__ = "0.1.0a1"


def _jupyter_labextension_paths() -> list[dict[str, str]]:
    """Return the bundled prebuilt extension location for Jupyter discovery."""
    return [{"src": "labextension", "dest": "@cascaqit/jupyter"}]
