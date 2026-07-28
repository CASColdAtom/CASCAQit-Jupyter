"""Public entry points for the CASCAQit Jupyter kernel companion."""

from __future__ import annotations

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
    "DIAGNOSTICS_MIME",
    "PROGRAM_MIME",
    "RESULT_MIME",
    "VISUALIZATION_MIME",
    "display_diagnostics",
    "display_program",
    "display_result",
    "display_visualization",
]

__version__ = "0.1.0a1"


def _jupyter_labextension_paths() -> list[dict[str, str]]:
    """Return the bundled prebuilt extension location for Jupyter discovery."""
    return [{"src": "labextension", "dest": "@cascaqit/jupyter"}]
