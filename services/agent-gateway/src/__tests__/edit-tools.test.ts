import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

type PostWriteDiagnostic = {
  file: string;
  severity: string;
  line: number;
  message: string;
};

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
    backupId: 'backup-1',
    kind: 'before_write' as const,
    contentHash: 'hash-1',
    storagePath: '/tmp/backup-1.txt',
  })),
  sqliteAllMock: vi.fn(),
  touchFileMock: vi.fn(async () => undefined),
  getPostWriteDiagnosticsMock: vi.fn(
    async (_filePaths: string[]): Promise<PostWriteDiagnostic[]> => [],
  ),
}));

vi.mock('../db.js', () => ({
  sqliteAll: mocks.sqliteAllMock,
}));

vi.mock('../lsp/router.js', () => ({
  lspManager: {
    touchFile: mocks.touchFileMock,
  },
}));

vi.mock('../lsp-tools.js', () => ({
  getPostWriteDiagnostics: mocks.getPostWriteDiagnosticsMock,
  postWriteDiagnosticSchema: z.object({
    file: z.string(),
    severity: z.string(),
    line: z.number(),
    message: z.string(),
  }),
}));

vi.mock('../workspace-paths.js', () => ({
  validateWorkspacePath: (value: string) => value,
}));

vi.mock('../session-file-backup-store.js', () => ({
  captureBeforeWriteBackup: mocks.captureBeforeWriteBackupMock,
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
    const diagnostics = [
      {
        file: filePath,
        severity: 'warning',
        line: 1,
        message: 'edit diagnostic',
      },
    ];
    mocks.getPostWriteDiagnosticsMock.mockImplementationOnce(
      async (): Promise<PostWriteDiagnostic[]> => diagnostics,
    );

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

    expect(mocks.captureBeforeWriteBackupMock).toHaveBeenCalledWith({
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
    expect(mocks.touchFileMock).toHaveBeenCalledWith(filePath, true);
    expect(mocks.getPostWriteDiagnosticsMock).toHaveBeenCalledWith([filePath]);
    expect(result.diagnostics).toEqual(diagnostics);
  });

  it('degrades gracefully when backup capture returns undefined', async () => {
    mocks.captureBeforeWriteBackupMock.mockImplementationOnce(async () => undefined);

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

    expect(result.filediff.backupBeforeRef).toBeUndefined();
    expect(result.after).toBe('const value = 2;\n');
  });
});
