import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

vi.mock('../workspace-paths.js', () => ({
  validateWorkspacePath: (value: string) => value,
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

import { executeApplyPatch } from '../apply-patch-tools.js';

let dirPath = '';
let filePath = '';

describe('apply-patch-tools backup hook', () => {
  beforeEach(async () => {
    dirPath = await mkdtemp(join(tmpdir(), 'openawork-patch-'));
    filePath = join(dirPath, 'example.ts');
    await writeFile(filePath, 'const value = 1;\n', 'utf8');
  });

  afterEach(async () => {
    if (dirPath) {
      await rm(dirPath, { recursive: true, force: true });
      dirPath = '';
      filePath = '';
    }
    vi.clearAllMocks();
  });

  it('attaches backupBeforeRef for update operations', async () => {
    const patchText = [
      '*** Begin Patch',
      `*** Update File: ${filePath}`,
      '@@',
      '-const value = 1;',
      '+const value = 2;',
      '*** End Patch',
    ].join('\n');
    const diagnostics = [
      {
        file: filePath,
        severity: 'warning',
        line: 1,
        message: 'patch diagnostic',
      },
    ];
    lspMocks.getPostWriteDiagnosticsMock.mockImplementationOnce(
      async (): Promise<PostWriteDiagnostic[]> => diagnostics,
    );

    const result = await executeApplyPatch(
      { patchText },
      {
        beforeWriteBackup: async ({ content, filePath: backupPath }) => {
          expect(content).toBe('const value = 1;\n');
          expect(backupPath).toBe(filePath);
          await expect(readFile(filePath, 'utf8')).resolves.toBe('const value = 1;\n');
          return {
            backupId: 'backup-apply-1',
            kind: 'before_write',
            contentHash: 'hash-apply-1',
            storagePath: '/tmp/backup-apply-1.txt',
          };
        },
      },
    );

    expect(result.diffs[0]?.backupBeforeRef).toEqual({
      backupId: 'backup-apply-1',
      kind: 'before_write',
      contentHash: 'hash-apply-1',
      storagePath: '/tmp/backup-apply-1.txt',
    });
    expect(lspMocks.touchFileMock).toHaveBeenCalledWith(filePath, true);
    expect(lspMocks.getPostWriteDiagnosticsMock).toHaveBeenCalledWith([filePath]);
    expect(result.diagnostics).toEqual(diagnostics);
    await expect(readFile(filePath, 'utf8')).resolves.toBe('const value = 2;\n');
  });
});
