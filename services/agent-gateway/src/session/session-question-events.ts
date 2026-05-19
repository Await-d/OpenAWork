import type { RunEvent } from '@openAwork/shared';

export function createQuestionAskedEvent(input: {
  occurredAt?: number;
  requestId: string;
  title: string;
  toolName: string;
}): Extract<RunEvent, { type: 'question_asked' }> {
  return {
    type: 'question_asked',
    requestId: input.requestId,
    title: input.title,
    toolName: input.toolName,
    eventId: `question:${input.requestId}:asked`,
    runId: `question:${input.requestId}`,
    occurredAt: input.occurredAt ?? Date.now(),
  };
}

export function createQuestionRepliedEvent(input: {
  occurredAt?: number;
  requestId: string;
  status: 'answered' | 'dismissed';
}): Extract<RunEvent, { type: 'question_replied' }> {
  return {
    type: 'question_replied',
    requestId: input.requestId,
    status: input.status,
    eventId: `question:${input.requestId}:replied`,
    runId: `question:${input.requestId}`,
    occurredAt: input.occurredAt ?? Date.now(),
  };
}
