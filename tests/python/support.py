"""Shared test fixtures loaded from versioned JSON artifacts."""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any, cast

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


def load_fixture(name: str) -> dict[str, Any]:
    """Load one object fixture and return a mutable detached copy."""
    value = json.loads((FIXTURES / name).read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise TypeError(f"Fixture {name} must contain an object.")
    return copy.deepcopy(cast(dict[str, Any], value))


def digital_document(*, revision: int = 0) -> dict[str, Any]:
    """Return the canonical Digital editor fixture at a selected revision."""
    value = load_fixture("editor-document-digital-v1.json")
    value["revision"] = revision
    return value
