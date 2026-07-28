"""Kernel-side request handling for the versioned CASCAQit Jupyter comm."""

from __future__ import annotations

import copy
import importlib
import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol, cast

from cascaqit_jupyter.analog_compile import (
    AnalogCompileError,
    compile_analog_document,
)
from cascaqit_jupyter.compile import DigitalCompileError, compile_digital_document
from cascaqit_jupyter.editor_ir import (
    EditorDocumentIR,
    UnsupportedEditorSchemaVersion,
)
from cascaqit_jupyter.schema import SchemaContractError, validate_contract

COMM_TARGET = "cascaqit.jupyter.v1"
COMM_SCHEMA_VERSION = "1.0"


class CommLike(Protocol):
    """Minimal ipykernel comm surface used by the registration adapter."""

    def on_msg(self, callback: Callable[[dict[str, Any]], None]) -> None: ...

    def send(self, data: dict[str, Any]) -> None: ...


class GetIPythonLike(Protocol):
    """Typed lazy accessor for an optional running IPython shell."""

    def __call__(self) -> object | None: ...


class CommManagerLike(Protocol):
    """Minimal comm manager surface used for registration."""

    def register_target(
        self,
        target_name: str,
        callback: Callable[[CommLike, dict[str, Any]], None],
    ) -> None: ...


@dataclass(frozen=True)
class ProtocolFault(Exception):
    """A structured error that is safe to return through the comm."""

    code: str
    message: str
    stage: Literal["protocol", "validation", "kernel"] = "protocol"
    object_path: str | None = None
    suggestion: str | None = None
    retryable: bool = False
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Return the wire representation required by comm-v1."""
        return {
            "code": self.code,
            "message": self.message,
            "stage": self.stage,
            "object_path": self.object_path,
            "suggestion": self.suggestion,
            "retryable": self.retryable,
            "details": copy.deepcopy(self.details),
        }


@dataclass
class KernelSession:
    """Own one kernel epoch and reject stale or duplicate document requests."""

    kernel_epoch: str = field(default_factory=lambda: uuid.uuid4().hex)
    _latest_revisions: dict[str, int] = field(default_factory=dict, init=False)
    _seen_request_ids: set[str] = field(default_factory=set, init=False)
    _cancel_callbacks: dict[str, Callable[[], None]] = field(
        default_factory=dict,
        init=False,
    )

    def hello_event(self) -> dict[str, Any]:
        """Return the epoch handshake sent whenever a frontend opens the comm."""
        event = {
            "schema_version": COMM_SCHEMA_VERSION,
            "message_type": "event",
            "document_id": "__kernel__",
            "document_revision": 0,
            "kernel_epoch": self.kernel_epoch,
            "event": "kernel_ready",
            "payload": {
                "comm_target": COMM_TARGET,
                "operations": [
                    "ping",
                    "validate_document",
                    "compile_digital",
                    "compile_analog",
                    "cancel",
                ],
                "cooperative_cancel": True,
            },
        }
        validate_contract("comm", event)
        return event

    def register_cancellable(
        self,
        request_id: str,
        callback: Callable[[], None],
    ) -> None:
        """Register a cooperative cancel callback for a running operation."""
        if not isinstance(request_id, str) or not request_id:
            raise ValueError("request_id must be a non-empty string.")
        if not callable(callback):
            raise TypeError("callback must be callable.")
        self._cancel_callbacks[request_id] = callback

    def finish_cancellable(self, request_id: str) -> None:
        """Remove a completed operation from the cancellable registry."""
        self._cancel_callbacks.pop(request_id, None)

    def restart(self) -> str:
        """Create a new epoch and invalidate all pending kernel-side state."""
        self.kernel_epoch = uuid.uuid4().hex
        self._latest_revisions.clear()
        self._seen_request_ids.clear()
        self._cancel_callbacks.clear()
        return self.kernel_epoch

    def handle(self, raw_request: object) -> dict[str, Any]:
        """Validate and execute one bounded kernel protocol operation."""
        context = _response_context(raw_request, self.kernel_epoch)
        try:
            validate_contract("comm", raw_request)
            if not isinstance(raw_request, dict):
                raise ProtocolFault(
                    code="INVALID_REQUEST",
                    message="Comm request must be a JSON object.",
                )
            if raw_request.get("message_type") != "request":
                raise ProtocolFault(
                    code="INVALID_MESSAGE_TYPE",
                    message="KernelSession accepts request messages only.",
                    object_path="$.message_type",
                )
            request = cast(dict[str, Any], raw_request)
            context = _response_context(request, self.kernel_epoch)
            request_id = cast(str, request["request_id"])
            if request["kernel_epoch"] != self.kernel_epoch:
                raise ProtocolFault(
                    code="STALE_KERNEL_EPOCH",
                    message="The request belongs to a previous kernel epoch.",
                    object_path="$.kernel_epoch",
                    suggestion="Wait for kernel_ready and retry against the new epoch.",
                    retryable=True,
                    details={"current_kernel_epoch": self.kernel_epoch},
                )
            if request_id in self._seen_request_ids:
                raise ProtocolFault(
                    code="DUPLICATE_REQUEST_ID",
                    message="The request ID has already been handled in this epoch.",
                    object_path="$.request_id",
                )
            self._seen_request_ids.add(request_id)
            self._check_revision(request)
            payload = self._dispatch(request)
            response = _ok_response(context, payload)
        except SchemaContractError as exc:
            response = _error_response(
                context,
                ProtocolFault(
                    code=exc.code,
                    message=exc.message,
                    stage="validation",
                    object_path=exc.object_path,
                ),
            )
        except UnsupportedEditorSchemaVersion as exc:
            response = _error_response(
                context,
                ProtocolFault(
                    code="UNSUPPORTED_EDITOR_SCHEMA_VERSION",
                    message=str(exc),
                    stage="validation",
                    object_path="$.payload.document.schema_version",
                    suggestion="Open the document with a compatible companion version.",
                ),
            )
        except (DigitalCompileError, AnalogCompileError) as exc:
            diagnostic = exc.diagnostics[0]
            response = _error_response(
                context,
                ProtocolFault(
                    code=diagnostic.code,
                    message=diagnostic.message,
                    stage="validation",
                    object_path=diagnostic.object_path,
                    suggestion=diagnostic.suggestion,
                    details={
                        "diagnostics": [item.to_dict() for item in exc.diagnostics]
                    },
                ),
            )
        except ProtocolFault as exc:
            response = _error_response(context, exc)
        except Exception as exc:
            response = _error_response(
                context,
                ProtocolFault(
                    code="KERNEL_HANDLER_FAILED",
                    message="The kernel could not complete the request.",
                    stage="kernel",
                    retryable=False,
                    details={"exception_type": type(exc).__name__},
                ),
            )
        validate_contract("comm", response)
        return response

    def _check_revision(self, request: dict[str, Any]) -> None:
        document_id = cast(str, request["document_id"])
        revision = cast(int, request["document_revision"])
        latest = self._latest_revisions.get(document_id, -1)
        if revision < latest:
            raise ProtocolFault(
                code="STALE_DOCUMENT_REVISION",
                message="The request revision is older than the kernel revision.",
                object_path="$.document_revision",
                suggestion="Retry with the current editor document revision.",
                retryable=True,
                details={"latest_revision": latest},
            )
        self._latest_revisions[document_id] = revision

    def _dispatch(self, request: dict[str, Any]) -> dict[str, Any]:
        operation = request["operation"]
        payload = cast(dict[str, Any], request["payload"])
        if operation == "ping":
            return {"alive": True, "kernel_epoch": self.kernel_epoch}
        if operation == "validate_document":
            raw_document = payload.get("document")
            if not isinstance(raw_document, dict):
                raise ProtocolFault(
                    code="EDITOR_DOCUMENT_REQUIRED",
                    message="validate_document requires payload.document.",
                    stage="validation",
                    object_path="$.payload.document",
                )
            document = EditorDocumentIR.from_dict(raw_document)
            if document.document_id != request["document_id"]:
                raise ProtocolFault(
                    code="DOCUMENT_ID_MISMATCH",
                    message="Envelope and editor document IDs must match.",
                    stage="validation",
                    object_path="$.payload.document.document_id",
                )
            if document.revision != request["document_revision"]:
                raise ProtocolFault(
                    code="DOCUMENT_REVISION_MISMATCH",
                    message="Envelope and editor document revisions must match.",
                    stage="validation",
                    object_path="$.payload.document.revision",
                )
            return {
                "valid": True,
                "document_hash": document.stable_hash(),
                "document": document.to_dict(),
            }
        if operation == "compile_digital":
            raw_document = payload.get("document")
            if not isinstance(raw_document, dict):
                raise ProtocolFault(
                    code="EDITOR_DOCUMENT_REQUIRED",
                    message="compile_digital requires payload.document.",
                    stage="validation",
                    object_path="$.payload.document",
                )
            document = EditorDocumentIR.from_dict(raw_document)
            if document.document_id != request["document_id"]:
                raise ProtocolFault(
                    code="DOCUMENT_ID_MISMATCH",
                    message="Envelope and editor document IDs must match.",
                    stage="validation",
                    object_path="$.payload.document.document_id",
                )
            if document.revision != request["document_revision"]:
                raise ProtocolFault(
                    code="DOCUMENT_REVISION_MISMATCH",
                    message="Envelope and editor document revisions must match.",
                    stage="validation",
                    object_path="$.payload.document.revision",
                )
            cell_id = payload.get("generated_cell_id")
            if cell_id is not None and not isinstance(cell_id, str):
                raise ProtocolFault(
                    code="GENERATED_CELL_ID_INVALID",
                    message="generated_cell_id must be a string or null.",
                    stage="validation",
                    object_path="$.payload.generated_cell_id",
                )
            current_source = payload.get("current_source")
            if current_source is not None and not isinstance(current_source, str):
                raise ProtocolFault(
                    code="CURRENT_SOURCE_INVALID",
                    message="current_source must be a string or null.",
                    stage="validation",
                    object_path="$.payload.current_source",
                )
            return compile_digital_document(
                document,
                generated_cell_id=cell_id,
                current_source=current_source,
            ).to_payload()
        if operation == "compile_analog":
            raw_document = payload.get("document")
            if not isinstance(raw_document, dict):
                raise ProtocolFault(
                    code="EDITOR_DOCUMENT_REQUIRED",
                    message="compile_analog requires payload.document.",
                    stage="validation",
                    object_path="$.payload.document",
                )
            document = EditorDocumentIR.from_dict(raw_document)
            if document.document_id != request["document_id"]:
                raise ProtocolFault(
                    code="DOCUMENT_ID_MISMATCH",
                    message="Envelope and editor document IDs must match.",
                    stage="validation",
                    object_path="$.payload.document.document_id",
                )
            if document.revision != request["document_revision"]:
                raise ProtocolFault(
                    code="DOCUMENT_REVISION_MISMATCH",
                    message="Envelope and editor document revisions must match.",
                    stage="validation",
                    object_path="$.payload.document.revision",
                )
            cell_id = payload.get("generated_cell_id")
            if cell_id is not None and not isinstance(cell_id, str):
                raise ProtocolFault(
                    code="GENERATED_CELL_ID_INVALID",
                    message="generated_cell_id must be a string or null.",
                    stage="validation",
                    object_path="$.payload.generated_cell_id",
                )
            current_source = payload.get("current_source")
            if current_source is not None and not isinstance(current_source, str):
                raise ProtocolFault(
                    code="CURRENT_SOURCE_INVALID",
                    message="current_source must be a string or null.",
                    stage="validation",
                    object_path="$.payload.current_source",
                )
            return compile_analog_document(
                document,
                generated_cell_id=cell_id,
                current_source=current_source,
            ).to_payload()
        if operation == "cancel":
            target_request_id = payload.get("target_request_id")
            if not isinstance(target_request_id, str) or not target_request_id:
                raise ProtocolFault(
                    code="CANCEL_TARGET_REQUIRED",
                    message="cancel requires payload.target_request_id.",
                    object_path="$.payload.target_request_id",
                )
            callback = self._cancel_callbacks.pop(target_request_id, None)
            if callback is None:
                raise ProtocolFault(
                    code="REQUEST_NOT_RUNNING",
                    message=(
                        "The target request is not a cancellable running operation."
                    ),
                    object_path="$.payload.target_request_id",
                )
            callback()
            return {
                "target_request_id": target_request_id,
                "cancel_requested": True,
                "cooperative": True,
            }
        raise ProtocolFault(
            code="OPERATION_NOT_SUPPORTED",
            message=f"Unsupported operation: {operation}",
            object_path="$.operation",
        )


def register_kernel_comm(
    *,
    session: KernelSession | None = None,
    ipython: object | None = None,
) -> KernelSession:
    """Register the CASCAQit comm target in the current IPython kernel."""
    if ipython is None:
        get_ipython = cast(
            GetIPythonLike,
            importlib.import_module("IPython").get_ipython,
        )
        ipython = get_ipython()
    kernel = getattr(ipython, "kernel", None)
    manager = getattr(kernel, "comm_manager", None)
    if manager is None:
        raise RuntimeError("A running IPython kernel with a comm manager is required.")
    active_session = KernelSession() if session is None else session

    def target(comm: CommLike, _open_message: dict[str, Any]) -> None:
        comm.send(active_session.hello_event())

        def on_message(message: dict[str, Any]) -> None:
            data = message.get("content", {}).get("data")
            comm.send(active_session.handle(data))

        comm.on_msg(on_message)

    cast(CommManagerLike, manager).register_target(COMM_TARGET, target)
    return active_session


def _response_context(raw: object, kernel_epoch: str) -> dict[str, Any]:
    value: Mapping[str, object] = raw if isinstance(raw, Mapping) else {}
    request_id = value.get("request_id")
    document_id = value.get("document_id")
    revision = value.get("document_revision")
    safe_request_id = (
        request_id if isinstance(request_id, str) and request_id else "unknown"
    )
    safe_revision = (
        revision
        if isinstance(revision, int)
        and not isinstance(revision, bool)
        and revision >= 0
        else 0
    )
    return {
        "request_id": safe_request_id,
        "document_id": document_id
        if isinstance(document_id, str) and document_id
        else "__unknown__",
        "document_revision": safe_revision,
        "kernel_epoch": kernel_epoch,
    }


def _ok_response(context: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema_version": COMM_SCHEMA_VERSION,
        "message_type": "response",
        **context,
        "status": "ok",
        "payload": copy.deepcopy(payload),
        "error": None,
    }


def _error_response(
    context: dict[str, Any],
    fault: ProtocolFault,
) -> dict[str, Any]:
    return {
        "schema_version": COMM_SCHEMA_VERSION,
        "message_type": "response",
        **context,
        "status": "error",
        "payload": {},
        "error": fault.to_dict(),
    }
