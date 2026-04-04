import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sqliteAllMock: vi.fn(),
  sqliteRunMock: vi.fn(),
}));

vi.mock('../db.js', () => ({
  sqliteAll: mocks.sqliteAllMock,
  sqliteRun: mocks.sqliteRunMock,
}));

import {
  compareSessionSnapshots,
  createRequestSnapshotRef,
  deleteRequestSnapshots,
  getSessionSnapshotByRef,
  listRequestSnapshots,
  listSessionSnapshots,
  persistSessionSnapshot,
} from '../session-snapshot-store.js';

describe('session-snapshot-store', () => {
  it('persists request-level snapshot summaries', () => {
    persistSessionSnapshot({
      sessionId: 'session-a',
      userId: 'user-a',
      snapshotRef: createRequestSnapshotRef('req-a'),
      fileDiffs: [
        {
          file: '/repo/a.ts',
          before: 'a',
          after: 'b',
          additions: 1,
          deletions: 1,
          status: 'modified',
          clientRequestId: 'req-a',
          requestId: 'req-a:tool:call-1',
          toolName: 'write',
          toolCallId: 'call-1',
          sourceKind: 'structured_tool_diff',
          guaranteeLevel: 'strong',
          backupBeforeRef: {
            backupId: 'backup-before-1',
            kind: 'before_write',
            storagePath: '/tmp/backup-before-1',
          },
        },
      ],
    });

    expect(mocks.sqliteRunMock).toHaveBeenCalledTimes(1);
    const params = mocks.sqliteRunMock.mock.calls[0]?.[1] as unknown[];
    expect(params?.[0]).toBe('session-a');
    expect(params?.[2]).toBe('req:req-a');
    expect(JSON.parse(String(params?.[3]))).toEqual({
      files: 1,
      additions: 1,
      deletions: 1,
      scopeKind: 'request',
      requestIds: ['req-a:tool:call-1'],
      toolCallIds: ['call-1'],
      toolNames: ['write'],
      sourceKinds: ['structured_tool_diff'],
      guaranteeLevel: 'strong',
      backupBeforeRefs: [
        {
          backupId: 'backup-before-1',
          kind: 'before_write',
          storagePath: '/tmp/backup-before-1',
        },
      ],
      backupAfterRefs: [],
    });
  });

  it('skips malformed snapshot rows when listing', () => {
    mocks.sqliteAllMock.mockReturnValue([
      {
        client_request_id: 'req-a',
        summary_json: JSON.stringify({ files: 1, additions: 1, deletions: 0 }),
        files_json: JSON.stringify([
          {
            file: '/repo/a.ts',
            before: '',
            after: 'x',
            additions: 1,
            deletions: 0,
            clientRequestId: 'req-a',
            requestId: 'req-a:tool:call-1',
            toolName: 'write',
            toolCallId: 'call-1',
            sourceKind: 'structured_tool_diff',
            guaranteeLevel: 'strong',
          },
        ]),
        created_at: '2026-03-30T00:00:00.000Z',
      },
      {
        client_request_id: 'backup:backup-1',
        summary_json: JSON.stringify({
          files: 1,
          additions: 1,
          deletions: 0,
          scopeKind: 'backup',
          requestIds: ['req-b:tool:call-2'],
          toolCallIds: ['call-2'],
          toolNames: ['write'],
          sourceKinds: ['structured_tool_diff'],
          guaranteeLevel: 'medium',
          backupBeforeRefs: [
            {
              backupId: 'backup-1',
              kind: 'snapshot_base',
              artifactId: 'artifact-1',
            },
          ],
          backupAfterRefs: [],
        }),
        files_json: JSON.stringify([
          {
            file: '/repo/b.ts',
            before: '',
            after: 'export const b = true;',
            additions: 1,
            deletions: 0,
            clientRequestId: 'req-b',
            requestId: 'req-b:tool:call-2',
            toolName: 'write',
            toolCallId: 'call-2',
            sourceKind: 'structured_tool_diff',
            guaranteeLevel: 'medium',
          },
        ]),
        created_at: '2026-03-30T00:00:02.000Z',
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
        snapshotRef: 'req-a',
        clientRequestId: 'req-a',
        scopeKind: 'request',
        summary: {
          files: 1,
          additions: 1,
          deletions: 0,
          scopeKind: 'request',
          requestIds: ['req-a:tool:call-1'],
          toolCallIds: ['call-1'],
          toolNames: ['write'],
          sourceKinds: ['structured_tool_diff'],
          guaranteeLevel: 'strong',
          backupBeforeRefs: [],
          backupAfterRefs: [],
        },
        files: [
          {
            file: '/repo/a.ts',
            before: '',
            after: 'x',
            additions: 1,
            deletions: 0,
            clientRequestId: 'req-a',
            requestId: 'req-a:tool:call-1',
            toolName: 'write',
            toolCallId: 'call-1',
            sourceKind: 'structured_tool_diff',
            guaranteeLevel: 'strong',
          },
        ],
        createdAt: '2026-03-30T00:00:00.000Z',
      },
      {
        snapshotRef: 'backup:backup-1',
        clientRequestId: undefined,
        scopeKind: 'backup',
        summary: {
          files: 1,
          additions: 1,
          deletions: 0,
          scopeKind: 'backup',
          requestIds: ['req-b:tool:call-2'],
          toolCallIds: ['call-2'],
          toolNames: ['write'],
          sourceKinds: ['structured_tool_diff'],
          guaranteeLevel: 'medium',
          backupBeforeRefs: [
            {
              backupId: 'backup-1',
              kind: 'snapshot_base',
              artifactId: 'artifact-1',
            },
          ],
          backupAfterRefs: [],
        },
        files: [
          {
            file: '/repo/b.ts',
            before: '',
            after: 'export const b = true;',
            additions: 1,
            deletions: 0,
            clientRequestId: 'req-b',
            requestId: 'req-b:tool:call-2',
            toolName: 'write',
            toolCallId: 'call-2',
            sourceKind: 'structured_tool_diff',
            guaranteeLevel: 'medium',
          },
        ],
        createdAt: '2026-03-30T00:00:02.000Z',
      },
    ]);
  });

  it('deletes request snapshots by client request id', () => {
    deleteRequestSnapshots({
      clientRequestId: 'req-a',
      sessionId: 'session-a',
      userId: 'user-a',
    });

    expect(mocks.sqliteRunMock).toHaveBeenCalledWith(
      'DELETE FROM session_snapshots WHERE session_id = ? AND user_id = ? AND client_request_id = ?',
      ['session-a', 'user-a', 'req:req-a'],
    );
  });

  it('finds a snapshot by ref and filters request snapshots', () => {
    mocks.sqliteAllMock.mockReturnValue([
      {
        client_request_id: 'req:req-a',
        summary_json: JSON.stringify({ files: 1, additions: 1, deletions: 0 }),
        files_json: JSON.stringify([
          {
            file: '/repo/a.ts',
            before: '',
            after: 'x',
            additions: 1,
            deletions: 0,
          },
        ]),
        created_at: '2026-03-30T00:00:00.000Z',
      },
      {
        client_request_id: 'backup:backup-1',
        summary_json: JSON.stringify({ files: 1, additions: 1, deletions: 0, scopeKind: 'backup' }),
        files_json: JSON.stringify([
          {
            file: '/repo/b.ts',
            before: '',
            after: 'y',
            additions: 1,
            deletions: 0,
          },
        ]),
        created_at: '2026-03-30T00:00:01.000Z',
      },
    ]);

    expect(
      getSessionSnapshotByRef({
        sessionId: 'session-a',
        userId: 'user-a',
        snapshotRef: 'req:req-a',
      }),
    )?.toMatchObject({ snapshotRef: 'req:req-a', clientRequestId: 'req-a' });
    expect(
      listRequestSnapshots({ sessionId: 'session-a', userId: 'user-a', clientRequestId: 'req-a' }),
    ).toHaveLength(1);
  });

  it('compares two snapshots by file content', () => {
    expect(
      compareSessionSnapshots({
        from: {
          snapshotRef: 'req:req-a',
          clientRequestId: 'req-a',
          scopeKind: 'request',
          summary: {
            files: 1,
            additions: 1,
            deletions: 0,
            scopeKind: 'request',
            requestIds: [],
            toolCallIds: [],
            toolNames: [],
            sourceKinds: [],
            backupBeforeRefs: [],
            backupAfterRefs: [],
          },
          files: [
            {
              file: '/repo/a.ts',
              before: '',
              after: 'one',
              additions: 1,
              deletions: 0,
            },
          ],
          createdAt: '2026-03-30T00:00:00.000Z',
        },
        to: {
          snapshotRef: 'backup:backup-1',
          clientRequestId: undefined,
          scopeKind: 'backup',
          summary: {
            files: 2,
            additions: 2,
            deletions: 0,
            scopeKind: 'backup',
            requestIds: [],
            toolCallIds: [],
            toolNames: [],
            sourceKinds: [],
            backupBeforeRefs: [],
            backupAfterRefs: [],
          },
          files: [
            {
              file: '/repo/a.ts',
              before: 'one',
              after: 'two',
              additions: 1,
              deletions: 1,
            },
            {
              file: '/repo/b.ts',
              before: '',
              after: 'new',
              additions: 1,
              deletions: 0,
            },
          ],
          createdAt: '2026-03-30T00:00:01.000Z',
        },
      }),
    ).toEqual([
      {
        file: '/repo/a.ts',
        before: 'one',
        after: 'two',
        fromExists: true,
        toExists: true,
        changed: true,
        fromStatus: undefined,
        toStatus: undefined,
      },
      {
        file: '/repo/b.ts',
        before: '',
        after: 'new',
        fromExists: false,
        toExists: true,
        changed: true,
        fromStatus: undefined,
        toStatus: undefined,
      },
    ]);
  });

  it('uses the weakest guarantee level across snapshot files', () => {
    persistSessionSnapshot({
      sessionId: 'session-a',
      userId: 'user-a',
      snapshotRef: createRequestSnapshotRef('req-weak'),
      fileDiffs: [
        {
          file: '/repo/a.ts',
          before: 'a',
          after: 'b',
          additions: 1,
          deletions: 1,
          guaranteeLevel: 'strong',
        },
        {
          file: '/repo/b.ts',
          before: 'x',
          after: 'y',
          additions: 1,
          deletions: 1,
          guaranteeLevel: 'weak',
        },
      ],
    });

    const params = mocks.sqliteRunMock.mock.calls.at(-1)?.[1] as unknown[];
    expect(JSON.parse(String(params?.[3]))).toMatchObject({ guaranteeLevel: 'weak' });
  });
});
