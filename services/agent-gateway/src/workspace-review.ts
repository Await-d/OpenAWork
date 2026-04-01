import { rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

export type WorkspaceReviewStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface WorkspaceReviewChange {
  path: string;
  status: WorkspaceReviewStatus;
  oldPath?: string;
  linesAdded?: number;
  linesDeleted?: number;
}

type ExecResult = { stdout: string };

async function execGit(args: string[], cwd: string): Promise<ExecResult> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  return execFileAsync('git', args, { cwd, maxBuffer: 4 * 1024 * 1024 }) as Promise<ExecResult>;
}

export async function listWorkspaceReviewChanges(
  workspaceRoot: string,
): Promise<WorkspaceReviewChange[]> {
  let statusOut: string;
  let numstatOut: string;
  try {
    [{ stdout: statusOut }, { stdout: numstatOut }] = await Promise.all([
      execGit(['status', '--porcelain', '-u'], workspaceRoot),
      execGit(['diff', '--numstat'], workspaceRoot),
    ]);
  } catch (error) {
    if (isNotGitRepositoryError(error)) {
      return [];
    }

    if (await isGitExecutableUnavailableError(error, workspaceRoot)) {
      return [];
    }

    throw error;
  }

  const numstatMap = new Map<string, { linesAdded?: number; linesDeleted?: number }>();
  for (const line of numstatOut.split('\n')) {
    if (!line.trim()) continue;
    const [added, deleted, filePath] = line.split('\t');
    if (!filePath) continue;
    numstatMap.set(filePath, {
      linesAdded: added && added !== '-' ? Number.parseInt(added, 10) : undefined,
      linesDeleted: deleted && deleted !== '-' ? Number.parseInt(deleted, 10) : undefined,
    });
  }

  const changes: WorkspaceReviewChange[] = [];
  for (const raw of statusOut.split('\n')) {
    if (!raw.trim()) continue;
    const code = raw.slice(0, 2);
    const rest = raw.slice(3).trim();

    if (rest.includes(' -> ')) {
      const [oldPath, path] = rest.split(' -> ');
      if (!oldPath || !path) continue;
      const numstat = numstatMap.get(path) ?? {};
      changes.push({ path, oldPath, status: 'renamed', ...numstat });
      continue;
    }

    if (!rest) continue;
    const status = deriveStatus(code);
    const numstat = numstatMap.get(rest) ?? {};
    changes.push({ path: rest, status, ...numstat });
  }

  return changes;
}

export async function getWorkspaceReviewDiff(
  workspaceRoot: string,
  relativePath: string,
): Promise<string> {
  const { stdout } = await execGit(['diff', '--', relativePath], workspaceRoot);
  return stdout;
}

export async function revertWorkspaceReviewPath(
  workspaceRoot: string,
  relativePath: string,
): Promise<void> {
  const changes = await listWorkspaceReviewChanges(workspaceRoot);
  const change = changes.find((item) => item.path === relativePath);
  if (!change) {
    return;
  }

  if (change.status === 'added') {
    await rm(join(workspaceRoot, relativePath), { force: true });
    return;
  }

  await execGit(
    ['restore', '--source=HEAD', '--staged', '--worktree', '--', relativePath],
    workspaceRoot,
  );
}

function deriveStatus(code: string): WorkspaceReviewStatus {
  if (code.includes('A') || code === '??') return 'added';
  if (code.includes('D')) return 'deleted';
  if (code.includes('R')) return 'renamed';
  return 'modified';
}

function isNotGitRepositoryError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = getErrorCode(error);

  const parts = [error.message];
  if ('stderr' in error && typeof error.stderr === 'string') {
    parts.push(error.stderr);
  }

  const normalizedParts = parts.map((part) => part.toLowerCase());
  return (
    (code === '128' || code === '129') &&
    normalizedParts.some((part) => part.includes('not a git repository'))
  );
}

async function isGitExecutableUnavailableError(error: unknown, cwd: string): Promise<boolean> {
  if (!(error instanceof Error) || getErrorCode(error) !== 'ENOENT') {
    return false;
  }

  try {
    const cwdStat = await stat(cwd);
    if (!cwdStat.isDirectory()) {
      return false;
    }
  } catch {
    return false;
  }

  const commandPath = 'path' in error && typeof error.path === 'string' ? error.path : undefined;
  const command = 'cmd' in error && typeof error.cmd === 'string' ? error.cmd : undefined;
  if (commandPath === 'git' || command?.startsWith('git ')) {
    return true;
  }

  return error.message.toLowerCase().includes('spawn git');
}

function getErrorCode(error: Error): string | undefined {
  if (!('code' in error)) {
    return undefined;
  }

  const rawCode = error.code;
  if (typeof rawCode === 'string' || typeof rawCode === 'number') {
    return String(rawCode);
  }

  return undefined;
}
