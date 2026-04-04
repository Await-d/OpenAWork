import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import {
  executeWorkspaceCreateFile,
  executeWorkspaceWriteFile,
  executeWriteTool,
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
  });

  it('attaches backupBeforeRef for workspace_write_file helper', async () => {
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
    const output = await executeWorkspaceCreateFile({
      path: createdPath,
      content: 'export const created = true;\n',
    });

    expect(output.created).toBe(true);
    expect(output.filediff.backupBeforeRef).toBeUndefined();
  });
});
