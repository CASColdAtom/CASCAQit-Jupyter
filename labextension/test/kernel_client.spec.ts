import { describe, expect, it } from 'vitest';

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

function fakeKernel(comm: FakeComm): KernelConnection {
  return {
    id: 'kernel-1',
    requestExecute: (() => ({
      done: Promise.resolve({ content: { status: 'ok' } })
    })) as unknown as KernelConnection['requestExecute'],
    createComm: (() => comm) as unknown as KernelConnection['createComm']
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
