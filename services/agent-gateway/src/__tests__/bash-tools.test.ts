import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db.js', () => ({
  WORKSPACE_ACCESS_RESTRICTED: false,
  WORKSPACE_ROOT: '/home/await/project/OpenAWork',
  WORKSPACE_ROOTS: ['/home/await/project/OpenAWork'],
}));

import { runBashCommand } from '../bash-tools.js';

let workspaceRoot: string;

async function execGit(args: string[], cwd: string): Promise<void> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  await execFileAsync('git', args, { cwd });
}

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), 'openawork-bash-'));
  await execGit(['init'], workspaceRoot);
  await execGit(['config', 'user.email', 'test@example.com'], workspaceRoot);
  await execGit(['config', 'user.name', 'Test User'], workspaceRoot);
  await writeFile(join(workspaceRoot, 'tracked.txt'), 'hello\n', 'utf-8');
  await execGit(['add', '.'], workspaceRoot);
  await execGit(['commit', '-m', 'initial'], workspaceRoot);
});

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
});

describe('bash-tools', () => {
  it('captures workspace reconcile diffs with weak guarantee after bash writes files', async () => {
    const result = await runBashCommand({
      command: 'cp tracked.txt copied.txt',
      timeout: 30000,
      workdir: workspaceRoot,
    });

    expect(result.exitCode).toBe(0);
    expect(result.diffs).toEqual([
      {
        file: 'copied.txt',
        before: '',
        after: 'hello\n',
        additions: 1,
        deletions: 0,
        status: 'added',
        sourceKind: 'workspace_reconcile',
        guaranteeLevel: 'weak',
      },
    ]);
  });
});
