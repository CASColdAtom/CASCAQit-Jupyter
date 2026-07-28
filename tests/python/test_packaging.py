from __future__ import annotations

import json
from importlib import resources
from pathlib import Path

from packaging.version import Version

import cascaqit_jupyter

ROOT = Path(__file__).resolve().parents[2]


def test_python_and_labextension_versions_are_atomic() -> None:
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    assert Version(package["version"]) == Version(cascaqit_jupyter.__version__)


def test_labextension_discovery_contract_is_stable() -> None:
    assert cascaqit_jupyter._jupyter_labextension_paths() == [
        {"src": "labextension", "dest": "@cascaqit/jupyter"}
    ]


def test_installed_wheel_contains_prebuilt_extension_when_available() -> None:
    labextension = resources.files("cascaqit_jupyter") / "labextension"
    if labextension.is_dir():
        assert (labextension / "package.json").is_file()
        assert any((labextension / "static").iterdir())
