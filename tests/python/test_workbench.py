from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from cascaqit import ResultIR

from cascaqit_jupyter.compile import source_hash
from cascaqit_jupyter.ide import code_command, configure_workspace
from cascaqit_jupyter.templates import create_template


@pytest.mark.parametrize("kind", ["digital", "analog"])
def test_templates_run_offline_and_restore_editable_source(kind: str) -> None:
    notebook = create_template(kind)
    other = create_template(kind)
    cell = notebook["cells"][1]
    doc = cell["metadata"]["cascaqit_jupyter"]["editor_document"]
    assert doc["generated_cell_id"] == cell["id"]
    assert doc["generated_source_hash"] == source_hash(cell["source"])
    assert (
        doc["document_id"]
        != (
            other["cells"][1]["metadata"]["cascaqit_jupyter"]["editor_document"][
                "document_id"
            ]
        )
    )
    namespace: dict[str, Any] = {}
    for entry in notebook["cells"]:
        if entry["cell_type"] == "code":
            exec(entry["source"], namespace)
    result = namespace["result"]
    assert isinstance(result, ResultIR)
    assert sum(result.counts.values()) == 128
    assert result.program_hash == namespace["program"].stable_hash()


def test_unknown_template_is_rejected() -> None:
    with pytest.raises(ValueError):
        create_template("remote-hardware")


def test_code_server_is_loopback_and_uses_server_root(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr("cascaqit_jupyter.ide.code_binary", lambda: "/bin/code-server")
    configure_workspace(str(tmp_path))
    command = code_command(9123)
    assert command[command.index("--bind-addr") + 1] == "127.0.0.1:9123"
    assert command[-1] == str(tmp_path)
    assert command[command.index("--config") + 1].startswith(str(tmp_path))
    assert "--disable-telemetry" in command


def test_missing_code_server_provides_actionable_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("cascaqit_jupyter.ide.code_binary", lambda: None)
    with pytest.raises(RuntimeError, match="CASCAQIT_CODE_SERVER"):
        code_command(9123)
