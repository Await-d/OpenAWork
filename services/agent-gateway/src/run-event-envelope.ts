import type {
  RunEvent,
  RunEventBookend,
  RunEventCursor,
  RunEventEnvelope,
} from '@openAwork/shared';

export function deriveRunEventBookend(event: RunEvent): RunEventBookend | undefined {
  switch (event.type) {
    case 'done':
      if (event.stopReason === 'tool_use') {
        return {
          kind: 'tool_handoff',
          terminal: false,
          replayable: false,
          stopReason: event.stopReason,
        };
      }

      if (event.stopReason === 'tool_permission') {
        return {
          kind: 'permission_paused',
          terminal: false,
          replayable: true,
          stopReason: event.stopReason,
        };
      }

      if (event.stopReason === 'cancelled') {
        return {
          kind: 'run_cancelled',
          terminal: true,
          replayable: true,
          stopReason: event.stopReason,
        };
      }

      return {
        kind: 'run_completed',
        terminal: true,
        replayable: true,
        stopReason: event.stopReason,
      };
    case 'error':
      return {
        kind: 'run_failed',
        terminal: true,
        replayable: true,
      };
    case 'permission_asked':
      return {
        kind: 'interaction_wait',
        terminal: false,
        replayable: true,
        interactionType: 'permission',
        requestId: event.requestId,
      };
    case 'question_asked':
      return {
        kind: 'interaction_wait',
        terminal: false,
        replayable: true,
        interactionType: 'question',
        requestId: event.requestId,
      };
    case 'permission_replied':
      return {
        kind: 'interaction_resumed',
        terminal: false,
        replayable: false,
        interactionType: 'permission',
        requestId: event.requestId,
      };
    case 'question_replied':
      return {
        kind: 'interaction_resumed',
        terminal: false,
        replayable: false,
        interactionType: 'question',
        requestId: event.requestId,
      };
    default:
      return undefined;
  }
}

export function isTerminalRunEvent(event: RunEvent): boolean {
  return deriveRunEventBookend(event)?.terminal === true;
}

export function buildRunEventEnvelope(input: {
  aggregateId: string;
  aggregateType: RunEventEnvelope['aggregateType'];
  causationId?: string;
  clientRequestId?: string;
  cursor?: RunEventCursor;
  event: RunEvent;
  outputOffset: number;
  seq: number;
  timestamp: number;
  version?: number;
}): RunEventEnvelope {
  const bookend = deriveRunEventBookend(input.event);
  return {
    eventId: input.event.eventId ?? `${input.aggregateId}:evt:${input.seq}`,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    seq: input.seq,
    version: input.version ?? 1,
    ...(input.causationId ? { causationId: input.causationId } : {}),
    timestamp: input.timestamp,
    payload: {
      ...(input.clientRequestId ? { clientRequestId: input.clientRequestId } : {}),
      ...(input.cursor ? { cursor: input.cursor } : {}),
      deliveryState: 'delivered',
      outputOffset: input.outputOffset,
      ...(bookend ? { bookend } : {}),
      event: input.event,
    },
  };
}
