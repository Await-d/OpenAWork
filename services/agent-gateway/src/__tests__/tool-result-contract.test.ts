import { describe, expect, it } from 'vitest';

import { buildToolResultContent, buildToolResultRunEvent } from '../tool-result-contract.js';

describe('tool-result-contract', () => {
  it('builds canonical durable tool_result content', () => {
    expect(
      buildToolResultContent({
        toolCallId: 'call-1',
        toolName: 'write',
        clientRequestId: 'req-1',
        output: { ok: true },
        isError: false,
        fileDiffs: [
          {
            file: '/repo/a.ts',
            before: 'a',
            after: 'b',
            additions: 1,
            deletions: 1,
            status: 'modified',
            clientRequestId: 'req-1',
            toolCallId: 'call-1',
            toolName: 'write',
          },
        ],
        observability: {
          presentedToolName: 'Write',
          canonicalToolName: 'write',
          toolSurfaceProfile: 'claude_code_default',
          adapterVersion: '1.0.0',
        },
      }),
    ).toEqual({
      type: 'tool_result',
      toolCallId: 'call-1',
      toolName: 'write',
      clientRequestId: 'req-1',
      output: { ok: true },
      isError: false,
      fileDiffs: [
        {
          file: '/repo/a.ts',
          before: 'a',
          after: 'b',
          additions: 1,
          deletions: 1,
          status: 'modified',
          clientRequestId: 'req-1',
          toolCallId: 'call-1',
          toolName: 'write',
        },
      ],
      observability: {
        presentedToolName: 'Write',
        canonicalToolName: 'write',
        toolSurfaceProfile: 'claude_code_default',
        adapterVersion: '1.0.0',
      },
    });
  });

  it('builds canonical run events with the same payload core', () => {
    expect(
      buildToolResultRunEvent({
        toolCallId: 'call-1',
        toolName: 'Agent',
        clientRequestId: 'req-1',
        output: 'done',
        isError: false,
        fileDiffs: [
          {
            file: '/repo/task.md',
            before: '',
            after: 'done',
            additions: 1,
            deletions: 0,
            status: 'added',
            clientRequestId: 'req-1',
            toolCallId: 'call-1',
            toolName: 'Agent',
          },
        ],
        pendingPermissionRequestId: 'perm-1',
        observability: {
          presentedToolName: 'Agent',
          canonicalToolName: 'call_omo_agent',
          toolSurfaceProfile: 'claude_code_default',
          adapterVersion: '1.0.0',
        },
        eventMeta: {
          eventId: 'evt-1',
          runId: 'run-1',
          occurredAt: 1,
        },
      }),
    ).toEqual({
      type: 'tool_result',
      toolCallId: 'call-1',
      toolName: 'Agent',
      clientRequestId: 'req-1',
      output: 'done',
      isError: false,
      fileDiffs: [
        {
          file: '/repo/task.md',
          before: '',
          after: 'done',
          additions: 1,
          deletions: 0,
          status: 'added',
          clientRequestId: 'req-1',
          toolCallId: 'call-1',
          toolName: 'Agent',
        },
      ],
      pendingPermissionRequestId: 'perm-1',
      observability: {
        presentedToolName: 'Agent',
        canonicalToolName: 'call_omo_agent',
        toolSurfaceProfile: 'claude_code_default',
        adapterVersion: '1.0.0',
      },
      eventId: 'evt-1',
      runId: 'run-1',
      occurredAt: 1,
    });
  });
});
