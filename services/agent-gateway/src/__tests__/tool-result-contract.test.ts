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
          adapterVersion: '1.0.0',
        },
      }),
    ).toEqual({
      type: 'tool_result',
      toolCallId: 'call-1',
      toolName: 'write',
      clientRequestId: 'req-1',
      output: { ok: true },
      rawOutput: '{"ok":true}',
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
        adapterVersion: '1.0.0',
      },
      eventId: 'evt-1',
      runId: 'run-1',
      occurredAt: 1,
    });
  });

  it('preserves reason on tool_result content and run events', () => {
    expect(
      buildToolResultContent({
        toolCallId: 'call-timeout-1',
        toolName: 'task',
        clientRequestId: 'req-timeout-1',
        output: { status: 'failed' },
        isError: true,
        reason: 'timeout',
      }),
    ).toMatchObject({
      type: 'tool_result',
      toolCallId: 'call-timeout-1',
      reason: 'timeout',
    });

    expect(
      buildToolResultRunEvent({
        toolCallId: 'call-timeout-1',
        toolName: 'task',
        clientRequestId: 'req-timeout-1',
        output: { status: 'failed' },
        isError: true,
        reason: 'timeout',
        eventMeta: {
          eventId: 'evt-timeout-1',
          runId: 'run-timeout-1',
          occurredAt: 1,
        },
      }),
    ).toMatchObject({
      type: 'tool_result',
      toolCallId: 'call-timeout-1',
      reason: 'timeout',
    });
  });

  it('preserves resumedAfterApproval on tool_result content and run events', () => {
    expect(
      buildToolResultContent({
        toolCallId: 'call-resume-1',
        toolName: 'bash',
        clientRequestId: 'req-resume-1',
        output: { exitCode: 1 },
        isError: true,
        resumedAfterApproval: true,
      }),
    ).toMatchObject({
      type: 'tool_result',
      toolCallId: 'call-resume-1',
      resumedAfterApproval: true,
    });

    expect(
      buildToolResultRunEvent({
        toolCallId: 'call-resume-1',
        toolName: 'bash',
        clientRequestId: 'req-resume-1',
        output: { exitCode: 1 },
        isError: true,
        resumedAfterApproval: true,
        eventMeta: {
          eventId: 'evt-resume-1',
          runId: 'run-resume-1',
          occurredAt: 1,
        },
      }),
    ).toMatchObject({
      type: 'tool_result',
      toolCallId: 'call-resume-1',
      resumedAfterApproval: true,
    });
  });
});
