import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  mkdirMock: vi.fn(async () => undefined),
  sqliteGetMock: vi.fn(),
  sqliteRunMock: vi.fn(),
  writeFileMock: vi.fn(async () => undefined),
}));

vi.mock('node:fs/promises', () => ({
  mkdir: mocks.mkdirMock,
  writeFile: mocks.writeFileMock,
}));

vi.mock('../db.js', () => ({
  sqliteGet: mocks.sqliteGetMock,
  sqliteRun: mocks.sqliteRunMock,
}));

import { persistSessionFileBackup } from '../session-file-backup-store.js';

describe('session-file-backup-store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(backup.storagePath).toContain('/data/file-backups/session-a/');
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
});
