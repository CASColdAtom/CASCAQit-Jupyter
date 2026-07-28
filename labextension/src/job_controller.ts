import type { NotebookPanel } from '@jupyterlab/notebook';

import type { KernelClient } from './kernel_client';
import type { NotebookBridge } from './notebook_bridge';
import type { CommResponse, ProtocolError } from './protocol';

export const RESULT_MIME = 'application/vnd.cascaqit.result+json';

const TERMINAL_STATES = new Set([
  'completed',
  'partially_completed',
  'failed',
  'cancelled'
]);

export interface JobEditorDocument {
  document_id: string;
  revision: number;
  program_kind: 'digital' | 'analog';
  generated_cell_id: string | null;
  compile_status: string;
  metadata: Record<string, unknown>;
}

export interface JobRunOptions {
  shots: number;
  seed: number;
  analogTimeSteps?: number;
}

export interface JobViewState {
  state: string | null;
  jobId: string | null;
  cancelRequested: boolean;
  message: string;
  resultMime: unknown | null;
  diagnostics: string[];
}

export interface JobControllerOptions {
  panel: () => NotebookPanel | null;
  document: () => JobEditorDocument;
  acceptDocument: (value: unknown) => void;
  changed: () => void;
  bridge: NotebookBridge;
  client: KernelClient;
  pollIntervalMs?: number;
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancelSchedule?: (timer: ReturnType<typeof setTimeout>) => void;
}

export class JobController {
  constructor(private readonly options: JobControllerOptions) {
    this.pollIntervalMs = options.pollIntervalMs ?? 250;
    this.schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay));
    this.cancelSchedule = options.cancelSchedule ?? (timer => clearTimeout(timer));
    this.restore(options.document());
  }

  get view(): JobViewState {
    return structuredClone(this.current);
  }

  get active(): boolean {
    return (
      this.tracking &&
      this.current.state !== null &&
      !TERMINAL_STATES.has(this.current.state)
    );
  }

  restore(document: JobEditorDocument): void {
    this.stopPolling();
    this.tracking = false;
    const lastJob = record(document.metadata.last_job);
    const state = text(lastJob.state);
    const jobId = text(lastJob.job_id);
    this.current = {
      state,
      jobId,
      cancelRequested: lastJob.cancel_requested === true,
      message: state === null ? 'No local Job has been started.' : jobMessage(state, lastJob.cancel_requested === true),
      resultMime: null,
      diagnostics: []
    };
  }

  async start(runOptions: JobRunOptions): Promise<void> {
    if (this.active) {
      return;
    }
    const panel = this.options.panel();
    if (panel === null) {
      this.fail('Open a Notebook with a running Python kernel.');
      return;
    }
    await panel.sessionContext.ready;
    const kernel = panel.sessionContext.session?.kernel ?? null;
    if (kernel === null) {
      this.fail('Open a Notebook with a running Python kernel.');
      return;
    }
    const document = this.options.document();
    const context = this.options.bridge.context(panel, document);
    if (context.cellId === null || context.source === null) {
      this.fail('Generate and synchronize the code cell before running.');
      return;
    }

    this.current = {
      state: 'submitting',
      jobId: null,
      cancelRequested: false,
      message: 'Submitting to the local CASCAQit backend.',
      resultMime: null,
      diagnostics: []
    };
    this.tracking = true;
    this.options.changed();
    try {
      await this.options.client.connect(kernel);
      const response = await this.options.client.request(
        document.document_id,
        document.revision,
        'start_job',
        {
          document,
          generated_cell_id: context.cellId,
          current_source: context.source,
          shots: runOptions.shots,
          seed: runOptions.seed,
          analog_time_steps: runOptions.analogTimeSteps ?? 80
        }
      );
      this.requireSuccess(response);
      this.acceptPayload(panel, response.payload);
      this.schedulePoll();
    } catch (error) {
      this.failFrom(error);
    }
  }

  async cancel(): Promise<void> {
    const document = this.options.document();
    const jobId = this.current.jobId;
    if (jobId === null || !this.active) {
      return;
    }
    this.current.cancelRequested = true;
    this.current.message = jobMessage(this.current.state ?? 'running', true);
    this.options.changed();
    try {
      const response = await this.options.client.request(
        document.document_id,
        document.revision,
        'cancel_job',
        { job_id: jobId },
        10_000
      );
      this.requireSuccess(response);
      const panel = this.options.panel();
      if (panel !== null) {
        this.acceptPayload(panel, response.payload);
      }
      this.schedulePoll();
    } catch (error) {
      this.failFrom(error);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stopPolling();
  }

  private schedulePoll(): void {
    this.stopPolling();
    if (this.disposed || !this.active || this.current.jobId === null) {
      return;
    }
    this.timer = this.schedule(() => void this.poll(), this.pollIntervalMs);
  }

  private async poll(): Promise<void> {
    this.timer = null;
    const panel = this.options.panel();
    const jobId = this.current.jobId;
    if (this.disposed || panel === null || jobId === null) {
      return;
    }
    const document = this.options.document();
    try {
      const response = await this.options.client.request(
        document.document_id,
        document.revision,
        'job_status',
        { job_id: jobId },
        10_000
      );
      this.requireSuccess(response);
      this.acceptPayload(panel, response.payload);
      this.schedulePoll();
    } catch (error) {
      this.failFrom(error);
    }
  }

  private acceptPayload(panel: NotebookPanel, value: Record<string, unknown>): void {
    const document = value.document;
    const job = record(value.job);
    const jobId = text(job.job_id);
    const state = text(job.state);
    if (!isRecord(document) || jobId === null || state === null) {
      throw new Error('Kernel returned an incomplete CASCAQit Job payload.');
    }
    this.options.acceptDocument(document);
    const accepted = this.options.document();
    this.options.bridge.applyMetadata(panel, accepted, {
      cell_metadata: value.cell_metadata
    });
    this.current = {
      state,
      jobId,
      cancelRequested: job.cancel_requested === true,
      message: jobMessage(state, job.cancel_requested === true),
      resultMime: value.result_mime ?? null,
      diagnostics: diagnosticMessages(value.diagnostics)
    };
    this.tracking = !TERMINAL_STATES.has(state);
    this.options.changed();
  }

  private requireSuccess(response: CommResponse): void {
    if (response.status === 'error') {
      throw response.error ?? new Error('CASCAQit local Job failed.');
    }
  }

  private failFrom(error: unknown): void {
    const protocol = protocolError(error);
    this.fail(
      protocol?.message ?? errorMessage(error),
      protocolDiagnostics(protocol)
    );
  }

  private fail(message: string, diagnostics: string[] = []): void {
    this.stopPolling();
    this.tracking = false;
    this.current = {
      ...this.current,
      state: this.current.jobId === null ? 'error' : this.current.state,
      message,
      diagnostics
    };
    this.options.changed();
  }

  private stopPolling(): void {
    if (this.timer !== null) {
      this.cancelSchedule(this.timer);
      this.timer = null;
    }
  }

  private current: JobViewState = {
    state: null,
    jobId: null,
    cancelRequested: false,
    message: 'No local Job has been started.',
    resultMime: null,
    diagnostics: []
  };
  private readonly pollIntervalMs: number;
  private readonly schedule: (
    callback: () => void,
    delay: number
  ) => ReturnType<typeof setTimeout>;
  private readonly cancelSchedule: (timer: ReturnType<typeof setTimeout>) => void;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private tracking = false;
  private disposed = false;
}

function jobMessage(state: string, cancelRequested: boolean): string {
  const label = state.replaceAll('_', ' ');
  return cancelRequested && !TERMINAL_STATES.has(state)
    ? `Cancel requested; Job is still ${label}.`
    : `Local Job ${label}.`;
}

function diagnosticMessages(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap(item => {
    const diagnostic = record(item);
    const message = text(diagnostic.message);
    if (message === null) {
      return [];
    }
    const code = text(diagnostic.code);
    const suggestion = text(diagnostic.suggestion);
    return [`${code === null ? '' : `${code}: `}${message}${suggestion === null ? '' : ` ${suggestion}`}`];
  });
}

function protocolError(value: unknown): ProtocolError | null {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'code') === 'string' &&
    typeof Reflect.get(value, 'message') === 'string'
  )
    ? (value as ProtocolError)
    : null;
}

function protocolDiagnostics(value: ProtocolError | null): string[] {
  if (value === null) {
    return [];
  }
  const diagnostics = diagnosticMessages(value.details.diagnostics);
  return diagnostics.length > 0 ? diagnostics : [`${value.code}: ${value.message}`];
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : 'CASCAQit local Job failed.';
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
