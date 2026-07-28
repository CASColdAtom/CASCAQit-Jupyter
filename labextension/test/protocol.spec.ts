import { describe, expect, it } from 'vitest';

import {
  COMM_SCHEMA_VERSION,
  CommRequest,
  CommResponse,
  KernelReadyEvent,
  RequestTracker
} from '../src/protocol';

function ready(epoch: string): KernelReadyEvent {
  return {
    schema_version: COMM_SCHEMA_VERSION,
    message_type: 'event',
    document_id: '__kernel__',
    document_revision: 0,
    kernel_epoch: epoch,
    event: 'kernel_ready',
    payload: {}
  };
}

function response(request: CommRequest): CommResponse {
  return {
    schema_version: COMM_SCHEMA_VERSION,
    message_type: 'response',
    request_id: request.request_id,
    document_id: request.document_id,
    document_revision: request.document_revision,
    kernel_epoch: request.kernel_epoch,
    status: 'ok',
    payload: {},
    error: null
  };
}

describe('RequestTracker', () => {
  it('requires the kernel epoch handshake', () => {
    const tracker = new RequestTracker({ requestId: () => 'request-1' });
    expect(() => tracker.begin('document-1', 0, 'ping', {})).toThrow(
      'kernel_ready'
    );
    expect(tracker.onKernelReady(ready('epoch-1'))).toEqual([]);
    expect(tracker.begin('document-1', 0, 'ping', {}).kernel_epoch).toBe(
      'epoch-1'
    );
  });

  it('rejects a response after the document advances', () => {
    const ids = ['request-1'];
    const tracker = new RequestTracker({ requestId: () => ids.shift()! });
    tracker.onKernelReady(ready('epoch-1'));
    const request = tracker.begin('document-1', 1, 'validate_document', {});
    tracker.updateDocument('document-1', 2);

    expect(tracker.accept(response(request))).toEqual({
      accepted: false,
      reason: 'stale_document_revision'
    });
  });

  it('invalidates pending requests when the kernel restarts', () => {
    const tracker = new RequestTracker({ requestId: () => 'request-1' });
    tracker.onKernelReady(ready('epoch-1'));
    const request = tracker.begin('document-1', 0, 'ping', {});

    expect(tracker.onKernelReady(ready('epoch-2'))).toEqual(['request-1']);
    expect(tracker.accept(response(request))).toEqual({
      accepted: false,
      reason: 'unknown_request'
    });
  });

  it('expires requests deterministically', () => {
    const ids = ['request-1', 'cancel-1'];
    let now = 1_000;
    const tracker = new RequestTracker({
      now: () => now,
      requestId: () => ids.shift()!
    });
    tracker.onKernelReady(ready('epoch-1'));
    tracker.begin('document-1', 0, 'ping', {}, 100);

    now = 1_099;
    expect(tracker.expire()).toEqual([]);
    now = 1_100;
    expect(tracker.expire()).toEqual(['request-1']);
    tracker.updateDocument('document-1', 1);
    const cancel = tracker.beginCancel('request-1');
    expect(cancel.document_revision).toBe(1);
    expect(cancel.payload).toEqual({ target_request_id: 'request-1' });
  });

  it('creates a cooperative cancel request for a pending operation', () => {
    const ids = ['run-1', 'cancel-1'];
    const tracker = new RequestTracker({ requestId: () => ids.shift()! });
    tracker.onKernelReady(ready('epoch-1'));
    tracker.begin('document-1', 3, 'validate_document', {});
    tracker.updateDocument('document-1', 4);

    const cancel = tracker.beginCancel('run-1');

    expect(cancel.operation).toBe('cancel');
    expect(cancel.payload).toEqual({ target_request_id: 'run-1' });
    expect(cancel.document_revision).toBe(4);
  });
});
