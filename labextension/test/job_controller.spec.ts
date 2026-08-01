import { describe, expect, it, vi } from 'vitest';
import type { NotebookPanel } from '@jupyterlab/notebook';

import { createDigitalDocument } from '../src/digital_document';
import type { DigitalEditorDocument } from '../src/digital_document';
import { JobController } from '../src/job_controller';
import type { KernelClient } from '../src/kernel_client';
import type { NotebookBridge } from '../src/notebook_bridge';
import type { CommResponse, Operation } from '../src/protocol';

describe('JobController', () => {
  it('polls a local Job to completion and persists result identity metadata', async () => {
    let document = readyDocument();
    const callbacks: Array<() => void> = [];
    const applyMetadata = vi.fn();
    const request = vi.fn(async (
      _documentId: string,
      _revision: number,
      operation: Operation
    ) => operation === 'start_job'
      ? response(jobPayload(document, 'running'))
      : response(jobPayload(document, 'completed', resultMime())));
    const controller = new JobController({
      panel: () => panel(),
      document: () => document,
      acceptDocument: value => {
        document = value as typeof document;
      },
      changed: vi.fn(),
      bridge: {
        context: vi.fn(() => ({ cellId: 'cell-1', source: 'source' })),
        applyMetadata
      } as unknown as NotebookBridge,
      client: {
        connect: vi.fn(async () => undefined),
        request
      } as unknown as KernelClient,
      schedule: callback => {
        callbacks.push(callback);
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      cancelSchedule: vi.fn()
    });

    await controller.start({ shots: 32, seed: 2026 });
    expect(controller.view.state).toBe('running');
    expect(controller.active).toBe(true);
    expect(callbacks).toHaveLength(1);

    callbacks.shift()?.();
    await vi.waitFor(() => expect(controller.view.state).toBe('completed'));

    expect(controller.active).toBe(false);
    expect(controller.view.resultMime).toEqual(resultMime());
    expect(document.metadata.last_job).toMatchObject({
      job_id: 'jupyter_job.digital.test',
      state: 'completed'
    });
    expect(applyMetadata).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.map(call => call[2])).toEqual([
      'start_job',
      'job_status'
    ]);
  });

  it('distinguishes a cancellation request from the observed cancelled state', async () => {
    let document = readyDocument();
    const request = vi.fn(async (
      _documentId: string,
      _revision: number,
      operation: Operation
    ) => response(jobPayload(
      document,
      operation === 'cancel_job' ? 'cancelled' : 'queued',
      null,
      operation === 'cancel_job'
    )));
    const controller = new JobController({
      panel: () => panel(),
      document: () => document,
      acceptDocument: value => {
        document = value as typeof document;
      },
      changed: vi.fn(),
      bridge: {
        context: vi.fn(() => ({ cellId: 'cell-1', source: 'source' })),
        applyMetadata: vi.fn()
      } as unknown as NotebookBridge,
      client: {
        connect: vi.fn(async () => undefined),
        request
      } as unknown as KernelClient,
      schedule: () => 1 as unknown as ReturnType<typeof setTimeout>,
      cancelSchedule: vi.fn()
    });

    await controller.start({ shots: 16, seed: 7 });
    expect(controller.active).toBe(true);
    await controller.cancel();

    expect(controller.view.cancelRequested).toBe(true);
    expect(controller.view.state).toBe('cancelled');
    expect(controller.view.message).toBe('Local Job cancelled.');
    expect(controller.active).toBe(false);
  });

  it('restores the last Job identity without treating it as a live kernel Job', () => {
    const document = readyDocument();
    document.compile_status = 'running';
    document.metadata.last_job = {
      job_id: 'jupyter_job.digital.saved',
      state: 'running',
      cancel_requested: true
    };
    const controller = new JobController({
      panel: () => null,
      document: () => document,
      acceptDocument: vi.fn(),
      changed: vi.fn(),
      bridge: {} as NotebookBridge,
      client: {} as KernelClient
    });

    expect(controller.view).toMatchObject({
      jobId: 'jupyter_job.digital.saved',
      state: 'running',
      cancelRequested: true
    });
    expect(controller.active).toBe(false);
  });

  it('invalidates the previous result when the editor document changes', async () => {
    let document = readyDocument();
    const callbacks: Array<() => void> = [];
    const changed = vi.fn();
    const cancelSchedule = vi.fn();
    const controller = new JobController({
      panel: () => panel(),
      document: () => document,
      acceptDocument: value => {
        document = value as typeof document;
      },
      changed,
      bridge: {
        context: vi.fn(() => ({ cellId: 'cell-1', source: 'source' })),
        applyMetadata: vi.fn()
      } as unknown as NotebookBridge,
      client: {
        connect: vi.fn(async () => undefined),
        request: vi.fn(async () => response(jobPayload(document, 'running')))
      } as unknown as KernelClient,
      schedule: callback => {
        callbacks.push(callback);
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      cancelSchedule
    });
    await controller.start({ shots: 32, seed: 2026 });
    expect(controller.active).toBe(true);

    controller.markDocumentChanged();

    expect(controller.active).toBe(false);
    expect(controller.view).toMatchObject({
      state: null,
      jobId: null,
      resultMime: null,
      message: 'Program changed; synchronize the generated cell before running.'
    });
    expect(cancelSchedule).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenCalled();
  });
});

function readyDocument(): DigitalEditorDocument {
  return {
    ...createDigitalDocument(() => 'document.digital.job-test'),
    generated_cell_id: 'cell-1',
    generated_source_hash: 'a'.repeat(64),
    source_program_hash: 'b'.repeat(64),
    compile_status: 'ready' as const
  };
}

function panel(): NotebookPanel {
  return {
    sessionContext: {
      ready: Promise.resolve(),
      session: { kernel: { id: 'kernel-1' } }
    }
  } as unknown as NotebookPanel;
}

function jobPayload(
  sourceDocument: ReturnType<typeof readyDocument>,
  state: string,
  result: unknown = null,
  cancelRequested = false
): Record<string, unknown> {
  const lastJob = {
    schema_version: '1.0',
    job_id: 'jupyter_job.digital.test',
    state,
    cancel_requested: cancelRequested,
    result: state === 'completed'
      ? { result_id: 'result.test', result_hash: 'c'.repeat(64) }
      : null
  };
  const document = {
    ...sourceDocument,
    compile_status: state,
    metadata: { ...sourceDocument.metadata, last_job: lastJob }
  };
  return {
    document,
    cell_metadata: {
      cascaqit_jupyter: {
        schema_version: '1.0',
        document_id: document.document_id,
        editor_document: document
      }
    },
    job: lastJob,
    result_mime: result,
    diagnostics: []
  };
}

function resultMime(): Record<string, unknown> {
  return {
    protocol_version: '1.0',
    kind: 'result',
    source: { id: 'result.test', hash: 'c'.repeat(64) },
    data: { result_id: 'result.test', shots: 32, counts: { '00': 32 } }
  };
}

function response(payload: Record<string, unknown>): CommResponse {
  return {
    schema_version: '1.0',
    message_type: 'response',
    request_id: 'request-1',
    document_id: 'document.digital.job-test',
    document_revision: 0,
    kernel_epoch: 'epoch-1',
    status: 'ok',
    payload,
    error: null
  };
}
