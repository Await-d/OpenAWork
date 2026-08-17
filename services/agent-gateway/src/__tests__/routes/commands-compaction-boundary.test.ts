import { describe, expect, it } from 'vitest';
import { __testing } from '../../routes/commands.js';

describe('commands compaction boundary', () => {
  it('does not propagate an in-progress compaction as a completed command', () => {
    let thrown: unknown;

    try {
      __testing.requireCompactionSummary({
        durableSummary: null,
        llmErrorMessage: 'compaction request is in progress; retry this request',
        metadata: {},
        metadataJson: '{}',
        retryable: true,
      });
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      statusCode: 409,
      response: {
        data: {
          message: 'compaction request is in progress; retry this request',
        },
      },
    });
  });
});
