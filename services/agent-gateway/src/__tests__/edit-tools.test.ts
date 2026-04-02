import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  persistSessionFileBackupMock: vi.fn(async () => ({
    backupId: 'backup-1',
    kind: 'before_write' as const,
    contentHash: 'hash-1',
    storagePath: '/tmp/backup-1.txt',
  })),
  sqliteAllMock: vi.fn(),
  touchFileMock: vi.fn(async () => undefined),
}));

vi.mock('../db.js', () => ({
  sqliteAll: mocks.sqliteAllMock,
}));

vi.mock('../lsp/router.js', () => ({
  lspManager: {
    touchFile: mocks.touchFileMock,
  },
}));

vi.mock('../workspace-paths.js', () => ({
  validateWorkspacePath: (value: string) => value,
}));

vi.mock('../session-file-backup-store.js', () => ({
  persistSessionFileBackup: mocks.persistSessionFileBackupMock,
}));

import { createEditTool } from '../edit-tools.js';

let filePath = '';

describe('edit-tools', () => {
  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'openawork-edit-'));
    filePath = join(dir, 'example.ts');
    await writeFile(filePath, 'const value = 1;\n', 'utf8');
    mocks.sqliteAllMock.mockReturnValue([
      {
        input_json: JSON.stringify({ path: filePath }),
        output_json: JSON.stringify({ path: filePath }),
      },
    ]);
  });

  afterEach(async () => {
    if (filePath) {
      await rm(dirname(filePath), { recursive: true, force: true });
      filePath = '';
    }
    vi.clearAllMocks();
  });

  it('captures backupBeforeRef before editing an existing file', async () => {
    const tool = createEditTool('session-a', 'user-a', 'req-a', 'call-1');
    const result = await tool.execute(
      {
        filePath,
        oldString: '1',
        newString: '2',
        replaceAll: false,
      },
      new AbortController().signal,
    );

    expect(mocks.persistSessionFileBackupMock).toHaveBeenCalledWith({
      sessionId: 'session-a',
      userId: 'user-a',
      requestId: 'req-a',
      toolCallId: 'call-1',
      toolName: 'edit',
      filePath,
      content: 'const value = 1;\n',
      kind: 'before_write',
    });
    expect(result.filediff.backupBeforeRef).toEqual({
      backupId: 'backup-1',
      kind: 'before_write',
      contentHash: 'hash-1',
      storagePath: '/tmp/backup-1.txt',
    });
  });
});
