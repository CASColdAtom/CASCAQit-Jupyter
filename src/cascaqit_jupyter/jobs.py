"""Kernel-owned LocalBackend jobs for editor execution and result display."""

from __future__ import annotations

import copy
import threading
import uuid
from dataclasses import dataclass, field, replace
from typing import Any, NoReturn

from cascaqit import CASCAQitError, LocalBackend, ResultIR
from cascaqit.backends import ExecutionJobProtocol, LocalExecutionJobStatusIR
from cascaqit.diagnostics import DiagnosticsIR
from cascaqit.digital import DigitalProgramIR
from cascaqit.native_ir import ProgramIR

from cascaqit_jupyter.analog_compile import compile_analog_document
from cascaqit_jupyter.compile import build_cell_metadata, compile_digital_document
from cascaqit_jupyter.editor_ir import CompileStatus, EditorDocumentIR
from cascaqit_jupyter.mime import display_result

MAX_KERNEL_JOBS = 64
TERMINAL_JOB_STATES = {"completed", "partially_completed", "failed", "cancelled"}


@dataclass(frozen=True)
class JobOperationError(ValueError):
    """A bounded editor Job failure with structured diagnostics."""

    diagnostics: tuple[DiagnosticsIR, ...]

    def __str__(self) -> str:
        return self.diagnostics[0].message


@dataclass
class _JobRecord:
    document: EditorDocumentIR
    job: ExecutionJobProtocol
    shots: int
    seed: int
    analog_time_steps: int
    result: ResultIR | None = None
    diagnostics: tuple[DiagnosticsIR, ...] = ()
    cancel_requested: bool = False
    worker_finished: bool = False
    worker: threading.Thread | None = field(default=None, repr=False)


class KernelJobManager:
    """Own bounded offline Jobs for one kernel epoch."""

    def start(
        self,
        document: EditorDocumentIR,
        *,
        generated_cell_id: str | None,
        current_source: str | None,
        shots: int,
        seed: int,
        analog_time_steps: int = 80,
    ) -> dict[str, Any]:
        """Validate, submit, and asynchronously execute one editor document."""
        _bounded_integer(shots, field_name="shots", minimum=1, maximum=1_000_000)
        _bounded_integer(seed, field_name="seed", minimum=0, maximum=2**63 - 1)
        _bounded_integer(
            analog_time_steps,
            field_name="analog_time_steps",
            minimum=2,
            maximum=100_000,
        )
        if generated_cell_id is None or current_source is None:
            _fail(
                code="EDITOR_GENERATED_CELL_REQUIRED",
                message="Run requires a synchronized generated code cell.",
                object_path="generated_cell_id",
                suggestion="Generate the code cell before starting a local Job.",
            )

        compiled_document: EditorDocumentIR
        program: DigitalProgramIR | ProgramIR | None
        detached: bool
        detached_diagnostics: tuple[DiagnosticsIR, ...]
        if document.program_kind == "digital":
            digital = compile_digital_document(
                document,
                generated_cell_id=generated_cell_id,
                current_source=current_source,
            )
            compiled_document = digital.document
            program = digital.program
            detached = digital.detached
            detached_diagnostics = digital.diagnostics
        elif document.program_kind == "analog":
            analog = compile_analog_document(
                document,
                generated_cell_id=generated_cell_id,
                current_source=current_source,
            )
            compiled_document = analog.document
            program = analog.program
            detached = analog.detached
            detached_diagnostics = analog.diagnostics
        else:
            _fail(
                code="EDITOR_JOB_PROGRAM_KIND_UNSUPPORTED",
                message=(
                    "Local editor Jobs currently support Digital and Analog programs."
                ),
                object_path="program_kind",
                suggestion="Use a supported Digital or Analog editor document.",
            )
        if detached or program is None:
            raise JobOperationError(detached_diagnostics)

        backend = LocalBackend(seed=seed, analog_time_steps=analog_time_steps)
        job_id = f"jupyter_job.{document.program_kind}.{uuid.uuid4().hex}"
        job = backend.run(
            program,
            shots=shots,
            seed=seed,
            job_id=job_id,
        )
        record = _JobRecord(
            document=compiled_document,
            job=job,
            shots=shots,
            seed=seed,
            analog_time_steps=analog_time_steps,
        )
        worker = threading.Thread(
            target=self._execute,
            args=(job_id,),
            name=f"cascaqit-jupyter-{job_id[-12:]}",
            daemon=True,
        )
        record.worker = worker
        with self._lock:
            self._prune()
            if len(self._records) >= MAX_KERNEL_JOBS:
                _fail(
                    code="KERNEL_JOB_LIMIT_REACHED",
                    message="The kernel has too many active CASCAQit Jobs.",
                    object_path="job",
                    suggestion="Wait for a running Job or restart the kernel.",
                )
            self._records[job_id] = record
        try:
            worker.start()
        except Exception:
            with self._lock:
                self._records.pop(job_id, None)
            raise
        return self.status(job_id)

    def status(self, job_id: str) -> dict[str, Any]:
        """Return one immutable JSON-compatible Job snapshot."""
        with self._lock:
            record = self._record(job_id)
            status = record.job.status()
            if not isinstance(status, LocalExecutionJobStatusIR):
                raise TypeError("LocalBackend returned an unsupported Job status type.")
            backend_state = status.state
            state = (
                "running"
                if backend_state in {"completed", "partially_completed", "failed"}
                and not record.worker_finished
                else backend_state
            )
            compile_status: CompileStatus
            if state in {"completed", "partially_completed"}:
                compile_status = "completed"
            elif state == "failed":
                compile_status = "failed"
            elif state == "cancelled":
                compile_status = "cancelled"
            else:
                compile_status = "running"
            result_identity = (
                None
                if record.result is None
                else {
                    "result_id": record.result.result_id,
                    "result_hash": record.result.stable_hash(),
                    "program_hash": record.result.program_hash,
                }
            )
            last_job = {
                "schema_version": "1.0",
                "job_id": job_id,
                "state": state,
                "status": status.to_dict(),
                "result_pending": state == "running"
                and backend_state in {"completed", "partially_completed"},
                "shots": record.shots,
                "seed": record.seed,
                "analog_time_steps": record.analog_time_steps,
                "cancel_requested": record.cancel_requested,
                "result": result_identity,
            }
            document = replace(
                record.document,
                compile_status=compile_status,
                metadata={**record.document.metadata, "last_job": last_job},
            )
            record.document = document
            result_display = (
                None if record.result is None else display_result(record.result)
            )
            return {
                "document": document.to_dict(),
                "cell_metadata": build_cell_metadata(document),
                "job": copy.deepcopy(last_job),
                "result_mime": (
                    None if result_display is None else result_display.payload
                ),
                "result_text": None if result_display is None else result_display.text,
                "diagnostics": [item.to_dict() for item in record.diagnostics],
            }

    def cancel(self, job_id: str) -> dict[str, Any]:
        """Request cooperative cancellation and return the observed status."""
        with self._lock:
            record = self._record(job_id)
            record.cancel_requested = True
            record.job.cancel()
        return self.status(job_id)

    def clear(self) -> None:
        """Invalidate the registry for a restarted kernel epoch."""
        with self._lock:
            records = tuple(self._records.values())
            self._records.clear()
        for record in records:
            record.cancel_requested = True
            record.job.cancel()

    def _execute(self, job_id: str) -> None:
        with self._lock:
            record = self._records.get(job_id)
        if record is None:
            return
        try:
            result = record.job.result()
        except Exception as exc:
            status = record.job.status()
            if status.state == "cancelled":
                with self._lock:
                    record.worker_finished = True
                return
            with self._lock:
                record.diagnostics = (_exception_diagnostic(exc, job_id=job_id),)
                record.worker_finished = True
        else:
            with self._lock:
                record.result = result
                record.worker_finished = True

    def _record(self, job_id: str) -> _JobRecord:
        if not isinstance(job_id, str) or not job_id.strip():
            _fail(
                code="JOB_ID_REQUIRED",
                message="job_id must be a non-empty string.",
                object_path="job_id",
                suggestion=None,
            )
        record = self._records.get(job_id)
        if record is None:
            _fail(
                code="JOB_NOT_FOUND",
                message="The CASCAQit Job is not available in this kernel epoch.",
                object_path="job_id",
                suggestion="Start a new Job after a kernel restart.",
            )
        return record

    def _prune(self) -> None:
        for job_id, record in tuple(self._records.items()):
            if len(self._records) < MAX_KERNEL_JOBS:
                return
            if record.job.status().state in TERMINAL_JOB_STATES:
                self._records.pop(job_id, None)

    def __init__(self) -> None:
        self._records: dict[str, _JobRecord] = {}
        self._lock = threading.RLock()


def _exception_diagnostic(exc: Exception, *, job_id: str) -> DiagnosticsIR:
    if isinstance(exc, CASCAQitError):
        return exc.to_diagnostic()
    return DiagnosticsIR(
        diagnostic_id=f"diagnostic.jupyter.job_failed.{job_id}",
        stage="simulation",
        severity="error",
        code="JUPYTER_LOCAL_JOB_FAILED",
        message="The local CASCAQit Job failed in the current kernel.",
        object_path="job",
        suggestion="Review the editor inputs and execution diagnostics.",
        metadata={"exception_type": type(exc).__name__},
    )


def _bounded_integer(
    value: object,
    *,
    field_name: str,
    minimum: int,
    maximum: int,
) -> None:
    if (
        not isinstance(value, int)
        or isinstance(value, bool)
        or value < minimum
        or value > maximum
    ):
        _fail(
            code="JOB_OPTION_INVALID",
            message=f"{field_name} must be an integer from {minimum} to {maximum}.",
            object_path=f"job.{field_name}",
            suggestion="Enter a value within the supported local execution range.",
        )


def _fail(
    *, code: str, message: str, object_path: str, suggestion: str | None
) -> NoReturn:
    raise JobOperationError(
        (
            DiagnosticsIR(
                diagnostic_id=f"diagnostic.jupyter.{code.lower()}",
                stage="validation",
                severity="error",
                code=code,
                message=message,
                object_path=object_path,
                suggestion=suggestion,
            ),
        )
    )
