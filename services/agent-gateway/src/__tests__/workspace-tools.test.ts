import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

type PostWriteDiagnostic = {
  file: string;
  severity: string;
  line: number;
  message: string;
};

const lspMocks = vi.hoisted(() => ({
  touchFileMock: vi.fn(async () => undefined),
  getPostWriteDiagnosticsMock: vi.fn(
    async (_filePaths: string[]): Promise<PostWriteDiagnostic[]> => [],
  ),
}));

vi.mock('../db.js', () => ({
  WORKSPACE_ROOT: '/home/await/project/OpenAWork',
}));

vi.mock('../workspace-safety.js', () => ({
  ensureIgnoreRulesLoadedForPath: vi.fn(async () => undefined),
}));

vi.mock('../workspace-paths.js', () => ({
  isPathWithinRoot: () => true,
  validateWorkspacePath: (value: string) => value,
  validateWorkspaceRelativePath: (value: string) => value,
}));

vi.mock('@openAwork/agent-core', async () => ({
  defaultIgnoreManager: {
    shouldIgnore: () => false,
  },
}));

vi.mock('../lsp/router.js', () => ({
  lspManager: {
    touchFile: lspMocks.touchFileMock,
  },
}));

vi.mock('../lsp-tools.js', () => ({
  getPostWriteDiagnostics: lspMocks.getPostWriteDiagnosticsMock,
  postWriteDiagnosticSchema: z.object({
    file: z.string(),
    severity: z.string(),
    line: z.number(),
    message: z.string(),
  }),
}));

import {
  executeWorkspaceCreateFile,
  executeWorkspaceWriteFile,
  executeWriteTool,
  readTool,
} from '../workspace-tools.js';

let filePath = '';

describe('workspace-tools backup hook', () => {
  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'openawork-write-'));
    filePath = join(dir, 'example.ts');
    await writeFile(filePath, 'const value = 1;\n', 'utf8');
  });

  afterEach(async () => {
    if (filePath) {
      await rm(join(filePath, '..'), { recursive: true, force: true });
      filePath = '';
    }
    vi.clearAllMocks();
  });

  it('prewarms LSP after reading a code file without waiting for diagnostics', async () => {
    const output = await readTool.execute({ filePath }, new AbortController().signal);

    expect(output.path).toBe(filePath);
    expect(lspMocks.touchFileMock).toHaveBeenCalledWith(filePath, false);
    expect(lspMocks.getPostWriteDiagnosticsMock).not.toHaveBeenCalled();
  });

  it('attaches backupBeforeRef for workspace_write_file helper', async () => {
    const diagnostics = [
      {
        file: filePath,
        severity: 'warning',
        line: 1,
        message: 'write diagnostic',
      },
    ];
    lspMocks.getPostWriteDiagnosticsMock.mockImplementationOnce(
      async (): Promise<PostWriteDiagnostic[]> => diagnostics,
    );

    const output = await executeWorkspaceWriteFile(
      { path: filePath, content: 'const value = 2;\n' },
      {
        beforeWriteBackup: async () => ({
          backupId: 'backup-1',
          kind: 'before_write',
          contentHash: 'hash-1',
          storagePath: '/tmp/backup-1.txt',
        }),
      },
    );

    expect(output.filediff.backupBeforeRef).toEqual({
      backupId: 'backup-1',
      kind: 'before_write',
      contentHash: 'hash-1',
      storagePath: '/tmp/backup-1.txt',
    });
    expect(lspMocks.touchFileMock).toHaveBeenCalledWith(filePath, true);
    expect(lspMocks.getPostWriteDiagnosticsMock).toHaveBeenCalledWith([filePath]);
    expect(output.diagnostics).toEqual(diagnostics);
  });

  it('attaches backupBeforeRef for write helper on existing files', async () => {
    const output = await executeWriteTool(
      { path: filePath, content: 'const value = 3;\n' },
      new AbortController().signal,
      {
        beforeWriteBackup: async () => ({
          backupId: 'backup-2',
          kind: 'before_write',
          contentHash: 'hash-2',
          storagePath: '/tmp/backup-2.txt',
        }),
      },
    );

    expect(output.created).toBe(false);
    expect(output.filediff.backupBeforeRef).toEqual({
      backupId: 'backup-2',
      kind: 'before_write',
      contentHash: 'hash-2',
      storagePath: '/tmp/backup-2.txt',
    });
  });

  it('creates a new file without synthesizing a backupBeforeRef', async () => {
    const createdPath = join(filePath, '..', 'created.ts');
    const diagnostics = [
      {
        file: createdPath,
        severity: 'warning',
        line: 1,
        message: 'create diagnostic',
      },
    ];
    lspMocks.getPostWriteDiagnosticsMock.mockImplementationOnce(
      async (): Promise<PostWriteDiagnostic[]> => diagnostics,
    );
    const output = await executeWorkspaceCreateFile({
      path: createdPath,
      content: 'export const created = true;\n',
    });

    expect(output.created).toBe(true);
    expect(output.filediff.backupBeforeRef).toBeUndefined();
    expect(lspMocks.touchFileMock).toHaveBeenCalledWith(createdPath, true);
    expect(lspMocks.getPostWriteDiagnosticsMock).toHaveBeenCalledWith([createdPath]);
    expect(output.diagnostics).toEqual(diagnostics);
  });
});
