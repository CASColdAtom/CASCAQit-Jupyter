"""Optional code-server integration behind Jupyter's authenticated proxy."""

from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Any

_workspace_root: str | None = None


def configure_workspace(root: str) -> None:
    global _workspace_root
    _workspace_root = str(Path(root).resolve())


def code_binary() -> str | None:
    configured = os.environ.get("CASCAQIT_CODE_SERVER")
    return shutil.which(configured or "code-server")


def code_command(port: int) -> list[str]:
    binary = code_binary()
    if binary is None:
        raise RuntimeError(
            "Install code-server and add it to PATH or set CASCAQIT_CODE_SERVER, "
            "then restart JupyterLab."
        )
    root = _workspace_root or os.getcwd()
    # Isolate IDE state from the user's desktop VS Code configuration.
    state = Path(os.environ.get("CASCAQIT_IDE_STATE", ".cascaqit-ide"))
    if not state.is_absolute():
        state = Path(root) / state
    return [
        binary,
        "--bind-addr",
        f"127.0.0.1:{port}",
        "--auth",
        "none",
        "--config",
        str(state / "config.yaml"),
        "--disable-telemetry",
        "--disable-update-check",
        "--user-data-dir",
        str(state / "data"),
        "--extensions-dir",
        str(state / "extensions"),
        root,
    ]


def setup_code_server() -> dict[str, Any]:
    return {
        "command": code_command,
        "timeout": 60,
        "launcher_entry": {"title": "CASCAQit Code", "enabled": False},
    }
