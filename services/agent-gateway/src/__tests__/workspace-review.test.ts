import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  getWorkspaceReviewDiff,
  listWorkspaceReviewChanges,
  revertWorkspaceReviewPath,
} from '../workspace-review.js';

let workspaceRoot: string;

async function execGit(args: string[], cwd: string): Promise<void> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  await execFileAsync('git', args, { cwd });
}

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), 'openawork-review-'));
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

describe('workspace review helpers', () => {
  it('lists modified/added/deleted/renamed files with change metadata', async () => {
    await writeFile(join(workspaceRoot, 'tracked.txt'), 'hello\nworld\n', 'utf-8');
    await writeFile(join(workspaceRoot, 'new-file.ts'), 'export const value = 1;\n', 'utf-8');
    await execGit(['mv', 'tracked.txt', 'renamed.txt'], workspaceRoot);
    await writeFile(join(workspaceRoot, 'renamed.txt'), 'hello\nrenamed\n', 'utf-8');

    const changes = await listWorkspaceReviewChanges(workspaceRoot);
    expect(changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'new-file.ts', status: 'added' }),
        expect.objectContaining({ path: 'renamed.txt', status: 'renamed', oldPath: 'tracked.txt' }),
      ]),
    );
  });

  it('returns empty changes for directories that are not git repositories', async () => {
    const nonRepoRoot = await mkdtemp(join(tmpdir(), 'openawork-review-nonrepo-'));
    try {
      await writeFile(join(nonRepoRoot, 'plain.txt'), 'hello\n', 'utf-8');

      await expect(listWorkspaceReviewChanges(nonRepoRoot)).resolves.toEqual([]);
    } finally {
      await rm(nonRepoRoot, { recursive: true, force: true });
    }
  });

  it('returns empty changes when git executable is unavailable', async () => {
    const originalPath = process.env.PATH;
    process.env.PATH = '';

    try {
      await expect(listWorkspaceReviewChanges(workspaceRoot)).resolves.toEqual([]);
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('returns unified diff for a changed file', async () => {
    await writeFile(join(workspaceRoot, 'tracked.txt'), 'hello\nworld\n', 'utf-8');

    const diff = await getWorkspaceReviewDiff(workspaceRoot, 'tracked.txt');
    expect(diff).toContain('@@');
    expect(diff).toContain('+world');
  });

  it('reverts a changed file back to the committed state', async () => {
    const filePath = join(workspaceRoot, 'tracked.txt');
    await writeFile(filePath, 'mutated\n', 'utf-8');

    await revertWorkspaceReviewPath(workspaceRoot, 'tracked.txt');
    await expect(readFile(filePath, 'utf-8')).resolves.toBe('hello\n');
  });
});
