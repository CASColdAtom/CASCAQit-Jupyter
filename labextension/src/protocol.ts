export const COMM_SCHEMA_VERSION = '1.0';

export type Operation =
  | 'ping'
  | 'validate_document'
  | 'compile_digital'
  | 'compile_analog'
  | 'cancel';

export interface CommRequest {
  schema_version: '1.0';
  message_type: 'request';
  request_id: string;
  document_id: string;
  document_revision: number;
  kernel_epoch: string;
  operation: Operation;
  timeout_ms: number;
  payload: Record<string, unknown>;
}

export interface ProtocolError {
  code: string;
  message: string;
  stage: 'protocol' | 'validation' | 'kernel';
  object_path: string | null;
  suggestion: string | null;
  retryable: boolean;
  details: Record<string, unknown>;
}

export interface CommResponse {
  schema_version: '1.0';
  message_type: 'response';
  request_id: string;
  document_id: string;
  document_revision: number;
  kernel_epoch: string;
  status: 'ok' | 'error';
  payload: Record<string, unknown>;
  error: ProtocolError | null;
}

export interface KernelReadyEvent {
  schema_version: '1.0';
  message_type: 'event';
  document_id: '__kernel__';
  document_revision: 0;
  kernel_epoch: string;
  event: 'kernel_ready';
  payload: Record<string, unknown>;
}

export type RejectionReason =
  | 'invalid_response'
  | 'unknown_request'
  | 'stale_kernel_epoch'
  | 'document_mismatch'
  | 'stale_document_revision';

export type ResponseDecision =
  | { accepted: true; response: CommResponse }
  | { accepted: false; reason: RejectionReason };

interface PendingRequest {
  request: CommRequest;
  expiresAt: number;
}

export interface RequestTrackerOptions {
  now?: () => number;
  requestId?: () => string;
}

export class RequestTracker {
  constructor(options: RequestTrackerOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.requestId = options.requestId ?? defaultRequestId;
  }

  get kernelEpoch(): string | null {
    return this.epoch;
  }

  onKernelReady(event: KernelReadyEvent): string[] {
    if (!isKernelReady(event)) {
      throw new Error('Invalid kernel_ready event.');
    }
    const invalidated = Array.from(
      new Set([...this.pending.keys(), ...this.timedOut.keys()])
    );
    this.pending.clear();
    this.timedOut.clear();
    this.epoch = event.kernel_epoch;
    return invalidated;
  }

  updateDocument(documentId: string, revision: number): void {
    requireDocument(documentId, revision);
    const current = this.latestRevisions.get(documentId) ?? -1;
    if (revision < current) {
      throw new Error('Document revisions must be monotonic.');
    }
    this.latestRevisions.set(documentId, revision);
  }

  begin(
    documentId: string,
    revision: number,
    operation: Operation,
    payload: Record<string, unknown>,
    timeoutMs = 30_000
  ): CommRequest {
    if (this.epoch === null) {
      throw new Error('Wait for kernel_ready before sending requests.');
    }
    requireDocument(documentId, revision);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 600_000) {
      throw new Error('timeoutMs must be an integer from 100 to 600000.');
    }
    this.updateDocument(documentId, revision);
    const request: CommRequest = {
      schema_version: COMM_SCHEMA_VERSION,
      message_type: 'request',
      request_id: this.requestId(),
      document_id: documentId,
      document_revision: revision,
      kernel_epoch: this.epoch,
      operation,
      timeout_ms: timeoutMs,
      payload: structuredClone(payload)
    };
    if (this.pending.has(request.request_id)) {
      throw new Error('requestId factory returned a duplicate ID.');
    }
    this.pending.set(request.request_id, {
      request,
      expiresAt: this.now() + timeoutMs
    });
    return request;
  }

  beginCancel(targetRequestId: string, timeoutMs = 5_000): CommRequest {
    const target =
      this.pending.get(targetRequestId) ?? this.timedOut.get(targetRequestId);
    if (target === undefined) {
      throw new Error('Only a pending or timed-out request can be cancelled.');
    }
    const revision =
      this.latestRevisions.get(target.request.document_id) ??
      target.request.document_revision;
    return this.begin(
      target.request.document_id,
      revision,
      'cancel',
      { target_request_id: targetRequestId },
      timeoutMs
    );
  }

  accept(value: unknown): ResponseDecision {
    if (!isResponse(value)) {
      return { accepted: false, reason: 'invalid_response' };
    }
    const pending = this.pending.get(value.request_id);
    if (pending === undefined) {
      this.timedOut.delete(value.request_id);
      return { accepted: false, reason: 'unknown_request' };
    }
    if (value.kernel_epoch !== this.epoch) {
      return { accepted: false, reason: 'stale_kernel_epoch' };
    }
    if (
      value.document_id !== pending.request.document_id ||
      value.document_revision !== pending.request.document_revision
    ) {
      this.pending.delete(value.request_id);
      return { accepted: false, reason: 'document_mismatch' };
    }
    this.pending.delete(value.request_id);
    const latest = this.latestRevisions.get(value.document_id);
    if (latest !== value.document_revision) {
      return { accepted: false, reason: 'stale_document_revision' };
    }
    return { accepted: true, response: value };
  }

  expire(): string[] {
    const now = this.now();
    const expired: string[] = [];
    for (const [requestId, pending] of this.pending) {
      if (pending.expiresAt <= now) {
        expired.push(requestId);
        this.pending.delete(requestId);
        this.timedOut.set(requestId, pending);
      }
    }
    return expired;
  }

  private epoch: string | null = null;
  private readonly latestRevisions = new Map<string, number>();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly timedOut = new Map<string, PendingRequest>();
  private readonly now: () => number;
  private readonly requestId: () => string;
}

function isKernelReady(value: unknown): value is KernelReadyEvent {
  return (
    isRecord(value) &&
    value.schema_version === COMM_SCHEMA_VERSION &&
    value.message_type === 'event' &&
    value.event === 'kernel_ready' &&
    typeof value.kernel_epoch === 'string' &&
    value.kernel_epoch.length > 0
  );
}

function isResponse(value: unknown): value is CommResponse {
  return (
    isRecord(value) &&
    value.schema_version === COMM_SCHEMA_VERSION &&
    value.message_type === 'response' &&
    typeof value.request_id === 'string' &&
    typeof value.document_id === 'string' &&
    Number.isInteger(value.document_revision) &&
    typeof value.kernel_epoch === 'string' &&
    (value.status === 'ok' || value.status === 'error') &&
    isRecord(value.payload)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireDocument(documentId: string, revision: number): void {
  if (documentId.length === 0) {
    throw new Error('documentId must be non-empty.');
  }
  if (!Number.isInteger(revision) || revision < 0) {
    throw new Error('revision must be a non-negative integer.');
  }
}

function defaultRequestId(): string {
  return globalThis.crypto.randomUUID();
}
