/**
 * repo-clone-tools — `repo_clone` tool for the P1-SCOUT scout agent.
 *
 * Ported from opencode `packages/opencode/src/tool/repo_clone.ts`
 * (commit 40d5ea1cf, #24149). Key differences from the upstream:
 *
 *   - **No effect-ts**. Uses plain async/await + `child_process.spawn`.
 *   - **No cross-process flock**. OpenAWork's agent-gateway is a single
 *     long-lived process, so a simple in-process per-path mutex is
 *     enough. If we ever ship a multi-process gateway we can swap in
 *     `proper-lockfile` without changing the public API.
 *   - **No `ctx.ask` permission UI**. The tool only writes inside the
 *     gateway's repos cache root (`~/.config/openAwork/agent-gateway/repos`
 *     by default), never inside the user's workspace. Hosts are gated
 *     by `OPENAWORK_REPO_CLONE_ALLOWED_HOSTS` (defaults to GitHub /
 *     GitLab / Bitbucket). Future iterations can layer the existing
 *     permission system on top without breaking this contract.
 *   - **Dependency injection**. The git runner is overridable via
 *     `createRepoCloneTool({ gitRun })` so unit tests don't need to
 *     spawn real git.
 */

import { spawn } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import type { ToolDefinition } from '@openAwork/agent-core';
import { z } from 'zod';

import {
  parseRepositoryReference,
  repositoryCachePath,
  sameRepositoryReference,
  type RepositoryReference,
} from './repo-reference.js';

const DEFAULT_ALLOWED_HOSTS = ['github.com', 'gitlab.com', 'bitbucket.org'];
const CLONE_DEPTH = 100;

const repoCloneInputSchema = z.object({
  repository: z
    .string()
    .min(1)
    .describe(
      'Repository to clone, as a git URL, host/path reference, or GitHub owner/repo shorthand',
    ),
  branch: z.string().min(1).max(200).optional().describe('Branch or ref to clone and inspect'),
  refresh: z
    .boolean()
    .optional()
    .describe('When true, fetches the latest remote state into the managed cache'),
});

const repoCloneOutputSchema = z.object({
  repository: z.string(),
  host: z.string(),
  remote: z.string(),
  localPath: z.string(),
  status: z.enum(['cached', 'cloned', 'refreshed']),
  head: z.string().optional(),
  branch: z.string().optional(),
});

export type RepoCloneInput = z.infer<typeof repoCloneInputSchema>;
export type RepoCloneOutput = z.infer<typeof repoCloneOutputSchema>;

export interface GitRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface GitRunOptions {
  cwd?: string;
  signal?: AbortSignal;
  /**
   * Hard timeout in milliseconds. Defaults to 5 minutes per git
   * invocation (clone of mid-size repos with depth=100 over a slow
   * link can take a few minutes).
   */
  timeoutMs?: number;
}

export type GitRunner = (args: string[], options?: GitRunOptions) => Promise<GitRunResult>;

export const DEFAULT_GIT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Default git runner. Spawns `git` with the given args, captures
 * stdout/stderr, and resolves with `{ exitCode, stdout, stderr }`.
 * Forwarded `signal` triggers a SIGTERM on the subprocess.
 */
export const defaultGitRunner: GitRunner = (args, options = {}) =>
  new Promise<GitRunResult>((resolve, reject) => {
    const timeoutMs = options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS;
    const child = spawn('git', args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        // Disable any interactive prompt — surface auth failures as a
        // non-zero exit instead of hanging waiting for credentials.
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: 'echo',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    });

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
    }, timeoutMs);

    const onAbort = () => {
      child.kill('SIGTERM');
    };
    if (options.signal) {
      if (options.signal.aborted) {
        child.kill('SIGTERM');
      } else {
        options.signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    child.on('error', (error) => {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
      resolve({ exitCode: typeof code === 'number' ? code : -1, stdout, stderr });
    });
  });

function getAllowedHosts(): string[] {
  const raw = process.env['OPENAWORK_REPO_CLONE_ALLOWED_HOSTS'];
  if (!raw || raw.trim().length === 0) return DEFAULT_ALLOWED_HOSTS;
  return raw
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Branch name validator mirroring opencode's regex. Refuses anything
 * that could be smuggled into a git CLI flag (`--upload-pack=…`) or
 * walk out of the cache directory (`..`).
 */
export function validateBranchName(branch: string): void {
  if (!/^[A-Za-z0-9/_.-]+$/.test(branch) || branch.startsWith('-') || branch.includes('..')) {
    throw new Error(
      'Branch must contain only alphanumeric characters, /, _, ., and -, and cannot start with - or contain ..',
    );
  }
}

interface StatusInput {
  reuse: boolean;
  refresh?: boolean;
  branchMatches?: boolean;
}

export function statusForRepository(input: StatusInput): 'cached' | 'cloned' | 'refreshed' {
  if (!input.reuse) return 'cloned';
  if (input.branchMatches === false) return 'refreshed';
  if (input.refresh) return 'refreshed';
  return 'cached';
}

interface ResetTargetInput {
  requestedBranch?: string;
  remoteHead: { exitCode: number; stdout: string };
  branch: { exitCode: number; stdout: string };
}

export function resetTarget(input: ResetTargetInput): string {
  if (input.requestedBranch) return `origin/${input.requestedBranch}`;
  if (input.remoteHead.exitCode === 0 && input.remoteHead.stdout) {
    return input.remoteHead.stdout.replace(/^refs\/remotes\//, '');
  }
  if (input.branch.exitCode === 0 && input.branch.stdout) {
    return `origin/${input.branch.stdout}`;
  }
  return 'HEAD';
}

// Per-localPath in-process mutex: serialises concurrent repo_clone
// invocations against the same cached checkout so we never run two
// `git fetch` against the same .git in parallel.
const cloneMutex = new Map<string, Promise<void>>();

async function withCloneLock<T>(localPath: string, body: () => Promise<T>): Promise<T> {
  const previous = cloneMutex.get(localPath) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  // Store the chained promise once and reuse the same reference for
  // both `set` and the post-cleanup identity check; calling
  // `previous.then(...)` twice would return two different Promise
  // objects and the identity check would never match, leaking entries
  // in `cloneMutex`.
  const chained = previous.then(() => next);
  cloneMutex.set(localPath, chained);
  await previous;
  try {
    return await body();
  } finally {
    release();
    if (cloneMutex.get(localPath) === chained) {
      cloneMutex.delete(localPath);
    }
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

interface CreateRepoCloneToolDeps {
  gitRun?: GitRunner;
}

/**
 * Build the `repo_clone` tool. Exposed as a factory so tests can
 * inject a fake git runner.
 */
export function createRepoCloneTool(
  deps: CreateRepoCloneToolDeps = {},
): ToolDefinition<typeof repoCloneInputSchema, typeof repoCloneOutputSchema> {
  const gitRun = deps.gitRun ?? defaultGitRunner;

  return {
    name: 'repo_clone',
    description:
      'Clone or refresh a repository into OpenAWork managed cache and return its absolute local path so subsequent Read/Glob/Grep can explore it. Accepts git URLs, host/path references, or GitHub owner/repo shorthand. Use this BEFORE Read/Glob/Grep when the code lives outside the current workspace. Intended for dependency and documentation research; will never modify the user workspace.',
    inputSchema: repoCloneInputSchema,
    outputSchema: repoCloneOutputSchema,
    timeout: DEFAULT_GIT_TIMEOUT_MS + 30_000,
    execute: async (input, signal) => executeRepoClone(input, signal, gitRun),
  };
}

async function executeRepoClone(
  input: RepoCloneInput,
  signal: AbortSignal | undefined,
  gitRun: GitRunner,
): Promise<RepoCloneOutput> {
  const reference = parseRepositoryReference(input.repository);
  if (!reference) {
    throw new Error(
      'Repository must be a git URL, host/path reference, or GitHub owner/repo shorthand',
    );
  }
  if (reference.protocol === 'file:') {
    throw new Error('Local file repositories are not supported by repo_clone');
  }
  const allowedHosts = getAllowedHosts();
  if (!allowedHosts.includes(reference.host)) {
    throw new Error(
      `Host ${reference.host} is not in the repo_clone allow-list. Set OPENAWORK_REPO_CLONE_ALLOWED_HOSTS to override.`,
    );
  }
  if (input.branch !== undefined) validateBranchName(input.branch);

  const repository = reference.label;
  const remote = reference.remote;
  const localPath = repositoryCachePath(reference);
  const cloneTarget = parseRepositoryReference(remote) ?? reference;

  return withCloneLock(localPath, async () => {
    await fsp.mkdir(path.dirname(localPath), { recursive: true });

    const localExists = await pathExists(localPath);
    const hasGitDir = localExists && (await pathExists(path.join(localPath, '.git')));

    let originReference: RepositoryReference | null = null;
    if (hasGitDir) {
      const originResult = await gitRun(['config', '--get', 'remote.origin.url'], {
        cwd: localPath,
        ...(signal ? { signal } : {}),
      });
      if (originResult.exitCode === 0 && originResult.stdout.trim().length > 0) {
        originReference = parseRepositoryReference(originResult.stdout.trim());
      }
    }
    const reuse =
      hasGitDir &&
      Boolean(originReference && sameRepositoryReference(originReference, cloneTarget));

    if (localExists && !reuse) {
      await fsp.rm(localPath, { recursive: true, force: true });
    }

    let currentBranch: string | undefined;
    if (hasGitDir && reuse) {
      const branchResult = await gitRun(['symbolic-ref', '--quiet', '--short', 'HEAD'], {
        cwd: localPath,
        ...(signal ? { signal } : {}),
      });
      currentBranch =
        branchResult.exitCode === 0 ? branchResult.stdout.trim() || undefined : undefined;
    }

    const status = statusForRepository({
      reuse,
      ...(input.refresh !== undefined ? { refresh: input.refresh } : {}),
      ...(input.branch !== undefined ? { branchMatches: currentBranch === input.branch } : {}),
    });

    if (status === 'cloned') {
      const cloneArgs = [
        'clone',
        '--depth',
        String(CLONE_DEPTH),
        ...(input.branch ? ['--branch', input.branch] : []),
        '--',
        remote,
        localPath,
      ];
      const cloneResult = await gitRun(cloneArgs, {
        cwd: path.dirname(localPath),
        ...(signal ? { signal } : {}),
      });
      if (cloneResult.exitCode !== 0) {
        throw new Error(
          cloneResult.stderr.trim() || cloneResult.stdout.trim() || `Failed to clone ${repository}`,
        );
      }
    }

    if (status === 'refreshed') {
      const fetchResult = await gitRun(['fetch', '--all', '--prune'], {
        cwd: localPath,
        ...(signal ? { signal } : {}),
      });
      if (fetchResult.exitCode !== 0) {
        throw new Error(
          fetchResult.stderr.trim() ||
            fetchResult.stdout.trim() ||
            `Failed to refresh ${repository}`,
        );
      }

      if (input.branch) {
        const checkoutResult = await gitRun(
          ['checkout', '-B', input.branch, `origin/${input.branch}`],
          { cwd: localPath, ...(signal ? { signal } : {}) },
        );
        if (checkoutResult.exitCode !== 0) {
          throw new Error(
            checkoutResult.stderr.trim() ||
              checkoutResult.stdout.trim() ||
              `Failed to checkout ${input.branch}`,
          );
        }
      }

      const remoteHead = await gitRun(['symbolic-ref', 'refs/remotes/origin/HEAD'], {
        cwd: localPath,
        ...(signal ? { signal } : {}),
      });
      const branchSym = await gitRun(['symbolic-ref', '--quiet', '--short', 'HEAD'], {
        cwd: localPath,
        ...(signal ? { signal } : {}),
      });
      const target = resetTarget({
        ...(input.branch !== undefined ? { requestedBranch: input.branch } : {}),
        remoteHead: { exitCode: remoteHead.exitCode, stdout: remoteHead.stdout.trim() },
        branch: { exitCode: branchSym.exitCode, stdout: branchSym.stdout.trim() },
      });
      const resetResult = await gitRun(['reset', '--hard', target], {
        cwd: localPath,
        ...(signal ? { signal } : {}),
      });
      if (resetResult.exitCode !== 0) {
        throw new Error(
          resetResult.stderr.trim() || resetResult.stdout.trim() || `Failed to reset ${repository}`,
        );
      }
    }

    const headResult = await gitRun(['rev-parse', 'HEAD'], {
      cwd: localPath,
      ...(signal ? { signal } : {}),
    });
    const branchResult = await gitRun(['symbolic-ref', '--quiet', '--short', 'HEAD'], {
      cwd: localPath,
      ...(signal ? { signal } : {}),
    });
    const head = headResult.exitCode === 0 ? headResult.stdout.trim() : undefined;
    const branch =
      branchResult.exitCode === 0 ? branchResult.stdout.trim() || undefined : undefined;

    return {
      repository,
      host: reference.host,
      remote,
      localPath,
      status,
      ...(head ? { head } : {}),
      ...(branch ? { branch } : {}),
    };
  });
}

/** Default tool definition wired with the real `git` binary. */
export const repoCloneToolDefinition = createRepoCloneTool();
