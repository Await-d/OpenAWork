import { describe, expect, it, vi } from 'vitest';

import { buildStreamUsageChunk } from '../routes/stream-usage-event.js';

vi.mock('../routes/stream.js', () => ({
  createRunEventMeta: vi.fn((_runId: string, sequence: { value: number }) => {
    const eventId = `evt-${sequence.value}`;
    sequence.value += 1;
    return {
      eventId,
      runId: 'run-1',
      occurredAt: 123,
    };
  }),
}));

describe('buildStreamUsageChunk', () => {
  it('builds a normalized usage run event with run metadata', () => {
    expect(
      buildStreamUsageChunk({
        eventSequence: { value: 4 },
        round: 2,
        runId: 'run-1',
        usage: {
          inputTokens: 48_000,
          outputTokens: 2_000,
          totalTokens: 50_000,
        },
      }),
    ).toEqual({
      type: 'usage',
      inputTokens: 48_000,
      outputTokens: 2_000,
      totalTokens: 50_000,
      round: 2,
      eventId: 'evt-4',
      runId: 'run-1',
      occurredAt: 123,
    });
  });
});
