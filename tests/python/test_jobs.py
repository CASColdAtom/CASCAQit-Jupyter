from __future__ import annotations

import threading
import time
from collections.abc import Callable
from typing import Any, NoReturn

import pytest
from cascaqit.backends import LocalExecutionJobStatusIR

import cascaqit_jupyter.jobs as jobs_module
from cascaqit_jupyter.analog_compile import compile_analog_document
from cascaqit_jupyter.compile import compile_digital_document
from cascaqit_jupyter.editor_ir import EditorDocumentIR
from cascaqit_jupyter.jobs import JobOperationError, KernelJobManager
from tests.python.support import analog_document, digital_document


def test_digital_job_completes_with_result_identity_and_resource_evidence() -> None:
    compiled = compile_digital_document(
        EditorDocumentIR.from_dict(digital_document()),
        generated_cell_id="cell-digital",
    )
    assert compiled.generated_source is not None
    manager = KernelJobManager()

    started = manager.start(
        compiled.document,
        generated_cell_id="cell-digital",
        current_source=compiled.generated_source,
        shots=32,
        seed=2026,
    )
    completed = _wait_for_terminal(manager, started["job"]["job_id"])

    assert completed["document"]["compile_status"] == "completed"
    assert completed["job"]["state"] == "completed"
    assert completed["job"]["status"]["backend_id"] == "local.simulator"
    assert completed["job"]["status"]["network_accessed"] is False
    assert completed["result_mime"]["kind"] == "result"
    result = completed["result_mime"]["data"]
    assert result["shots"] == 32
    assert sum(result["probabilities"].values()) == pytest.approx(1.0)
    assert result["metadata"]["simulation_resource_usage"]["measurement_scope"] == (
        "job"
    )
    assert completed["job"]["result"]["result_id"] == result["result_id"]
    saved = completed["cell_metadata"]["cascaqit_jupyter"]["editor_document"]
    assert saved["metadata"]["last_job"]["result"]["result_id"] == (
        result["result_id"]
    )


def test_analog_job_completes_through_public_local_backend() -> None:
    compiled = compile_analog_document(
        EditorDocumentIR.from_dict(analog_document()),
        generated_cell_id="cell-analog",
    )
    assert compiled.generated_source is not None
    manager = KernelJobManager()

    started = manager.start(
        compiled.document,
        generated_cell_id="cell-analog",
        current_source=compiled.generated_source,
        shots=16,
        seed=2026,
        analog_time_steps=40,
    )
    completed = _wait_for_terminal(manager, started["job"]["job_id"])

    assert completed["job"]["state"] == "completed"
    assert completed["job"]["status"]["program_kind"] == "analog"
    assert completed["result_mime"]["data"]["shots"] == 16
    assert completed["result_mime"]["data"]["program_hash"] == (
        compiled.program_hash
    )


def test_modified_generated_source_is_rejected_as_detached() -> None:
    compiled = compile_digital_document(
        EditorDocumentIR.from_dict(digital_document()),
        generated_cell_id="cell-digital",
    )
    assert compiled.generated_source is not None

    with pytest.raises(JobOperationError) as error:
        KernelJobManager().start(
            compiled.document,
            generated_cell_id="cell-digital",
            current_source=compiled.generated_source + "# user edit\n",
            shots=32,
            seed=2026,
        )

    assert error.value.diagnostics[0].code == "GENERATED_CELL_DETACHED"


def test_queued_job_can_be_cancelled_deterministically(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workers: list[DeferredThread] = []

    def thread_factory(
        *,
        target: Callable[..., None],
        args: tuple[object, ...],
        name: str,
        daemon: bool,
    ) -> DeferredThread:
        worker = DeferredThread(target=target, args=args, name=name, daemon=daemon)
        workers.append(worker)
        return worker

    monkeypatch.setattr(threading, "Thread", thread_factory)
    compiled = compile_digital_document(
        EditorDocumentIR.from_dict(digital_document()),
        generated_cell_id="cell-digital",
    )
    assert compiled.generated_source is not None
    manager = KernelJobManager()
    started = manager.start(
        compiled.document,
        generated_cell_id="cell-digital",
        current_source=compiled.generated_source,
        shots=32,
        seed=2026,
    )

    cancelled = manager.cancel(started["job"]["job_id"])

    assert workers and workers[0].started is True
    assert cancelled["job"]["cancel_requested"] is True
    assert cancelled["job"]["state"] == "cancelled"
    assert cancelled["document"]["compile_status"] == "cancelled"
    assert cancelled["result_mime"] is None


def test_terminal_backend_state_waits_for_worker_result_collection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workers: list[DeferredThread] = []

    def thread_factory(
        *,
        target: Callable[..., None],
        args: tuple[object, ...],
        name: str,
        daemon: bool,
    ) -> DeferredThread:
        worker = DeferredThread(target=target, args=args, name=name, daemon=daemon)
        workers.append(worker)
        return worker

    monkeypatch.setattr(threading, "Thread", thread_factory)
    monkeypatch.setattr(jobs_module, "LocalBackend", CompletedBeforeWorkerBackend)
    compiled = compile_digital_document(
        EditorDocumentIR.from_dict(digital_document()),
        generated_cell_id="cell-digital",
    )
    assert compiled.generated_source is not None

    started = KernelJobManager().start(
        compiled.document,
        generated_cell_id="cell-digital",
        current_source=compiled.generated_source,
        shots=32,
        seed=2026,
    )

    assert workers and workers[0].started is True
    assert started["job"]["status"]["state"] == "completed"
    assert started["job"]["state"] == "running"
    assert started["job"]["result_pending"] is True
    assert started["document"]["compile_status"] == "running"
    assert started["result_mime"] is None


@pytest.mark.parametrize(
    ("field", "value"),
    [("shots", 0), ("seed", -1), ("analog_time_steps", 1)],
)
def test_job_options_are_bounded(field: str, value: int) -> None:
    compiled = compile_digital_document(
        EditorDocumentIR.from_dict(digital_document()),
        generated_cell_id="cell-digital",
    )
    assert compiled.generated_source is not None
    options = {"shots": 32, "seed": 2026, "analog_time_steps": 80}
    options[field] = value

    with pytest.raises(JobOperationError) as error:
        KernelJobManager().start(
            compiled.document,
            generated_cell_id="cell-digital",
            current_source=compiled.generated_source,
            **options,
        )

    assert error.value.diagnostics[0].code == "JOB_OPTION_INVALID"
    assert error.value.diagnostics[0].object_path == f"job.{field}"


def test_unknown_job_is_rejected_after_registry_clear() -> None:
    manager = KernelJobManager()
    manager.clear()

    with pytest.raises(JobOperationError) as error:
        manager.status("jupyter_job.digital.missing")

    assert error.value.diagnostics[0].code == "JOB_NOT_FOUND"


class DeferredThread:
    def __init__(
        self,
        *,
        target: Callable[..., None],
        args: tuple[object, ...],
        name: str,
        daemon: bool,
    ) -> None:
        self.target = target
        self.args = args
        self.name = name
        self.daemon = daemon
        self.started = False

    def start(self) -> None:
        self.started = True


class CompletedBeforeWorkerJob:
    def __init__(self, job_id: str) -> None:
        self.job_id = job_id

    def status(self) -> LocalExecutionJobStatusIR:
        return LocalExecutionJobStatusIR(
            job_id=self.job_id,
            state="completed",
            backend_id="local.simulator",
            program_kind="digital",
            program_hash="a" * 64,
            execution_count=1,
            message="Completed before the worker collected the result.",
        )

    def result(self) -> NoReturn:
        raise AssertionError("Deferred worker must not execute in this test.")

    def cancel(self) -> LocalExecutionJobStatusIR:
        return self.status()


class CompletedBeforeWorkerBackend:
    def __init__(self, *, seed: int, analog_time_steps: int) -> None:
        del seed, analog_time_steps

    def run(
        self,
        program: object,
        *,
        shots: int,
        seed: int,
        job_id: str,
    ) -> CompletedBeforeWorkerJob:
        del program, shots, seed
        return CompletedBeforeWorkerJob(job_id)


def _wait_for_terminal(
    manager: KernelJobManager,
    job_id: str,
    *,
    timeout: float = 10.0,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        snapshot = manager.status(job_id)
        if snapshot["job"]["state"] in {
            "completed",
            "partially_completed",
            "failed",
            "cancelled",
        }:
            return snapshot
        time.sleep(0.01)
    raise AssertionError(f"Job did not reach a terminal state: {job_id}")
