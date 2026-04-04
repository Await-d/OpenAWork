import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  mkdirMock: vi.fn(async () => undefined),
  readFileMock: vi.fn(async () => 'backup-content'),
  rmMock: vi.fn(async () => undefined),
  sqliteAllMock: vi.fn(),
  sqliteGetMock: vi.fn(),
  sqliteRunMock: vi.fn(),
  writeFileMock: vi.fn(async () => undefined),
}));

vi.mock('node:fs/promises', () => ({
  mkdir: mocks.mkdirMock,
  readFile: mocks.readFileMock,
  rm: mocks.rmMock,
  writeFile: mocks.writeFileMock,
}));

vi.mock('../db.js', () => ({
  sqliteAll: mocks.sqliteAllMock,
  sqliteGet: mocks.sqliteGetMock,
  sqliteRun: mocks.sqliteRunMock,
}));

import {
  cleanupSessionBackupFiles,
  captureBeforeWriteBackup,
  classifyBackupContent,
  getSessionFileBackup,
  listSessionFileBackups,
  persistSessionFileBackup,
  readSessionFileBackupContent,
  resolveFileBackupFailurePolicy,
} from '../session-file-backup-store.js';

describe('session-file-backup-store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['OPENAWORK_DATA_DIR'] = '/tmp/openawork-data';
    delete process.env['OPENAWORK_DATABASE_PATH'];
    delete process.env['DATABASE_URL'];
  });

  it('persists backup metadata and writes backup content', async () => {
    mocks.sqliteGetMock.mockReturnValue(undefined);

    const backup = await persistSessionFileBackup({
      sessionId: 'session-a',
      userId: 'user-a',
      filePath: '/repo/file.ts',
      content: 'original content',
      kind: 'before_write',
      toolName: 'edit',
      requestId: 'req-a',
      toolCallId: 'call-1',
    });

    expect(backup.kind).toBe('before_write');
    expect(backup.backupId).toBeTruthy();
    expect(backup.contentHash).toHaveLength(64);
    expect(backup.storagePath).toContain('/tmp/openawork-data/file-backups/text/');
    expect(mocks.mkdirMock).toHaveBeenCalledTimes(1);
    expect(mocks.writeFileMock).toHaveBeenCalledTimes(1);
    expect(mocks.sqliteRunMock).toHaveBeenCalledTimes(1);
  });

  it('reuses an existing backup when content hash already exists', async () => {
    mocks.sqliteGetMock.mockReturnValue({
      backup_id: 'backup-1',
      kind: 'before_write',
      content_hash: 'hash-1',
      storage_path: '/tmp/backup-1.txt',
      artifact_id: null,
    });

    await expect(
      persistSessionFileBackup({
        sessionId: 'session-a',
        userId: 'user-a',
        filePath: '/repo/file.ts',
        content: 'original content',
        kind: 'before_write',
        toolName: 'edit',
      }),
    ).resolves.toEqual({
      backupId: 'backup-1',
      kind: 'before_write',
      contentHash: 'hash-1',
      storagePath: '/tmp/backup-1.txt',
      artifactId: undefined,
    });
    expect(mocks.writeFileMock).not.toHaveBeenCalled();
    expect(mocks.sqliteRunMock).not.toHaveBeenCalled();
  });

  it('reuses content-addressed storage across different sessions and paths', async () => {
    mocks.sqliteGetMock.mockReturnValueOnce(undefined).mockReturnValueOnce({
      backup_id: 'shared-backup',
      kind: 'before_write',
      content_hash: 'shared-hash',
      content_tier: 'text',
      content_format: 'txt',
      hash_scope: 'raw',
      storage_path: '/data/file-backups/text/shared-hash.txt',
      artifact_id: null,
    });

    const backup = await persistSessionFileBackup({
      sessionId: 'session-b',
      userId: 'user-b',
      filePath: '/repo/other.ts',
      content: 'same content',
      kind: 'before_write',
      toolName: 'write',
    });

    expect(backup.storagePath).toBe('/data/file-backups/text/shared-hash.txt');
    expect(mocks.writeFileMock).not.toHaveBeenCalled();
    expect(mocks.sqliteRunMock).toHaveBeenCalledTimes(1);
  });

  it('classifies notebooks but preserves raw-byte hashing semantics', () => {
    const before = JSON.stringify({
      cells: [
        {
          cell_type: 'code',
          execution_count: 7,
          outputs: [{ name: 'stdout', text: 'hi' }],
          source: ['print("hi")'],
        },
      ],
    });
    const after = JSON.stringify({
      cells: [
        {
          cell_type: 'code',
          execution_count: 8,
          outputs: [{ name: 'stdout', text: 'bye' }],
          source: ['print("hi")'],
        },
      ],
    });

    const beforeDescriptor = classifyBackupContent('/repo/notebook.ipynb', before);
    const afterDescriptor = classifyBackupContent('/repo/notebook.ipynb', after);

    expect(beforeDescriptor.contentTier).toBe('notebook');
    expect(beforeDescriptor.contentFormat).toBe('ipynb');
    expect(beforeDescriptor.hashScope).toBe('raw');
    expect(afterDescriptor.hashScope).toBe('raw');
    expect(beforeDescriptor.contentHash).not.toBe(afterDescriptor.contentHash);
  });

  it('resolves backup failure policy from environment', () => {
    process.env['OPENAWORK_FILE_BACKUP_FAILURE_POLICY'] = 'degrade';
    expect(resolveFileBackupFailurePolicy()).toBe('degrade');
    delete process.env['OPENAWORK_FILE_BACKUP_FAILURE_POLICY'];
    expect(resolveFileBackupFailurePolicy()).toBe('block');
  });

  it('degrades backup capture on failure when policy is degrade', async () => {
    process.env['OPENAWORK_FILE_BACKUP_FAILURE_POLICY'] = 'degrade';
    mocks.sqliteGetMock.mockReturnValue(undefined);
    mocks.writeFileMock.mockRejectedValueOnce(new Error('disk full'));

    await expect(
      captureBeforeWriteBackup({
        sessionId: 'session-a',
        userId: 'user-a',
        filePath: '/repo/file.ts',
        content: 'original content',
        kind: 'before_write',
        toolName: 'edit',
      }),
    ).resolves.toBeUndefined();

    delete process.env['OPENAWORK_FILE_BACKUP_FAILURE_POLICY'];
  });

  it('blocks binary backup capture by default', async () => {
    await expect(
      captureBeforeWriteBackup({
        sessionId: 'session-a',
        userId: 'user-a',
        filePath: '/repo/image.png',
        content: 'binary-ish',
        kind: 'before_write',
        toolName: 'write',
      }),
    ).rejects.toThrow('Backup capture does not support binary content');
  });

  it('lists and retrieves session backup records', async () => {
    mocks.sqliteAllMock.mockReturnValue([
      {
        backup_id: 'backup-1',
        session_id: 'session-a',
        user_id: 'user-a',
        file_path: '/repo/file.ts',
        content_hash: 'hash-1',
        content_tier: 'text',
        content_format: 'ts',
        hash_scope: 'raw',
        kind: 'before_write',
        source_tool: 'edit',
        source_request_id: 'req-a',
        tool_call_id: 'call-1',
        storage_path: '/data/file-backups/text/hash-1.ts',
        artifact_id: null,
        size_bytes: 12,
        created_at: '2026-04-02T10:00:00.000Z',
      },
    ]);
    mocks.sqliteGetMock.mockReturnValueOnce({
      backup_id: 'backup-1',
      session_id: 'session-a',
      user_id: 'user-a',
      file_path: '/repo/file.ts',
      content_hash: 'hash-1',
      content_tier: 'text',
      content_format: 'ts',
      hash_scope: 'raw',
      kind: 'before_write',
      source_tool: 'edit',
      source_request_id: 'req-a',
      tool_call_id: 'call-1',
      storage_path: '/data/file-backups/text/hash-1.ts',
      artifact_id: null,
      size_bytes: 12,
      created_at: '2026-04-02T10:00:00.000Z',
    });

    expect(listSessionFileBackups({ sessionId: 'session-a', userId: 'user-a' })[0]).toMatchObject({
      backupId: 'backup-1',
      sessionId: 'session-a',
      userId: 'user-a',
      filePath: '/repo/file.ts',
      contentTier: 'text',
      sourceTool: 'edit',
    });
    expect(
      getSessionFileBackup({ backupId: 'backup-1', sessionId: 'session-a', userId: 'user-a' }),
    ).toMatchObject({
      backupId: 'backup-1',
      storagePath: '/data/file-backups/text/hash-1.ts',
    });
  });

  it('reads backup content by backup id', async () => {
    mocks.sqliteGetMock.mockReturnValue({
      backup_id: 'backup-1',
      session_id: 'session-a',
      user_id: 'user-a',
      file_path: '/repo/file.ts',
      content_hash: 'hash-1',
      content_tier: 'text',
      content_format: 'ts',
      hash_scope: 'raw',
      kind: 'before_write',
      source_tool: 'edit',
      source_request_id: 'req-a',
      tool_call_id: 'call-1',
      storage_path: '/data/file-backups/text/hash-1.ts',
      artifact_id: null,
      size_bytes: 12,
      created_at: '2026-04-02T10:00:00.000Z',
    });

    await expect(
      readSessionFileBackupContent({
        backupId: 'backup-1',
        sessionId: 'session-a',
        userId: 'user-a',
      }),
    ).resolves.toBe('backup-content');
    expect(mocks.readFileMock).toHaveBeenCalledWith('/data/file-backups/text/hash-1.ts', 'utf8');
  });

  it('cleans up unreferenced storage paths after deleting backup rows', async () => {
    mocks.sqliteAllMock.mockReturnValue([
      {
        backup_id: 'backup-1',
        session_id: 'session-a',
        user_id: 'user-a',
        file_path: '/repo/file.ts',
        content_hash: 'hash-1',
        content_tier: 'text',
        content_format: 'ts',
        hash_scope: 'raw',
        kind: 'before_write',
        storage_path: '/data/file-backups/text/hash-1.ts',
        artifact_id: null,
        size_bytes: 12,
      },
    ]);
    mocks.sqliteGetMock.mockReturnValue({ count: 0 });

    await cleanupSessionBackupFiles({ sessionId: 'session-a', userId: 'user-a' });

    expect(mocks.sqliteRunMock).toHaveBeenCalledWith(
      'DELETE FROM session_file_backups WHERE session_id = ? AND user_id = ?',
      ['session-a', 'user-a'],
    );
    expect(mocks.rmMock).toHaveBeenCalledWith('/data/file-backups/text/hash-1.ts', { force: true });
  });

  it('keeps shared storage paths that are still referenced', async () => {
    mocks.sqliteAllMock.mockReturnValue([
      {
        backup_id: 'backup-1',
        session_id: 'session-a',
        user_id: 'user-a',
        file_path: '/repo/file.ts',
        content_hash: 'hash-1',
        content_tier: 'text',
        content_format: 'ts',
        hash_scope: 'raw',
        kind: 'before_write',
        storage_path: '/data/file-backups/text/hash-1.ts',
        artifact_id: null,
        size_bytes: 12,
      },
    ]);
    mocks.sqliteGetMock.mockReturnValue({ count: 1 });

    await cleanupSessionBackupFiles({ sessionId: 'session-a', userId: 'user-a' });

    expect(mocks.rmMock).not.toHaveBeenCalled();
  });
});
