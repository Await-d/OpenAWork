import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execMock: vi.fn(),
  sqliteRunMock: vi.fn(),
}));

vi.mock('../db.js', () => ({
  db: {
    exec: mocks.execMock,
  },
  sqliteRun: mocks.sqliteRunMock,
}));

import { deleteSessionWithMalformedRecovery } from '../session-delete-recovery.js';

describe('session-delete-recovery', () => {
  beforeEach(() => {
    mocks.execMock.mockReset();
    mocks.sqliteRunMock.mockReset();
  });

  it('manually clears healthy session references without touching workflow logs', () => {
    deleteSessionWithMalformedRecovery({
      sessionId: 'session-1',
      userId: 'user-1',
    });

    expect(mocks.execMock.mock.calls).toEqual([
      ['PRAGMA foreign_keys=OFF'],
      ['BEGIN'],
      ['COMMIT'],
      ['PRAGMA foreign_keys=ON'],
    ]);
    expect(mocks.sqliteRunMock).toHaveBeenCalledWith(
      'DELETE FROM sessions WHERE id = ? AND user_id = ?',
      ['session-1', 'user-1'],
    );
    expect(
      mocks.sqliteRunMock.mock.calls.some(([sql]) =>
        String(sql).startsWith('UPDATE request_workflow_logs'),
      ),
    ).toBe(false);
  });

  it('rolls back when a required table cleanup fails', () => {
    mocks.sqliteRunMock.mockImplementation((sql: string) => {
      if (sql.startsWith('DELETE FROM session_messages')) {
        throw new Error('database is locked');
      }
    });

    expect(() =>
      deleteSessionWithMalformedRecovery({
        sessionId: 'session-1',
        userId: 'user-1',
      }),
    ).toThrow('database is locked');
    expect(mocks.execMock.mock.calls).toEqual([
      ['PRAGMA foreign_keys=OFF'],
      ['BEGIN'],
      ['ROLLBACK'],
      ['PRAGMA foreign_keys=ON'],
    ]);
  });
});
