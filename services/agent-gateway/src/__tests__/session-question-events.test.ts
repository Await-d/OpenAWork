import { describe, expect, it } from 'vitest';

import {
  createQuestionAskedEvent,
  createQuestionRepliedEvent,
} from '../session-question-events.js';

describe('session question events', () => {
  it('creates a question_asked run event', () => {
    expect(
      createQuestionAskedEvent({
        requestId: 'question-1',
        title: '选择目录',
        toolName: 'question',
        occurredAt: 123,
      }),
    ).toEqual({
      type: 'question_asked',
      requestId: 'question-1',
      title: '选择目录',
      toolName: 'question',
      eventId: 'question:question-1:asked',
      runId: 'question:question-1',
      occurredAt: 123,
    });
  });

  it('creates a question_replied run event', () => {
    expect(
      createQuestionRepliedEvent({
        requestId: 'question-1',
        status: 'answered',
        occurredAt: 456,
      }),
    ).toEqual({
      type: 'question_replied',
      requestId: 'question-1',
      status: 'answered',
      eventId: 'question:question-1:replied',
      runId: 'question:question-1',
      occurredAt: 456,
    });
  });
});
