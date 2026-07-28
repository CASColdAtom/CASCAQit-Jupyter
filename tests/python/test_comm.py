from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from cascaqit_jupyter.comm import COMM_TARGET, KernelSession, register_kernel_comm
from cascaqit_jupyter.schema import validate_contract
from tests.python.support import digital_document, load_fixture


def request(
    session: KernelSession,
    *,
    request_id: str,
    revision: int = 0,
    operation: str = "ping",
    payload: dict[str, object] | None = None,
    epoch: str | None = None,
) -> dict[str, object]:
    return {
        "schema_version": "1.0",
        "message_type": "request",
        "request_id": request_id,
        "document_id": "document.digital.bell",
        "document_revision": revision,
        "kernel_epoch": session.kernel_epoch if epoch is None else epoch,
        "operation": operation,
        "timeout_ms": 30_000,
        "payload": {} if payload is None else payload,
    }


def test_kernel_ready_event_and_ping_use_current_epoch() -> None:
    session = KernelSession(kernel_epoch="epoch-1")
    event = session.hello_event()
    response = session.handle(request(session, request_id="request-1"))

    validate_contract("comm", event)
    assert event == load_fixture("comm-kernel-ready-v1.json")
    assert event["event"] == "kernel_ready"
    assert event["kernel_epoch"] == "epoch-1"
    assert response["status"] == "ok"
    assert response["payload"] == {"alive": True, "kernel_epoch": "epoch-1"}


def test_validate_document_rejects_stale_revision() -> None:
    session = KernelSession(kernel_epoch="epoch-1")
    current = digital_document(revision=2)
    response = session.handle(
        request(
            session,
            request_id="request-current",
            revision=2,
            operation="validate_document",
            payload={"document": current},
        )
    )
    stale = session.handle(
        request(session, request_id="request-stale", revision=1)
    )

    assert response["status"] == "ok"
    assert response["payload"]["valid"] is True
    assert stale["status"] == "error"
    assert stale["error"]["code"] == "STALE_DOCUMENT_REVISION"
    assert stale["error"]["details"] == {"latest_revision": 2}


def test_restart_invalidates_old_epoch_and_duplicate_request_ids() -> None:
    session = KernelSession(kernel_epoch="epoch-1")
    first = request(session, request_id="request-1")
    assert session.handle(first)["status"] == "ok"
    duplicate = session.handle(first)
    assert duplicate["error"]["code"] == "DUPLICATE_REQUEST_ID"

    old_epoch = session.kernel_epoch
    new_epoch = session.restart()
    assert new_epoch != old_epoch
    stale = session.handle(
        request(session, request_id="request-2", epoch=old_epoch)
    )
    assert stale["error"]["code"] == "STALE_KERNEL_EPOCH"
    assert stale["error"]["retryable"] is True


def test_unknown_editor_schema_returns_a_structured_validation_error() -> None:
    session = KernelSession(kernel_epoch="epoch-1")
    document = digital_document()
    document["schema_version"] = "2.0"

    response = session.handle(
        request(
            session,
            request_id="request-1",
            operation="validate_document",
            payload={"document": document},
        )
    )

    assert response["status"] == "error"
    assert response["error"]["code"] == "UNSUPPORTED_EDITOR_SCHEMA_VERSION"
    assert response["error"]["stage"] == "validation"


def test_cancel_is_cooperative_and_requires_a_running_target() -> None:
    session = KernelSession(kernel_epoch="epoch-1")
    calls: list[str] = []
    session.register_cancellable("run-1", lambda: calls.append("cancel"))

    accepted = session.handle(
        request(
            session,
            request_id="cancel-1",
            operation="cancel",
            payload={"target_request_id": "run-1"},
        )
    )
    missing = session.handle(
        request(
            session,
            request_id="cancel-2",
            operation="cancel",
            payload={"target_request_id": "not-running"},
        )
    )

    assert calls == ["cancel"]
    assert accepted["payload"]["cooperative"] is True
    assert missing["error"]["code"] == "REQUEST_NOT_RUNNING"

    repeated = session.handle(
        request(
            session,
            request_id="cancel-3",
            operation="cancel",
            payload={"target_request_id": "run-1"},
        )
    )
    assert repeated["error"]["code"] == "REQUEST_NOT_RUNNING"


@dataclass
class FakeComm:
    sent: list[dict[str, Any]] = field(default_factory=list)
    callback: Callable[[dict[str, Any]], None] | None = None

    def on_msg(self, callback: Callable[[dict[str, Any]], None]) -> None:
        self.callback = callback

    def send(self, data: dict[str, Any]) -> None:
        self.sent.append(data)


@dataclass
class FakeCommManager:
    target_name: str | None = None
    callback: Callable[[FakeComm, dict[str, Any]], None] | None = None

    def register_target(
        self,
        target_name: str,
        callback: Callable[[FakeComm, dict[str, Any]], None],
    ) -> None:
        self.target_name = target_name
        self.callback = callback


@dataclass
class FakeKernel:
    comm_manager: FakeCommManager


@dataclass
class FakeIPython:
    kernel: FakeKernel


def test_real_comm_adapter_sends_handshake_and_structured_response() -> None:
    manager = FakeCommManager()
    shell = FakeIPython(kernel=FakeKernel(comm_manager=manager))
    session = register_kernel_comm(
        session=KernelSession(kernel_epoch="epoch-1"),
        ipython=shell,
    )
    assert manager.target_name == COMM_TARGET
    assert manager.callback is not None

    comm = FakeComm()
    manager.callback(comm, {})
    assert comm.sent == [session.hello_event()]
    assert comm.callback is not None

    comm.callback(
        {"content": {"data": request(session, request_id="request-1")}}
    )
    assert comm.sent[-1]["status"] == "ok"
    validate_contract("comm", comm.sent[-1])
