import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sqliteGetMock: vi.fn(),
  sqliteRunMock: vi.fn(),
  sqliteAllMock: vi.fn(),
}));

vi.mock('../db.js', () => ({
  sqliteGet: mocks.sqliteGetMock,
  sqliteRun: mocks.sqliteRunMock,
  sqliteAll: mocks.sqliteAllMock,
}));

import {
  listSessionRunEventsByRequest,
  publishSessionRunEvent,
  subscribeSessionRunEvents,
} from '../session-run-events.js';

describe('session run events', () => {
  beforeEach(() => {
    mocks.sqliteGetMock.mockReset();
    mocks.sqliteRunMock.mockReset();
    mocks.sqliteAllMock.mockReset();
  });

  it('publishes events to active subscribers and stops after unsubscribe', () => {
    mocks.sqliteGetMock.mockReturnValue({ user_id: 'user-a' });
    const handler = vi.fn();
    const unsubscribe = subscribeSessionRunEvents('session-1', handler);

    publishSessionRunEvent('session-1', {
      type: 'permission_asked',
      requestId: 'perm-1',
      toolName: 'bash',
      scope: 'workspace',
      reason: '需要运行命令',
      riskLevel: 'medium',
    });

    expect(handler).toHaveBeenCalledTimes(1);

    unsubscribe();
    publishSessionRunEvent('session-1', {
      type: 'permission_replied',
      requestId: 'perm-1',
      decision: 'once',
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(mocks.sqliteRunMock).toHaveBeenCalledTimes(2);
  });

  it('persists tool_result observability in payload_json for request-scoped replay', () => {
    mocks.sqliteGetMock.mockReturnValue({ user_id: 'user-a' });

    publishSessionRunEvent(
      'session-2',
      {
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
      },
      { clientRequestId: 'req-1' },
    );

    const params = mocks.sqliteRunMock.mock.calls[0]?.[1] as unknown[];
    expect(JSON.parse(String(params?.[8]))).toMatchObject({
      type: 'tool_result',
      toolCallId: 'call-1',
      clientRequestId: 'req-1',
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

    mocks.sqliteAllMock.mockReturnValue([
      {
        payload_json: JSON.stringify({
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
        }),
      },
    ]);

    expect(
      listSessionRunEventsByRequest({ sessionId: 'session-2', clientRequestId: 'req-1' }),
    ).toEqual([
      {
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
      },
    ]);
  });
});
