import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sqliteAllMock: vi.fn(),
  sqliteRunMock: vi.fn(),
}));

vi.mock('../db.js', () => ({
  sqliteAll: mocks.sqliteAllMock,
  sqliteRun: mocks.sqliteRunMock,
}));

import {
  listRequestWorkflowLogs,
  persistRequestWorkflowLog,
  resetRequestWorkflowLogStoreStateForTests,
} from '../request-workflow-log-store.js';

describe('request-workflow-log-store', () => {
  beforeEach(() => {
    mocks.sqliteAllMock.mockReset();
    mocks.sqliteRunMock.mockReset();
    resetRequestWorkflowLogStoreStateForTests();
  });

  it('persists stripped workflow trees with detected session ids', () => {
    persistRequestWorkflowLog({
      context: {
        requestId: 'req-1',
        method: 'GET',
        path: '/sessions/session-1/stream',
        startTime: 1,
        ip: '127.0.0.1',
        userAgent: 'ua',
      },
      steps: [
        {
          name: 'request.handle',
          status: 'success',
          _startedAt: 1,
          children: [{ name: 'child', status: 'error', _startedAt: 2 }],
        },
      ],
      statusCode: 200,
      userId: 'user-a',
    });

    expect(mocks.sqliteRunMock).toHaveBeenCalledTimes(1);
    const params = mocks.sqliteRunMock.mock.calls[0]?.[1] as unknown[];
    expect(params?.[0]).toBe('req-1');
    expect(params?.[1]).toBe('user-a');
    expect(params?.[2]).toBe('session-1');
    expect(JSON.parse(String(params?.[8]))).toEqual([
      {
        name: 'request.handle',
        status: 'success',
        children: [{ name: 'child', status: 'error' }],
      },
    ]);
  });

  it('appends tool call refs into the persisted workflow payload when provided', () => {
    persistRequestWorkflowLog({
      context: {
        requestId: 'req-tool',
        method: 'POST',
        path: '/sessions/session-9/stream',
        startTime: 1,
      },
      steps: [{ name: 'request.handle', status: 'success', _startedAt: 1 }],
      statusCode: 200,
      userId: 'user-a',
      toolCallRefs: [
        {
          toolCallId: 'call-1',
          clientRequestId: 'req-client-1',
          observability: {
            presentedToolName: 'Write',
            canonicalToolName: 'write',
            adapterVersion: '1.0.0',
          },
        },
      ],
    });

    const params = mocks.sqliteRunMock.mock.calls[0]?.[1] as unknown[];
    expect(JSON.parse(String(params?.[8]))).toEqual([
      { name: 'request.handle', status: 'success' },
      {
        name: 'tool.call.refs',
        status: 'success',
        fields: {
          toolCallRefsCount: 1,
          toolCallRefsJson: JSON.stringify([
            {
              toolCallId: 'call-1',
              clientRequestId: 'req-client-1',
              observability: {
                presentedToolName: 'Write',
                canonicalToolName: 'write',
                adapterVersion: '1.0.0',
              },
            },
          ]),
        },
      },
    ]);
  });

  it('lists persisted workflow logs by user', () => {
    mocks.sqliteAllMock.mockReturnValue([{ id: 1 }]);
    const rows = listRequestWorkflowLogs('user-a', 10);
    expect(rows).toEqual([{ id: 1 }]);
    expect(mocks.sqliteAllMock).toHaveBeenCalledWith(
      expect.stringContaining('FROM request_workflow_logs'),
      ['user-a', 10],
    );
  });

  it('disables workflow log writes after malformed table errors', () => {
    const malformedError = new Error('database disk image is malformed');
    mocks.sqliteRunMock.mockImplementationOnce(() => {
      throw malformedError;
    });

    persistRequestWorkflowLog({
      context: {
        requestId: 'req-2',
        method: 'DELETE',
        path: '/sessions/session-2',
        startTime: 1,
      },
      steps: [],
      statusCode: 200,
      userId: 'user-a',
    });

    persistRequestWorkflowLog({
      context: {
        requestId: 'req-3',
        method: 'GET',
        path: '/sessions',
        startTime: 2,
      },
      steps: [],
      statusCode: 200,
      userId: 'user-a',
    });

    expect(mocks.sqliteRunMock).toHaveBeenCalledTimes(1);
  });

  it('returns an empty list after malformed table errors', () => {
    const malformedError = new Error('database disk image is malformed');
    mocks.sqliteAllMock.mockImplementationOnce(() => {
      throw malformedError;
    });

    expect(listRequestWorkflowLogs('user-a', 10)).toEqual([]);
    expect(listRequestWorkflowLogs('user-a', 10)).toEqual([]);
    expect(mocks.sqliteAllMock).toHaveBeenCalledTimes(1);
  });
});
