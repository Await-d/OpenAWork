import { describe, expect, it } from 'vitest';

import { buildToolResultContent, buildToolResultRunEvent } from '../tool-result-contract.js';

describe('tool-result-contract', () => {
  it('builds canonical durable tool_result content', () => {
    expect(
      buildToolResultContent({
        toolCallId: 'call-1',
        toolName: 'write',
        output: { ok: true },
        isError: false,
      }),
    ).toEqual({
      type: 'tool_result',
      toolCallId: 'call-1',
      toolName: 'write',
      output: { ok: true },
      isError: false,
    });
  });

  it('builds canonical run events with the same payload core', () => {
    expect(
      buildToolResultRunEvent({
        toolCallId: 'call-1',
        toolName: 'task',
        output: 'done',
        isError: false,
        pendingPermissionRequestId: 'perm-1',
        eventMeta: {
          eventId: 'evt-1',
          runId: 'run-1',
          occurredAt: 1,
        },
      }),
    ).toEqual({
      type: 'tool_result',
      toolCallId: 'call-1',
      toolName: 'task',
      output: 'done',
      isError: false,
      pendingPermissionRequestId: 'perm-1',
      eventId: 'evt-1',
      runId: 'run-1',
      occurredAt: 1,
    });
  });
});
