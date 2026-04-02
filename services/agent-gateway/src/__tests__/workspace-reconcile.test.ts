import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  captureWorkspaceReconcileSnapshot,
  collectWorkspaceReconcileDiffs,
} from '../workspace-reconcile.js';

let workspaceRoot: string;

async function execGit(args: string[], cwd: string): Promise<void> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  await execFileAsync('git', args, { cwd });
}

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), 'openawork-reconcile-'));
  await execGit(['init'], workspaceRoot);
  await execGit(['config', 'user.email', 'test@example.com'], workspaceRoot);
  await execGit(['config', 'user.name', 'Test User'], workspaceRoot);
  await writeFile(join(workspaceRoot, 'tracked.txt'), 'hello\nworld\n', 'utf-8');
  await execGit(['add', '.'], workspaceRoot);
  await execGit(['commit', '-m', 'initial'], workspaceRoot);
});

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
});

describe('workspace-reconcile', () => {
  it('detects changed content even when before/after numstat signatures match', async () => {
    await writeFile(join(workspaceRoot, 'tracked.txt'), 'hello\nmars\n', 'utf-8');
    const before = await captureWorkspaceReconcileSnapshot(workspaceRoot);

    await writeFile(join(workspaceRoot, 'tracked.txt'), 'hello\nvenus\n', 'utf-8');
    const after = await captureWorkspaceReconcileSnapshot(workspaceRoot);

    await expect(collectWorkspaceReconcileDiffs({ workspaceRoot, before, after })).resolves.toEqual(
      [
        {
          file: 'tracked.txt',
          before: 'hello\nmars\n',
          after: 'hello\nvenus\n',
          additions: 1,
          deletions: 1,
          status: 'modified',
          sourceKind: 'workspace_reconcile',
          guaranteeLevel: 'weak',
        },
      ],
    );
  });

  it('detects when a dirty file is restored back to a clean workspace state', async () => {
    await writeFile(join(workspaceRoot, 'tracked.txt'), 'hello\nmars\n', 'utf-8');
    const before = await captureWorkspaceReconcileSnapshot(workspaceRoot);

    await writeFile(join(workspaceRoot, 'tracked.txt'), 'hello\nworld\n', 'utf-8');
    const after = await captureWorkspaceReconcileSnapshot(workspaceRoot);

    await expect(collectWorkspaceReconcileDiffs({ workspaceRoot, before, after })).resolves.toEqual(
      [
        {
          file: 'tracked.txt',
          before: 'hello\nmars\n',
          after: 'hello\nworld\n',
          additions: 1,
          deletions: 1,
          status: 'modified',
          sourceKind: 'workspace_reconcile',
          guaranteeLevel: 'weak',
        },
      ],
    );
  });
});
