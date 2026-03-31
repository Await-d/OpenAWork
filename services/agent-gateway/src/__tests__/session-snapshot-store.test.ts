import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sqliteAllMock: vi.fn(),
  sqliteRunMock: vi.fn(),
}));

vi.mock('../db.js', () => ({
  sqliteAll: mocks.sqliteAllMock,
  sqliteRun: mocks.sqliteRunMock,
}));

import { listSessionSnapshots, persistSessionSnapshot } from '../session-snapshot-store.js';

describe('session-snapshot-store', () => {
  it('persists request-level snapshot summaries', () => {
    persistSessionSnapshot({
      sessionId: 'session-a',
      userId: 'user-a',
      clientRequestId: 'req-a',
      fileDiffs: [
        {
          file: '/repo/a.ts',
          before: 'a',
          after: 'b',
          additions: 1,
          deletions: 1,
          status: 'modified',
        },
      ],
    });

    expect(mocks.sqliteRunMock).toHaveBeenCalledTimes(1);
    const params = mocks.sqliteRunMock.mock.calls[0]?.[1] as unknown[];
    expect(params?.[0]).toBe('session-a');
    expect(params?.[2]).toBe('req-a');
    expect(JSON.parse(String(params?.[3]))).toEqual({ files: 1, additions: 1, deletions: 1 });
  });

  it('skips malformed snapshot rows when listing', () => {
    mocks.sqliteAllMock.mockReturnValue([
      {
        client_request_id: 'req-a',
        summary_json: JSON.stringify({ files: 1, additions: 1, deletions: 0 }),
        files_json: JSON.stringify([
          { file: '/repo/a.ts', before: '', after: 'x', additions: 1, deletions: 0 },
        ]),
        created_at: '2026-03-30T00:00:00.000Z',
      },
      {
        client_request_id: 'req-b',
        summary_json: undefined,
        files_json: undefined,
        created_at: '2026-03-30T00:00:01.000Z',
      },
    ]);

    expect(listSessionSnapshots({ sessionId: 'session-a', userId: 'user-a' })).toEqual([
      {
        clientRequestId: 'req-a',
        summary: { files: 1, additions: 1, deletions: 0 },
        files: [{ file: '/repo/a.ts', before: '', after: 'x', additions: 1, deletions: 0 }],
        createdAt: '2026-03-30T00:00:00.000Z',
      },
    ]);
  });
});
