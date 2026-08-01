import { describe, expect, it } from 'vitest';
import type { Kernel } from '@jupyterlab/services';

import { KernelClient, KernelConnection } from '../src/kernel_client';
import { CommRequest, KernelReadyEvent } from '../src/protocol';

class FakeComm {
  onMsg: (message: any) => void = () => undefined;
  onClose: (message: any) => void = () => undefined;
  readonly sent: CommRequest[] = [];
  autoReady = true;
  autoRespond = true;
  disposed = false;

  open(): void {
    if (this.autoReady) {
      queueMicrotask(() => this.ready('epoch-1'));
    }
  }

  send(value: unknown): void {
    const request = value as CommRequest;
    this.sent.push(request);
    if (this.autoRespond) {
      queueMicrotask(() => {
        this.onMsg({
          content: {
            data: {
              schema_version: '1.0',
              message_type: 'response',
              request_id: request.request_id,
              document_id: request.document_id,
              document_revision: request.document_revision,
              kernel_epoch: request.kernel_epoch,
              status: 'ok',
              payload: { alive: true },
              error: null
            }
          }
        });
      });
    }
  }

  ready(epoch: string): void {
    const event: KernelReadyEvent = {
      schema_version: '1.0',
      message_type: 'event',
      document_id: '__kernel__',
      document_revision: 0,
      kernel_epoch: epoch,
      event: 'kernel_ready',
      payload: {}
    };
    this.onMsg({ content: { data: event } });
  }

  dispose(): void {
    this.disposed = true;
  }
}

class FakeStatusSignal {
  get size(): number {
    return this.slots.length;
  }

  connect(
    slot: (sender: Kernel.IKernelConnection, status: Kernel.Status) => void,
    thisArg?: unknown
  ): boolean {
    this.slots.push({ slot, thisArg });
    return true;
  }

  disconnect(
    slot: (sender: Kernel.IKernelConnection, status: Kernel.Status) => void,
    thisArg?: unknown
  ): boolean {
    const index = this.slots.findIndex(
      candidate => candidate.slot === slot && candidate.thisArg === thisArg
    );
    if (index === -1) {
      return false;
    }
    this.slots.splice(index, 1);
    return true;
  }

  emit(sender: KernelConnection, status: Kernel.Status): void {
    for (const { slot, thisArg } of [...this.slots]) {
      slot.call(thisArg, sender as Kernel.IKernelConnection, status);
    }
  }

  private readonly slots: Array<{
    slot: (sender: Kernel.IKernelConnection, status: Kernel.Status) => void;
    thisArg?: unknown;
  }> = [];
}

function fakeKernel(
  comm: FakeComm,
  statusChanged?: FakeStatusSignal,
  registrationStatus: 'ok' | 'error' = 'ok'
): KernelConnection {
  return {
    id: 'kernel-1',
    requestExecute: (() => ({
      done: Promise.resolve({ content: { status: registrationStatus } })
    })) as unknown as KernelConnection['requestExecute'],
    createComm: (() => comm) as unknown as KernelConnection['createComm'],
    statusChanged: statusChanged as unknown as KernelConnection['statusChanged']
  };
}

describe('KernelClient', () => {
  it('registers the companion, waits for kernel_ready, and resolves a response', async () => {
    const comm = new FakeComm();
    const client = new KernelClient(undefined, 1000);
    await client.connect(fakeKernel(comm));

    const response = await client.request('document-1', 0, 'ping', {});

    expect(response.status).toBe('ok');
    expect(comm.sent[0].kernel_epoch).toBe('epoch-1');
  });

  it('rejects pending work when a new kernel epoch arrives', async () => {
    const comm = new FakeComm();
    comm.autoRespond = false;
    const client = new KernelClient(undefined, 1000);
    await client.connect(fakeKernel(comm));
    const pending = client.request('document-1', 1, 'compile_digital', {});

    comm.ready('epoch-2');

    await expect(pending).rejects.toThrow('Kernel restarted');
  });

  it('discards the comm when Jupyter restarts a kernel with the same ID', async () => {
    const statusChanged = new FakeStatusSignal();
    const stale = new FakeComm();
    const kernel = fakeKernel(stale, statusChanged);
    const client = new KernelClient(undefined, 1000);
    await client.connect(kernel);

    statusChanged.emit(kernel, 'restarting');

    expect(client.connectedKernelId).toBeNull();
    expect(stale.disposed).toBe(true);
    const restarted = new FakeComm();
    await client.connect(fakeKernel(restarted, statusChanged));
    expect(client.connectedKernelId).toBe('kernel-1');
  });

  it('replaces an unresponsive comm when the kernel ID is reused', async () => {
    const stale = new FakeComm();
    stale.autoRespond = false;
    const client = new KernelClient(undefined, 1000, 10);
    await client.connect(fakeKernel(stale));
    const replacement = new FakeComm();

    await client.connect(fakeKernel(replacement));

    expect(stale.disposed).toBe(true);
    expect(client.connectedKernelId).toBe('kernel-1');
    const response = await client.request('document-1', 0, 'ping', {});
    expect(response.status).toBe('ok');
  });

  it('removes the kernel status listener when companion registration fails', async () => {
    const statusChanged = new FakeStatusSignal();
    const client = new KernelClient(undefined, 1000);

    await expect(
      client.connect(fakeKernel(new FakeComm(), statusChanged, 'error'))
    ).rejects.toThrow('CASCAQit kernel companion registration failed.');

    expect(client.connectedKernelId).toBeNull();
    expect(statusChanged.size).toBe(0);
  });

  it('clears a timed-out handshake so the same kernel can reconnect', async () => {
    const stalled = new FakeComm();
    stalled.autoReady = false;
    const client = new KernelClient(undefined, 10);

    await expect(client.connect(fakeKernel(stalled))).rejects.toThrow(
      'Timed out waiting for CASCAQit kernel_ready.'
    );
    expect(client.connectedKernelId).toBeNull();
    expect(stalled.disposed).toBe(true);

    const retry = new FakeComm();
    await client.connect(fakeKernel(retry));
    expect(client.connectedKernelId).toBe('kernel-1');
  });
});
