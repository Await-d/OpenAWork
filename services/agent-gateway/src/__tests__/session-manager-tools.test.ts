import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  buildSessionFileChangesProjectionMock: vi.fn(),
  sqliteAllMock: vi.fn(),
  sqliteGetMock: vi.fn(),
  listSessionMessagesMock: vi.fn(),
  listSessionTodoLanesMock: vi.fn(),
  parseSessionMetadataJsonMock: vi.fn(),
  reconcileSessionStateStatusMock: vi.fn(),
  extractMessageTextMock: vi.fn(),
}));

vi.mock('../db.js', () => ({
  sqliteAll: mocked.sqliteAllMock,
  sqliteGet: mocked.sqliteGetMock,
}));

vi.mock('../session-message-store.js', () => ({
  listSessionMessages: mocked.listSessionMessagesMock,
  extractMessageText: mocked.extractMessageTextMock,
}));

vi.mock('../todo-tools.js', () => ({
  listSessionTodoLanes: mocked.listSessionTodoLanesMock,
}));

vi.mock('../session-workspace-metadata.js', () => ({
  parseSessionMetadataJson: mocked.parseSessionMetadataJsonMock,
}));

vi.mock('../session-runtime-reconciler.js', () => ({
  reconcileSessionRuntime: mocked.reconcileSessionStateStatusMock,
}));

vi.mock('../session-file-changes-projection.js', () => ({
  buildSessionFileChangesProjection: mocked.buildSessionFileChangesProjectionMock,
}));

import {
  runSessionInfoTool,
  runSessionListTool,
  runSessionReadTool,
  runSessionSearchTool,
} from '../session-manager-tools.js';

describe('session-manager-tools', () => {
  beforeEach(() => {
    mocked.buildSessionFileChangesProjectionMock.mockReset();
    mocked.buildSessionFileChangesProjectionMock.mockReturnValue({
      fileDiffs: [],
      snapshots: [],
      summary: {
        totalFileDiffs: 0,
        snapshotCount: 0,
        totalAdditions: 0,
        totalDeletions: 0,
        sourceKinds: [],
        weakestGuaranteeLevel: undefined,
        latestSnapshotRef: undefined,
        latestSnapshotScopeKind: undefined,
        latestSnapshotAt: undefined,
      },
    });
    mocked.reconcileSessionStateStatusMock.mockReset();
    mocked.reconcileSessionStateStatusMock.mockImplementation(() => ({
      previousStatus: null,
      status: null,
      wasReset: false,
    }));
  });

  it('lists sessions in markdown table form', async () => {
    mocked.sqliteAllMock.mockReturnValue([
      {
        id: 'ses_1',
        metadata_json: JSON.stringify({ workingDirectory: '/repo' }),
        state_status: 'idle',
        title: 'First session',
        created_at: '2026-03-29T10:00:00.000Z',
        updated_at: '2026-03-29T11:00:00.000Z',
      },
    ]);
    mocked.parseSessionMetadataJsonMock.mockReturnValue({ workingDirectory: '/repo' });
    mocked.listSessionMessagesMock.mockReturnValue([{ id: 'msg-1' }]);

    const output = await runSessionListTool('user-1', { project_path: '/repo' });
    expect(output).toContain('| Session ID | Messages | First | Last | Status | Title |');
    expect(output).toContain('ses_1');
  });

  it('shows reconciled runtime status in list output', async () => {
    mocked.sqliteAllMock.mockReturnValue([
      {
        id: 'ses_runtime',
        metadata_json: JSON.stringify({ workingDirectory: '/repo' }),
        state_status: 'running',
        title: 'Runtime session',
        created_at: '2026-03-29T10:00:00.000Z',
        updated_at: '2026-03-29T11:00:00.000Z',
      },
    ]);
    mocked.parseSessionMetadataJsonMock.mockReturnValue({ workingDirectory: '/repo' });
    mocked.listSessionMessagesMock.mockReturnValue([{ id: 'msg-1' }]);
    mocked.reconcileSessionStateStatusMock.mockReturnValue({
      previousStatus: 'running',
      status: 'idle',
      wasReset: true,
    });

    const output = await runSessionListTool('user-1', { project_path: '/repo' });

    expect(output).toContain(
      '| ses_runtime | 1 | 2026-03-29T10:00:00.000Z | 2026-03-29T11:00:00.000Z | idle | Runtime session |',
    );
  });

  it('reads messages and optional todos', () => {
    mocked.sqliteGetMock.mockReturnValue({
      id: 'ses_1',
      metadata_json: '{}',
      state_status: 'idle',
      title: 'First session',
      created_at: '2026-03-29T10:00:00.000Z',
      updated_at: '2026-03-29T11:00:00.000Z',
    });
    mocked.listSessionMessagesMock.mockReturnValue([
      {
        id: 'msg-1',
        role: 'user',
        createdAt: Date.parse('2026-03-29T10:01:00.000Z'),
        content: [{ type: 'text', text: 'hello' }],
      },
      {
        id: 'msg-2',
        role: 'assistant',
        createdAt: Date.parse('2026-03-29T10:02:00.000Z'),
        content: [{ type: 'text', text: 'world' }],
      },
    ]);
    mocked.listSessionTodoLanesMock.mockReturnValue({
      main: [{ content: 'x', status: 'pending', priority: 'high' }],
      temp: [],
    });

    const output = runSessionReadTool('user-1', {
      session_id: 'ses_1',
      include_todos: true,
      include_transcript: false,
    });
    expect(output).toContain('Session: ses_1');
    expect(output).toContain('[Message 1] user');
    expect(output).toContain('Todos:');
  });

  it('renders unified file-change projection in read output', () => {
    mocked.sqliteGetMock.mockReturnValue({
      id: 'ses_projection',
      metadata_json: '{}',
      state_status: 'idle',
      title: 'Projection',
      created_at: '2026-03-29T10:00:00.000Z',
      updated_at: '2026-03-29T11:00:00.000Z',
    });
    mocked.listSessionMessagesMock.mockReturnValue([]);
    mocked.buildSessionFileChangesProjectionMock.mockReturnValue({
      fileDiffs: [
        {
          file: '/repo/script.sh',
          additions: 2,
          deletions: 1,
          guaranteeLevel: 'weak',
          sourceKind: 'workspace_reconcile',
        },
      ],
      snapshots: [
        {
          snapshotRef: 'req:req-1',
          scopeKind: 'request',
          summary: {
            files: 1,
            additions: 2,
            deletions: 1,
            guaranteeLevel: 'weak',
          },
        },
      ],
      summary: {
        totalFileDiffs: 1,
        snapshotCount: 1,
        totalAdditions: 2,
        totalDeletions: 1,
        sourceKinds: ['workspace_reconcile'],
        weakestGuaranteeLevel: 'weak',
        latestSnapshotRef: 'req:req-1',
        latestSnapshotScopeKind: 'request',
        latestSnapshotAt: '2026-03-29T11:00:00.000Z',
      },
    });

    const output = runSessionReadTool('user-1', {
      session_id: 'ses_projection',
      include_todos: false,
      include_transcript: false,
    });

    expect(output).toContain('Debug File Diffs:');
    expect(output).toContain('guarantee=weak');
    expect(output).toContain('source=workspace_reconcile');
    expect(output).toContain('Debug Snapshots:');
    expect(output).toContain('req:req-1 · scope=request');
  });

  it('includes transcript rows when requested', () => {
    mocked.sqliteGetMock.mockReturnValue({
      id: 'ses_1',
      metadata_json: '{}',
      state_status: 'idle',
      title: 'First session',
      created_at: '2026-03-29T10:00:00.000Z',
      updated_at: '2026-03-29T11:00:00.000Z',
    });
    mocked.listSessionMessagesMock.mockReturnValue([]);
    mocked.sqliteAllMock.mockReturnValue([
      {
        tool_name: 'bash',
        request_id: 'req-1',
        is_error: 0,
        duration_ms: 12,
        created_at: '2026-03-29T10:05:00.000Z',
      },
    ]);

    const output = runSessionReadTool('user-1', {
      session_id: 'ses_1',
      include_todos: false,
      include_transcript: true,
    });
    expect(output).toContain('Transcript:');
    expect(output).toContain('bash · ok · 12ms · req-1');
  });

  it('searches message text across sessions', () => {
    mocked.sqliteAllMock.mockReturnValue([
      {
        id: 'ses_1',
        metadata_json: '{}',
        state_status: 'idle',
        title: 'First',
        created_at: '2026-03-29T10:00:00.000Z',
        updated_at: '2026-03-29T11:00:00.000Z',
      },
    ]);
    mocked.listSessionMessagesMock.mockReturnValue([
      { id: 'msg-1', role: 'assistant', createdAt: 1, content: [] },
    ]);
    mocked.extractMessageTextMock.mockReturnValue('Found a needle in haystack');

    const output = runSessionSearchTool('user-1', {
      query: 'needle',
      case_sensitive: false,
      limit: 20,
    });
    expect(output).toContain('Found 1 matches');
    expect(output).toContain('ses_1');
  });

  it('returns session info summary', async () => {
    mocked.sqliteGetMock.mockReturnValue({
      id: 'ses_1',
      metadata_json: JSON.stringify({ parentSessionId: 'root-1' }),
      state_status: 'running',
      title: 'Info',
      created_at: '2026-03-29T10:00:00.000Z',
      updated_at: '2026-03-29T11:00:00.000Z',
    });
    mocked.sqliteAllMock.mockReturnValue([
      { id: 'child-1', metadata_json: JSON.stringify({ parentSessionId: 'ses_1' }) },
    ]);
    mocked.listSessionMessagesMock.mockReturnValue([
      { createdAt: 1, content: [], id: 'm1', role: 'user' },
    ]);
    mocked.listSessionTodoLanesMock.mockReturnValue({ main: [], temp: [] });
    mocked.parseSessionMetadataJsonMock.mockImplementation((value: string) => JSON.parse(value));
    mocked.buildSessionFileChangesProjectionMock.mockReturnValue({
      fileDiffs: [],
      snapshots: [],
      summary: {
        totalFileDiffs: 3,
        snapshotCount: 2,
        totalAdditions: 7,
        totalDeletions: 1,
        sourceKinds: ['structured_tool_diff', 'workspace_reconcile'],
        weakestGuaranteeLevel: 'weak',
        latestSnapshotRef: 'backup:backup-1',
        latestSnapshotScopeKind: 'backup',
        latestSnapshotAt: '2026-03-29T11:00:00.000Z',
      },
    });

    const output = await runSessionInfoTool('user-1', { session_id: 'ses_1' });
    expect(output).toContain('Session ID: ses_1');
    expect(output).toContain('Children: 1');
    expect(output).toContain('Parent Session: root-1');
    expect(output).toContain('Weakest Guarantee: weak');
    expect(output).toContain('Sources: structured_tool_diff, workspace_reconcile');
    expect(output).toContain('Latest Snapshot: backup:backup-1');
  });
});
