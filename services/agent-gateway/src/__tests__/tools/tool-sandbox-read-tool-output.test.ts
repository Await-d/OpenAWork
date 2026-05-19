import { describe, expect, it, vi } from 'vitest';
import type { StoredToolResult } from '../../message/message-v2-adapter.js';
import type * as MessageV2Adapter from '../../message/message-v2-adapter.js';

const mocks = vi.hoisted(() => ({
  getLatestReferencedToolResultMock: vi.fn((): StoredToolResult | null => null),
  getSessionToolResultByCallIdMock: vi.fn((): StoredToolResult | null => null),
  sqliteAllMock: vi.fn(() => []),
  sqliteGetMock: vi.fn((query: string) => {
    if (query.includes('SELECT user_id FROM sessions')) {
      return { user_id: 'user-1' };
    }
    if (query.includes('SELECT metadata_json')) {
      return { metadata_json: '{}' };
    }
    return undefined;
  }),
  sqliteRunMock: vi.fn(),
}));

vi.mock('../../db.js', () => ({
  WORKSPACE_ACCESS_RESTRICTED: false,
  WORKSPACE_ROOT: '/home/await/project/OpenAWork',
  WORKSPACE_ROOTS: ['/home/await/project/OpenAWork'],
  sqliteAll: mocks.sqliteAllMock,
  sqliteGet: mocks.sqliteGetMock,
  sqliteRun: mocks.sqliteRunMock,
}));

vi.mock('../../message/message-v2-adapter.js', async () => {
  const actual = await vi.importActual<typeof MessageV2Adapter>('../../message/message-v2-adapter.js');
  return {
    ...actual,
    getLatestReferencedToolResult: mocks.getLatestReferencedToolResultMock,
    getSessionToolResultByCallId: mocks.getSessionToolResultByCallIdMock,
  };
});

import { createDefaultSandbox } from '../../tools/tool-sandbox.js';

describe('tool-sandbox read_tool_output', () => {
  it('prefers an explicit toolCallId lookup over latest-reference fallback', async () => {
    mocks.getSessionToolResultByCallIdMock.mockReturnValueOnce({
      toolCallId: 'call-explicit-1',
      toolName: 'bash',
      output: 'alpha\nbeta',
      isError: false,
    });

    const sandbox = createDefaultSandbox();
    const result = await sandbox.execute(
      {
        toolCallId: 'call-read-output-explicit',
        toolName: 'read_tool_output',
        rawInput: { toolCallId: 'call-explicit-1' },
      },
      new AbortController().signal,
      'session-1',
      {
        clientRequestId: 'req-read-output-explicit',
        nextRound: 1,
        requestData: { clientRequestId: 'req-read-output-explicit' },
      },
    );

    expect(mocks.getSessionToolResultByCallIdMock).toHaveBeenCalledWith({
      sessionId: 'session-1',
      userId: 'user-1',
      toolCallId: 'call-explicit-1',
    });
    expect(mocks.getLatestReferencedToolResultMock).not.toHaveBeenCalled();
    expect(result.isError).toBe(false);
    expect(result.output).toMatchObject({
      toolCallId: 'call-explicit-1',
      fullOutputPreserved: true,
      outputType: 'string',
      output: 'alpha\nbeta',
      totalLines: 2,
      selection: {
        mode: 'full',
        lineStart: 1,
        lineCount: 2,
      },
    });
  });

  it('returns actionable guidance when latest referenced output is unavailable', async () => {
    const sandbox = createDefaultSandbox();
    const result = await sandbox.execute(
      {
        toolCallId: 'call-read-output-1',
        toolName: 'read_tool_output',
        rawInput: { useLatestReferenced: true },
      },
      new AbortController().signal,
      'session-1',
      {
        clientRequestId: 'req-read-output-1',
        nextRound: 1,
        requestData: { clientRequestId: 'req-read-output-1' },
      },
    );

    expect(result.isError).toBe(true);
    expect(result.output).toBe(
      'No large referenced tool result was found in the current session. If the current session history already contains a toolCallId, call read_tool_output with that toolCallId instead of useLatestReferenced=true.',
    );
  });
});
