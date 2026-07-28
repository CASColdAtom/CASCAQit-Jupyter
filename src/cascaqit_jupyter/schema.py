"""Load and validate the versioned JSON contracts shipped with the companion."""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from importlib import resources
from typing import Any

from jsonschema import Draft202012Validator

SCHEMA_NAMES = {
    "comm": "comm-v1.schema.json",
    "editor_document": "editor-document-v1.schema.json",
    "mime": "mime-v1.schema.json",
}


@dataclass(frozen=True)
class SchemaContractError(ValueError):
    """A stable, structured schema validation failure."""

    code: str
    message: str
    object_path: str

    def __str__(self) -> str:
        return f"{self.code} at {self.object_path}: {self.message}"


@lru_cache(maxsize=len(SCHEMA_NAMES))
def load_schema(name: str) -> dict[str, Any]:
    """Return one packaged JSON Schema after checking its own validity."""
    try:
        filename = SCHEMA_NAMES[name]
    except KeyError as exc:
        raise ValueError(f"Unknown schema name: {name}") from exc
    text = (
        resources.files("cascaqit_jupyter.schemas")
        .joinpath(filename)
        .read_text(encoding="utf-8")
    )
    schema = json.loads(text)
    if not isinstance(schema, dict):
        raise TypeError(f"Packaged schema {filename} must contain an object.")
    Draft202012Validator.check_schema(schema)
    return schema


def validate_contract(name: str, value: object) -> None:
    """Validate a value and raise the first deterministic structured error."""
    validator = Draft202012Validator(load_schema(name))
    errors = sorted(
        validator.iter_errors(value),
        key=lambda error: (
            tuple(str(item) for item in error.absolute_path),
            error.message,
        ),
    )
    if not errors:
        return
    error = errors[0]
    path = "$"
    for item in error.absolute_path:
        path += f"[{item}]" if isinstance(item, int) else f".{item}"
    raise SchemaContractError(
        code="SCHEMA_VALIDATION_FAILED",
        message=error.message,
        object_path=path,
    )
