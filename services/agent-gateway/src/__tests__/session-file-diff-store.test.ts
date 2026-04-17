import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sqliteAllMock: vi.fn(),
  sqliteRunMock: vi.fn(),
  captureBeforeWriteBackupMock: vi.fn(),
  readSessionFileBackupContentMock: vi.fn(),
}));

vi.mock('../db.js', () => ({
  sqliteAll: mocks.sqliteAllMock,
  sqliteRun: mocks.sqliteRunMock,
}));

vi.mock('../session-file-backup-store.js', () => ({
  captureBeforeWriteBackup: mocks.captureBeforeWriteBackupMock,
  readSessionFileBackupContent: mocks.readSessionFileBackupContentMock,
}));

import {
  deleteRequestFileDiffs,
  listRequestFileDiffs,
  listSessionFileDiffs,
  listSessionFileDiffsWithText,
  persistSessionFileDiffs,
} from '../session-file-diff-store.js';

describe('session-file-diff-store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists each diff as a durable row with backup refs', async () => {
    mocks.captureBeforeWriteBackupMock
      .mockResolvedValueOnce({
        backupId: 'backup-before-1',
        kind: 'before_write',
        contentHash: 'hash-a',
        storagePath: '/tmp/before-1',
      })
      .mockResolvedValueOnce({
        backupId: 'backup-after-1',
        kind: 'after_write',
        contentHash: 'hash-b',
        storagePath: '/tmp/after-1',
      });

    await persistSessionFileDiffs({
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

    expect(mocks.captureBeforeWriteBackupMock).toHaveBeenCalledTimes(2);
    expect(mocks.sqliteRunMock).toHaveBeenCalledTimes(1);
    expect(mocks.sqliteRunMock.mock.calls[0]?.[1]).toEqual([
      'session-a',
      'user-a',
      null,
      'req-a',
      'write',
      null,
      '/repo/a.ts',
      'backup-before-1',
      'backup-after-1',
      1,
      1,
      'modified',
      'structured_tool_diff',
      'medium',
      'null',
      JSON.stringify({
        backupId: 'backup-before-1',
        kind: 'before_write',
        contentHash: 'hash-a',
        storagePath: '/tmp/before-1',
      }),
      JSON.stringify({
        backupId: 'backup-after-1',
        kind: 'after_write',
        contentHash: 'hash-b',
        storagePath: '/tmp/after-1',
      }),
    ]);
  });

  it('persists trace metadata when provided', async () => {
    mocks.captureBeforeWriteBackupMock
      .mockResolvedValueOnce({
        backupId: 'backup-before-2',
        kind: 'before_write',
        contentHash: 'hash-a',
        storagePath: '/tmp/before-2',
      })
      .mockResolvedValueOnce({
        backupId: 'backup-after-2',
        kind: 'after_write',
        contentHash: 'hash-b',
        storagePath: '/tmp/after-2',
      });

    await persistSessionFileDiffs({
      sessionId: 'session-a',
      userId: 'user-a',
      clientRequestId: 'client-1',
      requestId: 'req-a',
      toolName: 'write',
      toolCallId: 'tool-1',
      observability: {
        presentedToolName: 'Write',
        canonicalToolName: 'write',
      },
      diffs: [
        {
          file: '/repo/a.ts',
          before: 'a',
          after: 'b',
          additions: 1,
          deletions: 1,
          status: 'modified',
          guaranteeLevel: 'strong',
        },
      ],
    });

    expect(mocks.sqliteRunMock).toHaveBeenCalledTimes(1);
    const callArgs = mocks.sqliteRunMock.mock.calls.at(-1)?.[1];
    expect(callArgs).toEqual([
      'session-a',
      'user-a',
      'client-1',
      'req-a',
      'write',
      'tool-1',
      '/repo/a.ts',
      'backup-before-2',
      'backup-after-2',
      1,
      1,
      'modified',
      'structured_tool_diff',
      'strong',
      JSON.stringify({
        presentedToolName: 'Write',
        canonicalToolName: 'write',
      }),
      JSON.stringify({
        backupId: 'backup-before-2',
        kind: 'before_write',
        contentHash: 'hash-a',
        storagePath: '/tmp/before-2',
      }),
      JSON.stringify({
        backupId: 'backup-after-2',
        kind: 'after_write',
        contentHash: 'hash-b',
        storagePath: '/tmp/after-2',
      }),
    ]);
  });

  it('lists durable file diffs for a session (metadata only, no text)', () => {
    mocks.sqliteAllMock.mockReturnValue([
      {
        client_request_id: 'client-a',
        file_path: '/repo/a.ts',
        before_backup_id: 'backup-1',
        after_backup_id: 'backup-2',
        additions: 1,
        deletions: 1,
        status: 'modified',
        source_kind: 'structured_tool_diff',
        guarantee_level: 'strong',
        observability_json: JSON.stringify({
          presentedToolName: 'Write',
          canonicalToolName: 'write',
        }),
        backup_before_ref_json: JSON.stringify({
          backupId: 'backup-1',
          kind: 'before_write',
          storagePath: '/tmp/backup-1',
        }),
        backup_after_ref_json: null,
        tool_name: 'write',
        tool_call_id: 'tool-1',
        request_id: 'req-a',
        created_at: '2026-03-30T00:00:00.000Z',
      },
    ]);

    expect(listSessionFileDiffs({ sessionId: 'session-a', userId: 'user-a' })).toEqual([
      {
        file: '/repo/a.ts',
        before: '',
        after: '',
        additions: 1,
        deletions: 1,
        clientRequestId: 'client-a',
        status: 'modified',
        sourceKind: 'structured_tool_diff',
        guaranteeLevel: 'strong',
        requestId: 'req-a',
        toolName: 'write',
        toolCallId: 'tool-1',
        observability: {
          presentedToolName: 'Write',
          canonicalToolName: 'write',
        },
        backupBeforeRef: {
          backupId: 'backup-1',
          kind: 'before_write',
          storagePath: '/tmp/backup-1',
        },
      },
    ]);
  });

  it('lists file diffs with text content loaded from disk', async () => {
    mocks.sqliteAllMock.mockReturnValue([
      {
        client_request_id: 'client-a',
        file_path: '/repo/a.ts',
        before_backup_id: 'backup-1',
        after_backup_id: 'backup-2',
        additions: 1,
        deletions: 1,
        status: 'modified',
        source_kind: 'structured_tool_diff',
        guarantee_level: 'strong',
        observability_json: null,
        backup_before_ref_json: JSON.stringify({
          backupId: 'backup-1',
          kind: 'before_write',
          storagePath: '/tmp/backup-1',
        }),
        backup_after_ref_json: JSON.stringify({
          backupId: 'backup-2',
          kind: 'after_write',
          storagePath: '/tmp/backup-2',
        }),
        tool_name: 'write',
        tool_call_id: 'tool-1',
        request_id: 'req-a',
        created_at: '2026-03-30T00:00:00.000Z',
      },
    ]);
    mocks.readSessionFileBackupContentMock
      .mockResolvedValueOnce('original content')
      .mockResolvedValueOnce('modified content');

    const result = await listSessionFileDiffsWithText({ sessionId: 'session-a', userId: 'user-a' });
    expect(result).toEqual([
      {
        file: '/repo/a.ts',
        before: 'original content',
        after: 'modified content',
        additions: 1,
        deletions: 1,
        clientRequestId: 'client-a',
        status: 'modified',
        sourceKind: 'structured_tool_diff',
        guaranteeLevel: 'strong',
        requestId: 'req-a',
        toolName: 'write',
        toolCallId: 'tool-1',
        backupBeforeRef: {
          backupId: 'backup-1',
          kind: 'before_write',
          storagePath: '/tmp/backup-1',
        },
        backupAfterRef: {
          backupId: 'backup-2',
          kind: 'after_write',
          storagePath: '/tmp/backup-2',
        },
      },
    ]);
  });

  it('deletes file diffs by request scope', () => {
    deleteRequestFileDiffs({
      clientRequestId: 'client-a',
      sessionId: 'session-a',
      userId: 'user-a',
    });

    expect(mocks.sqliteRunMock).toHaveBeenCalledWith(
      'DELETE FROM session_file_diffs WHERE session_id = ? AND user_id = ? AND client_request_id = ?',
      ['session-a', 'user-a', 'client-a'],
    );
  });

  it('lists durable file diffs for a specific client request', () => {
    mocks.sqliteAllMock.mockReturnValue([
      {
        client_request_id: 'client-a',
        file_path: '/repo/request.ts',
        before_backup_id: 'backup-3',
        after_backup_id: 'backup-4',
        additions: 1,
        deletions: 1,
        status: 'modified',
        source_kind: 'workspace_reconcile',
        guarantee_level: 'weak',
        observability_json: null,
        backup_before_ref_json: null,
        backup_after_ref_json: null,
        tool_name: 'bash',
        tool_call_id: 'tool-2',
        request_id: 'client-a:tool:tool-2',
        created_at: '2026-03-30T00:00:01.000Z',
      },
    ]);

    expect(
      listRequestFileDiffs({
        sessionId: 'session-a',
        userId: 'user-a',
        clientRequestId: 'client-a',
      }),
    ).toEqual([
      {
        file: '/repo/request.ts',
        before: '',
        after: '',
        additions: 1,
        deletions: 1,
        clientRequestId: 'client-a',
        status: 'modified',
        sourceKind: 'workspace_reconcile',
        guaranteeLevel: 'weak',
        requestId: 'client-a:tool:tool-2',
        toolName: 'bash',
        toolCallId: 'tool-2',
      },
    ]);
    expect(mocks.sqliteAllMock).toHaveBeenCalledWith(
      expect.stringContaining('AND client_request_id = ?'),
      ['session-a', 'user-a', 'client-a'],
    );
  });

  it('round-trips non-default source kinds and guarantee levels', () => {
    mocks.sqliteAllMock.mockReturnValue([
      {
        client_request_id: 'client-b',
        file_path: '/repo/manual.ts',
        before_backup_id: 'backup-5',
        after_backup_id: 'backup-6',
        additions: 1,
        deletions: 1,
        status: 'modified',
        source_kind: 'manual_revert',
        guarantee_level: 'strong',
        observability_json: null,
        backup_before_ref_json: '{bad-json',
        backup_after_ref_json: '{also-bad',
        tool_name: 'restore',
        tool_call_id: 'tool-3',
        request_id: 'client-b:tool:tool-3',
        created_at: '2026-03-30T00:00:02.000Z',
      },
    ]);

    expect(listSessionFileDiffs({ sessionId: 'session-a', userId: 'user-a' })).toEqual([
      {
        file: '/repo/manual.ts',
        before: '',
        after: '',
        additions: 1,
        deletions: 1,
        clientRequestId: 'client-b',
        status: 'modified',
        sourceKind: 'manual_revert',
        guaranteeLevel: 'strong',
        requestId: 'client-b:tool:tool-3',
        toolName: 'restore',
        toolCallId: 'tool-3',
      },
    ]);
  });
});
