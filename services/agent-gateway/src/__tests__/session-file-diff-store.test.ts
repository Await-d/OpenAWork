import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sqliteAllMock: vi.fn(),
  sqliteRunMock: vi.fn(),
}));

vi.mock('../db.js', () => ({
  sqliteAll: mocks.sqliteAllMock,
  sqliteRun: mocks.sqliteRunMock,
}));

import { listSessionFileDiffs, persistSessionFileDiffs } from '../session-file-diff-store.js';

describe('session-file-diff-store', () => {
  it('persists each diff as a durable row', () => {
    persistSessionFileDiffs({
      sessionId: 'session-a',
      userId: 'user-a',
      requestId: 'req-a',
      toolName: 'write',
      diffs: [
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
    expect(mocks.sqliteRunMock.mock.calls[0]?.[1]).toEqual([
      'session-a',
      'user-a',
      'req-a',
      'write',
      '/repo/a.ts',
      'a',
      'b',
      1,
      1,
      'modified',
    ]);
  });

  it('lists durable file diffs for a session', () => {
    mocks.sqliteAllMock.mockReturnValue([
      {
        file_path: '/repo/a.ts',
        before_text: 'a',
        after_text: 'b',
        additions: 1,
        deletions: 1,
        status: 'modified',
        tool_name: 'write',
        request_id: 'req-a',
        created_at: '2026-03-30T00:00:00.000Z',
      },
    ]);

    expect(listSessionFileDiffs({ sessionId: 'session-a', userId: 'user-a' })).toEqual([
      {
        file: '/repo/a.ts',
        before: 'a',
        after: 'b',
        additions: 1,
        deletions: 1,
        status: 'modified',
      },
    ]);
  });
});
