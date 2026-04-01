import { describe, expect, it } from 'vitest';

import {
  createQuestionInteractionRecord,
  formatAnsweredQuestionOutput,
} from '../question-tools.js';

describe('question-tools interaction helpers', () => {
  it('builds a fusion-native question interaction record', () => {
    expect(
      createQuestionInteractionRecord({
        interactionId: 'question-1',
        runId: 'question:question-1',
        status: 'pending',
        toolName: 'question',
        questions: [
          {
            question: 'Choose one',
            header: 'Question',
            multiple: false,
            options: [
              { label: 'A', description: 'Option A' },
              { label: 'B', description: 'Option B' },
            ],
          },
        ],
      }),
    ).toEqual({
      interactionId: 'question-1',
      runId: 'question:question-1',
      type: 'question',
      channel: 'api',
      payload: {
        toolName: 'question',
        questions: [
          {
            question: 'Choose one',
            header: 'Question',
            multiple: false,
            options: [
              { label: 'A', description: 'Option A' },
              { label: 'B', description: 'Option B' },
            ],
          },
        ],
      },
      status: 'pending',
    });
  });

  it('formats answered question output without changing legacy output shape', () => {
    expect(
      formatAnsweredQuestionOutput({
        questions: [
          {
            question: 'Choose one',
            header: 'Question',
            multiple: false,
            options: [
              { label: 'A', description: 'Option A' },
              { label: 'B', description: 'Option B' },
            ],
          },
        ],
        answers: [['A']],
      }),
    ).toBe('Choose one="A"');
  });
});
