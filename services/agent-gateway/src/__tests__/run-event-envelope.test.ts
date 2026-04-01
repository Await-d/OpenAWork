import { describe, expect, it } from 'vitest';

import { buildRunEventEnvelope, deriveRunEventBookend } from '../run-event-envelope.js';

describe('run event envelope', () => {
  it('marks waiting interactions as replayable bookends', () => {
    expect(
      deriveRunEventBookend({
        type: 'question_asked',
        requestId: 'question-1',
        toolName: 'question',
        title: 'Need approval',
      }),
    ).toEqual({
      kind: 'interaction_wait',
      terminal: false,
      replayable: true,
      interactionType: 'question',
      requestId: 'question-1',
    });
  });

  it('marks resumed interactions as non-replayable bookends', () => {
    expect(
      deriveRunEventBookend({
        type: 'permission_replied',
        requestId: 'perm-1',
        decision: 'once',
      }),
    ).toEqual({
      kind: 'interaction_resumed',
      terminal: false,
      replayable: false,
      interactionType: 'permission',
      requestId: 'perm-1',
    });
  });

  it('builds a fusion-native envelope with cursor, output offset, and bookend', () => {
    expect(
      buildRunEventEnvelope({
        aggregateId: 'run-1',
        aggregateType: 'run',
        clientRequestId: 'req-1',
        cursor: { clientRequestId: 'req-1', seq: 4 },
        event: {
          type: 'done',
          stopReason: 'end_turn',
          eventId: 'evt-4',
          runId: 'run-1',
          occurredAt: 123,
        },
        outputOffset: 4,
        seq: 4,
        timestamp: 123,
      }),
    ).toEqual({
      eventId: 'evt-4',
      aggregateType: 'run',
      aggregateId: 'run-1',
      seq: 4,
      version: 1,
      timestamp: 123,
      payload: {
        clientRequestId: 'req-1',
        cursor: { clientRequestId: 'req-1', seq: 4 },
        deliveryState: 'delivered',
        outputOffset: 4,
        bookend: {
          kind: 'run_completed',
          terminal: true,
          replayable: true,
          stopReason: 'end_turn',
        },
        event: {
          type: 'done',
          stopReason: 'end_turn',
          eventId: 'evt-4',
          runId: 'run-1',
          occurredAt: 123,
        },
      },
    });
  });
});
