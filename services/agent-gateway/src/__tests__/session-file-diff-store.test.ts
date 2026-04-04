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
  deleteRequestFileDiffs,
  listRequestFileDiffs,
  listSessionFileDiffs,
  persistSessionFileDiffs,
} from '../session-file-diff-store.js';

describe('session-file-diff-store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
      null,
      'req-a',
      'write',
      null,
      '/repo/a.ts',
      'a',
      'b',
      1,
      1,
      'modified',
      'structured_tool_diff',
      'medium',
      'null',
      'null',
      'null',
    ]);
  });

  it('persists trace metadata when provided', () => {
    persistSessionFileDiffs({
      sessionId: 'session-a',
      userId: 'user-a',
      clientRequestId: 'client-1',
      requestId: 'req-a',
      toolName: 'write',
      toolCallId: 'tool-1',
      observability: {
        presentedToolName: 'Write',
        canonicalToolName: 'write',
        toolSurfaceProfile: 'openawork',
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
    expect(mocks.sqliteRunMock.mock.calls.at(-1)?.[1]).toEqual([
      'session-a',
      'user-a',
      'client-1',
      'req-a',
      'write',
      'tool-1',
      '/repo/a.ts',
      'a',
      'b',
      1,
      1,
      'modified',
      'structured_tool_diff',
      'strong',
      JSON.stringify({
        presentedToolName: 'Write',
        canonicalToolName: 'write',
        toolSurfaceProfile: 'openawork',
      }),
      'null',
      'null',
    ]);
  });

  it('lists durable file diffs for a session', () => {
    mocks.sqliteAllMock.mockReturnValue([
      {
        client_request_id: 'client-a',
        file_path: '/repo/a.ts',
        before_text: 'a',
        after_text: 'b',
        additions: 1,
        deletions: 1,
        status: 'modified',
        source_kind: 'structured_tool_diff',
        guarantee_level: 'strong',
        observability_json: JSON.stringify({
          presentedToolName: 'Write',
          canonicalToolName: 'write',
          toolSurfaceProfile: 'openawork',
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
        before: 'a',
        after: 'b',
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
          toolSurfaceProfile: 'openawork',
        },
        backupBeforeRef: {
          backupId: 'backup-1',
          kind: 'before_write',
          storagePath: '/tmp/backup-1',
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
        before_text: 'a',
        after_text: 'b',
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
        before: 'a',
        after: 'b',
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
        before_text: 'a',
        after_text: 'b',
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
        before: 'a',
        after: 'b',
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
