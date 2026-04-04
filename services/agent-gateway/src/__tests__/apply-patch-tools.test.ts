import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../workspace-paths.js', () => ({
  validateWorkspacePath: (value: string) => value,
}));

vi.mock('@openAwork/agent-core', async () => ({
  defaultIgnoreManager: {
    shouldIgnore: () => false,
  },
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
    await expect(readFile(filePath, 'utf8')).resolves.toBe('const value = 2;\n');
  });
});
