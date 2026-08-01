import type { Kernel } from '@jupyterlab/services';

import {
  CommRequest,
  CommResponse,
  KernelReadyEvent,
  Operation,
  RequestTracker
} from './protocol';

const COMM_TARGET = 'cascaqit.jupyter.v1';
const REGISTER_CODE =
  'from cascaqit_jupyter import register_kernel_comm\nregister_kernel_comm()';

export interface KernelConnection {
  readonly id: string;
  requestExecute: Kernel.IKernelConnection['requestExecute'];
  createComm: Kernel.IKernelConnection['createComm'];
  statusChanged?: Kernel.IKernelConnection['statusChanged'];
}

interface PendingResponse {
  resolve: (response: CommResponse) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class KernelClient {
  constructor(
    private readonly tracker = new RequestTracker(),
    private readonly handshakeTimeoutMs = 10_000,
    private readonly connectionProbeTimeoutMs = 2_000
  ) {}

  get connectedKernelId(): string | null {
    return this.kernelId;
  }

  async connect(kernel: KernelConnection): Promise<void> {
    if (this.kernelId === kernel.id && this.comm !== null) {
      try {
        const response = await this.request(
          '__kernel__',
          0,
          'ping',
          {},
          this.connectionProbeTimeoutMs
        );
        if (response.status === 'ok') {
          return;
        }
      } catch {
        // A restarted kernel can retain its Jupyter ID while invalidating every comm.
      }
    }
    this.disconnect('Kernel connection changed.');
    this.kernelId = kernel.id;
    this.kernel = kernel;
    kernel.statusChanged?.connect(this.handleKernelStatus, this);

    let reply: Awaited<ReturnType<KernelConnection['requestExecute']>['done']>;
    try {
      const registration = kernel.requestExecute({
        code: REGISTER_CODE,
        silent: true,
        store_history: false,
        user_expressions: {},
        allow_stdin: false,
        stop_on_error: true
      });
      reply = await registration.done;
    } catch (error) {
      this.disconnect('CASCAQit kernel companion registration failed.');
      throw error;
    }
    if (reply.content.status !== 'ok') {
      this.disconnect('CASCAQit kernel companion registration failed.');
      throw new Error('CASCAQit kernel companion registration failed.');
    }
    if (this.kernel !== kernel || this.kernelId !== kernel.id) {
      throw new Error('CASCAQit kernel connection changed during registration.');
    }

    const comm = kernel.createComm(COMM_TARGET);
    this.comm = comm;
    const ready = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const error = new Error('Timed out waiting for CASCAQit kernel_ready.');
        this.disconnect(error.message);
        reject(error);
      }, this.handshakeTimeoutMs);
      comm.onMsg = message => {
        const data = message.content.data;
        if (isKernelReady(data)) {
          clearTimeout(timeout);
          this.handleKernelReady(data);
          resolve();
          return;
        }
        this.handleResponse(data);
      };
      comm.onClose = () => {
        clearTimeout(timeout);
        const error = new Error('CASCAQit kernel comm closed.');
        this.disconnect(error.message);
        reject(error);
      };
    });
    comm.open({ client: '@cascaqit/jupyter', schema_version: '1.0' });
    await ready;
  }

  async request(
    documentId: string,
    revision: number,
    operation: Operation,
    payload: Record<string, unknown>,
    timeoutMs = 30_000
  ): Promise<CommResponse> {
    if (this.comm === null) {
      throw new Error('CASCAQit kernel comm is not connected.');
    }
    const request = this.tracker.begin(
      documentId,
      revision,
      operation,
      payload,
      timeoutMs
    );
    const response = new Promise<CommResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.tracker.expire();
        this.pending.delete(request.request_id);
        reject(new Error(`CASCAQit request timed out: ${operation}`));
      }, timeoutMs);
      this.pending.set(request.request_id, { resolve, reject, timeout });
    });
    this.comm.send(
      request as unknown as Parameters<Kernel.IComm['send']>[0]
    );
    return response;
  }

  disconnect(message = 'CASCAQit kernel client disconnected.'): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(message));
    }
    this.pending.clear();
    const comm = this.comm;
    const kernel = this.kernel;
    this.comm = null;
    this.kernel = null;
    this.kernelId = null;
    kernel?.statusChanged?.disconnect(this.handleKernelStatus, this);
    comm?.dispose();
  }

  private handleKernelStatus(
    _kernel: Kernel.IKernelConnection,
    status: Kernel.Status
  ): void {
    if (['restarting', 'autorestarting', 'dead'].includes(status)) {
      this.disconnect(`CASCAQit kernel became ${status}.`);
    }
  }

  private handleKernelReady(event: KernelReadyEvent): void {
    const invalidated = this.tracker.onKernelReady(event);
    for (const requestId of invalidated) {
      const pending = this.pending.get(requestId);
      if (pending !== undefined) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('Kernel restarted before the request completed.'));
        this.pending.delete(requestId);
      }
    }
  }

  private handleResponse(value: unknown): void {
    const decision = this.tracker.accept(value);
    if (!decision.accepted) {
      return;
    }
    const pending = this.pending.get(decision.response.request_id);
    if (pending === undefined) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pending.delete(decision.response.request_id);
    pending.resolve(decision.response);
  }

  private kernelId: string | null = null;
  private kernel: KernelConnection | null = null;
  private comm: Kernel.IComm | null = null;
  private readonly pending = new Map<string, PendingResponse>();
}

function isKernelReady(value: unknown): value is KernelReadyEvent {
  return (
    typeof value === 'object' &&
    value !== null &&
    Reflect.get(value, 'schema_version') === '1.0' &&
    Reflect.get(value, 'message_type') === 'event' &&
    Reflect.get(value, 'event') === 'kernel_ready' &&
    typeof Reflect.get(value, 'kernel_epoch') === 'string'
  );
}
