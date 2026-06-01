import { describe, expect, it } from 'vitest';
import type { PendingQuestionRequest } from '@openAwork/web-client';
import {
  mergePendingQuestion,
  selectPendingQuestionForRequest,
} from './select-pending-question.js';

const SESSION_ID = 'sess-select-pending-question';

function makeQuestion(
  requestId: string,
  status: PendingQuestionRequest['status'] = 'pending',
): PendingQuestionRequest {
  return {
    requestId,
    sessionId: SESSION_ID,
    toolName: 'AskUserQuestion',
    title: `title-${requestId}`,
    status,
    createdAt: '2026-05-31T00:00:00.000Z',
    questions: [
      {
        header: 'H',
        question: 'pick one',
        multiple: false,
        options: [
          { label: 'A', description: 'opt a' },
          { label: 'B', description: 'opt b' },
        ],
      },
    ],
  };
}

describe('selectPendingQuestionForRequest', () => {
  it('returns the exact requestId match when it is pending', () => {
    const list = [
      makeQuestion('q-other'),
      makeQuestion('q-target'),
      makeQuestion('q-done', 'answered'),
    ];
    expect(selectPendingQuestionForRequest(list, 'q-target')?.requestId).toBe('q-target');
  });

  it('falls back to the first pending when the requestId is not found', () => {
    const list = [makeQuestion('q-done', 'answered'), makeQuestion('q-first'), makeQuestion('q-2')];
    expect(selectPendingQuestionForRequest(list, 'missing')?.requestId).toBe('q-first');
  });

  it('ignores a same-requestId entry that is no longer pending and falls back', () => {
    const list = [makeQuestion('q-target', 'answered'), makeQuestion('q-live')];
    // q-target exists but is answered → skip exact match, take first pending.
    expect(selectPendingQuestionForRequest(list, 'q-target')?.requestId).toBe('q-live');
  });

  it('returns null when there is no pending question at all', () => {
    const list = [makeQuestion('q-a', 'answered'), makeQuestion('q-b', 'dismissed')];
    expect(selectPendingQuestionForRequest(list, 'q-a')).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(selectPendingQuestionForRequest([], 'anything')).toBeNull();
  });
});

describe('mergePendingQuestion', () => {
  it('prepends a brand-new question', () => {
    const previous = [makeQuestion('q-old')];
    const next = makeQuestion('q-new');
    const merged = mergePendingQuestion(previous, next);
    expect(merged.map((q) => q.requestId)).toEqual(['q-new', 'q-old']);
  });

  it('replaces an existing entry with the same requestId and moves it to the front', () => {
    const previous = [makeQuestion('q-1'), makeQuestion('q-2')];
    const refreshed = makeQuestion('q-2');
    const merged = mergePendingQuestion(previous, refreshed);
    // No duplicate, refreshed q-2 is now first.
    expect(merged.map((q) => q.requestId)).toEqual(['q-2', 'q-1']);
    expect(merged.filter((q) => q.requestId === 'q-2')).toHaveLength(1);
    expect(merged[0]).toBe(refreshed);
  });

  it('does not mutate the previous array', () => {
    const previous = [makeQuestion('q-1')];
    const snapshot = [...previous];
    mergePendingQuestion(previous, makeQuestion('q-2'));
    expect(previous).toEqual(snapshot);
  });
});
