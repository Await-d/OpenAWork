import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  captureBeforeWriteBackupMock: vi.fn<
    (...args: unknown[]) => Promise<
      | {
          backupId: string;
          kind: 'before_write';
          contentHash: string;
          storagePath: string;
        }
      | undefined
    >
  >(async () => ({
    backupId: 'backup-alias-1',
    kind: 'before_write' as const,
    contentHash: 'hash-alias-1',
    storagePath: '/tmp/backup-alias-1.txt',
  })),
  sqliteAllMock: vi.fn(() => []),
  sqliteGetMock: vi.fn((query: string) => {
    if (query.includes('SELECT user_id FROM sessions')) {
      return { user_id: 'user-1' };
    }
    if (query.includes('FROM permission_requests pr')) {
      return { id: 'perm-1', decision: 'session' };
    }
    if (query.includes('SELECT metadata_json')) {
      return { metadata_json: '{}' };
    }
    return undefined;
  }),
  sqliteRunMock: vi.fn(),
}));

vi.mock('../db.js', () => ({
  WORKSPACE_ACCESS_RESTRICTED: false,
  WORKSPACE_ROOT: '/home/await/project/OpenAWork',
  WORKSPACE_ROOTS: ['/home/await/project/OpenAWork'],
  sqliteAll: mocks.sqliteAllMock,
  sqliteGet: mocks.sqliteGetMock,
  sqliteRun: mocks.sqliteRunMock,
}));

vi.mock('../session-file-backup-store.js', () => ({
  captureBeforeWriteBackup: mocks.captureBeforeWriteBackupMock,
}));

import { createDefaultSandbox } from '../tool-sandbox.js';

let filePath = '';

describe('tool-sandbox write aliases', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const dir = await mkdtemp(join(tmpdir(), 'openawork-alias-'));
    filePath = join(dir, 'file.ts');
    await writeFile(filePath, 'before', 'utf8');
  });

  afterEach(async () => {
    if (filePath) {
      await rm(join(filePath, '..'), { recursive: true, force: true });
      filePath = '';
    }
  });

  it('routes file_write through the backup-aware write path', async () => {
    const sandbox = createDefaultSandbox();
    const result = await sandbox.execute(
      {
        toolCallId: 'call-1',
        toolName: 'file_write',
        rawInput: { filePath, content: 'after' },
      },
      new AbortController().signal,
      'session-1',
      { clientRequestId: 'req-1', nextRound: 1, requestData: { clientRequestId: 'req-1' } },
    );

    expect(mocks.captureBeforeWriteBackupMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        userId: 'user-1',
        requestId: 'req-1',
        toolCallId: 'call-1',
        toolName: 'file_write',
        filePath,
        content: 'before',
      }),
    );
    expect(result.isError).toBe(false);
    expect(
      (result.output as { filediff: { backupBeforeRef?: unknown } }).filediff.backupBeforeRef,
    ).toEqual({
      backupId: 'backup-alias-1',
      kind: 'before_write',
      contentHash: 'hash-alias-1',
      storagePath: '/tmp/backup-alias-1.txt',
    });
  });

  it('allows degraded writes when backup capture returns undefined', async () => {
    mocks.captureBeforeWriteBackupMock.mockImplementationOnce(async () => undefined);
    const sandbox = createDefaultSandbox();

    const result = await sandbox.execute(
      {
        toolCallId: 'call-2',
        toolName: 'file_write',
        rawInput: { filePath, content: 'after' },
      },
      new AbortController().signal,
      'session-1',
      { clientRequestId: 'req-2', nextRound: 1, requestData: { clientRequestId: 'req-2' } },
    );

    expect(result.isError).toBe(false);
    expect(
      (result.output as { filediff: { backupBeforeRef?: unknown } }).filediff.backupBeforeRef,
    ).toBeUndefined();
  });
});
