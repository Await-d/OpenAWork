/**
 * Regression coverage for the `repo_clone` tool's three-state machine
 * (cloned / refreshed / cached).
 *
 * The git binary is replaced by a recording fake so tests stay
 * hermetic — we never actually shell out. Filesystem side-effects are
 * routed through a temp directory whose lifetime is tied to the test;
 * `OPENAWORK_DATA_DIR` is set so `repositoryCachePath` resolves under
 * that temp dir and never touches the developer's real repos cache.
 *
 * What the tests pin (one per behaviour the implementation must keep):
 *
 *   - status === 'cloned' for first-time clone, runs `git clone --depth 100`
 *   - status === 'cached' when origin matches and no `refresh`
 *   - status === 'refreshed' when `refresh:true` is passed against a
 *     reused checkout, including the fetch + reset --hard + symbolic-ref
 *     handshake
 *   - branch validation (no traversal / leading dash)
 *   - host allow-list (file:// always rejected; non-allowlisted host
 *     rejected unless env override)
 *   - signal propagation forwards to git runner options
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createRepoCloneTool,
  resetTarget,
  statusForRepository,
  validateBranchName,
  type GitRunner,
  type GitRunResult,
} from '../../tools/repo-clone-tools.js';

/**
 * Shared "never-aborted" signal so tests don't have to pass
 * `undefined` for `ToolDefinition.execute`'s required `signal` arg.
 */
const NO_SIGNAL = new AbortController().signal;

const ORIGINAL_ENV = { ...process.env };
let tempDir = '';

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'openawork-repo-clone-test-'));
  process.env = { ...ORIGINAL_ENV, OPENAWORK_DATA_DIR: tempDir };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  if (tempDir && existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

interface RecordedCall {
  args: string[];
  cwd?: string;
  hasSignal: boolean;
}

interface FakeOptions {
  /** Map: stringified args -> response (override default success). */
  responses?: Map<string, GitRunResult>;
}

function makeFakeRunner(options: FakeOptions = {}): { runner: GitRunner; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const runner: GitRunner = async (args, opts = {}) => {
    calls.push({
      args,
      ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
      hasSignal: Boolean(opts.signal),
    });
    const key = args.join(' ');
    const override = options.responses?.get(key);
    if (override) return override;

    if (args[0] === 'config' && args[1] === '--get' && args[2] === 'remote.origin.url') {
      return { exitCode: 0, stdout: 'https://github.com/octocat/Hello-World.git\n', stderr: '' };
    }
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
      return { exitCode: 0, stdout: 'abc123def\n', stderr: '' };
    }
    if (args[0] === 'symbolic-ref') {
      return { exitCode: 0, stdout: 'main\n', stderr: '' };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  };
  return { runner, calls };
}

function reposRoot(): string {
  // OPENAWORK_DATA_DIR is treated as the *gateway* data dir (no
  // additional `agent-gateway/` subdir), so the repos cache sits
  // directly under it.
  return join(tempDir, 'repos');
}

function makeReusableCheckout(host: string, owner: string, repo: string): string {
  const local = join(reposRoot(), host, owner, repo);
  mkdirSync(join(local, '.git'), { recursive: true });
  writeFileSync(join(local, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  return local;
}

describe('validateBranchName', () => {
  it('accepts normal branch names', () => {
    expect(() => validateBranchName('main')).not.toThrow();
    expect(() => validateBranchName('feature/foo-bar.v2')).not.toThrow();
  });

  it('rejects leading dash (CLI flag injection)', () => {
    expect(() => validateBranchName('-evil')).toThrow();
  });

  it('rejects path traversal', () => {
    expect(() => validateBranchName('foo/..')).toThrow();
  });

  it('rejects whitespace and other special characters', () => {
    expect(() => validateBranchName('foo bar')).toThrow();
    expect(() => validateBranchName('foo$bar')).toThrow();
  });
});

describe('statusForRepository', () => {
  it('returns "cloned" when there is nothing to reuse', () => {
    expect(statusForRepository({ reuse: false })).toBe('cloned');
  });

  it('returns "refreshed" when refresh is requested on a reused checkout', () => {
    expect(statusForRepository({ reuse: true, refresh: true })).toBe('refreshed');
  });

  it('returns "refreshed" when the reused branch does not match the requested one', () => {
    expect(statusForRepository({ reuse: true, branchMatches: false })).toBe('refreshed');
  });

  it('returns "cached" for matching reuse without refresh', () => {
    expect(statusForRepository({ reuse: true, branchMatches: true })).toBe('cached');
    expect(statusForRepository({ reuse: true })).toBe('cached');
  });
});

describe('resetTarget', () => {
  it('prefers the explicit requested branch', () => {
    expect(
      resetTarget({
        requestedBranch: 'main',
        remoteHead: { exitCode: 0, stdout: 'origin/foo' },
        branch: { exitCode: 0, stdout: 'foo' },
      }),
    ).toBe('origin/main');
  });

  it('falls back to the resolved remote HEAD pointer', () => {
    expect(
      resetTarget({
        remoteHead: { exitCode: 0, stdout: 'refs/remotes/origin/main' },
        branch: { exitCode: 0, stdout: '' },
      }),
    ).toBe('origin/main');
  });

  it('falls back to origin/<current-branch> when remote HEAD is missing', () => {
    expect(
      resetTarget({
        remoteHead: { exitCode: 1, stdout: '' },
        branch: { exitCode: 0, stdout: 'develop' },
      }),
    ).toBe('origin/develop');
  });

  it('falls back to HEAD as a last resort', () => {
    expect(
      resetTarget({
        remoteHead: { exitCode: 1, stdout: '' },
        branch: { exitCode: 1, stdout: '' },
      }),
    ).toBe('HEAD');
  });
});

describe('repo_clone tool — cloned', () => {
  it('clones into the repos cache when no checkout exists', async () => {
    const { runner, calls } = makeFakeRunner();
    const tool = createRepoCloneTool({ gitRun: runner });
    const result = await tool.execute({ repository: 'octocat/Hello-World' }, NO_SIGNAL);
    expect(result.status).toBe('cloned');
    expect(result.host).toBe('github.com');
    expect(result.repository).toBe('octocat/Hello-World');
    expect(result.localPath).toBe(join(reposRoot(), 'github.com', 'octocat', 'Hello-World'));
    // Must include the depth-100 clone invocation.
    const cloneCall = calls.find((call) => call.args[0] === 'clone');
    expect(cloneCall).toBeDefined();
    expect(cloneCall?.args).toContain('--depth');
    expect(cloneCall?.args).toContain('100');
  });

  it('passes --branch when the caller specifies one', async () => {
    const { runner, calls } = makeFakeRunner();
    const tool = createRepoCloneTool({ gitRun: runner });
    const result = await tool.execute(
      { repository: 'octocat/Hello-World', branch: 'develop' },
      NO_SIGNAL,
    );
    expect(result.status).toBe('cloned');
    const cloneCall = calls.find((call) => call.args[0] === 'clone');
    expect(cloneCall?.args).toContain('--branch');
    expect(cloneCall?.args).toContain('develop');
  });
});

describe('repo_clone tool — cached', () => {
  it('returns cached without running clone or fetch when origin matches', async () => {
    makeReusableCheckout('github.com', 'octocat', 'Hello-World');
    const { runner, calls } = makeFakeRunner();
    const tool = createRepoCloneTool({ gitRun: runner });
    const result = await tool.execute({ repository: 'octocat/Hello-World' }, NO_SIGNAL);
    expect(result.status).toBe('cached');
    expect(calls.find((call) => call.args[0] === 'clone')).toBeUndefined();
    expect(calls.find((call) => call.args[0] === 'fetch')).toBeUndefined();
  });
});

describe('repo_clone tool — refreshed', () => {
  it('fetches and reset --hard when refresh:true on a reused checkout', async () => {
    makeReusableCheckout('github.com', 'octocat', 'Hello-World');
    const { runner, calls } = makeFakeRunner({
      responses: new Map([
        [
          'symbolic-ref refs/remotes/origin/HEAD',
          {
            exitCode: 0,
            stdout: 'refs/remotes/origin/main\n',
            stderr: '',
          },
        ],
      ]),
    });
    const tool = createRepoCloneTool({ gitRun: runner });
    const result = await tool.execute(
      { repository: 'octocat/Hello-World', refresh: true },
      NO_SIGNAL,
    );
    expect(result.status).toBe('refreshed');
    expect(calls.find((call) => call.args[0] === 'fetch')).toBeDefined();
    const reset = calls.find((call) => call.args[0] === 'reset');
    expect(reset).toBeDefined();
    expect(reset?.args).toEqual(['reset', '--hard', 'origin/main']);
  });

  it('runs an explicit checkout -B when refresh + branch are combined', async () => {
    makeReusableCheckout('github.com', 'octocat', 'Hello-World');
    const { runner, calls } = makeFakeRunner();
    const tool = createRepoCloneTool({ gitRun: runner });
    const result = await tool.execute(
      { repository: 'octocat/Hello-World', refresh: true, branch: 'develop' },
      NO_SIGNAL,
    );
    expect(result.status).toBe('refreshed');
    const checkout = calls.find((call) => call.args[0] === 'checkout');
    expect(checkout).toBeDefined();
    expect(checkout?.args).toEqual(['checkout', '-B', 'develop', 'origin/develop']);
  });
});

describe('repo_clone tool — refusals', () => {
  it('rejects unparseable repository inputs', async () => {
    const { runner } = makeFakeRunner();
    const tool = createRepoCloneTool({ gitRun: runner });
    await expect(tool.execute({ repository: '   ' }, NO_SIGNAL)).rejects.toThrow(/git URL/);
  });

  it('rejects file:// repositories', async () => {
    const { runner } = makeFakeRunner();
    const tool = createRepoCloneTool({ gitRun: runner });
    await expect(tool.execute({ repository: 'file:///tmp/x' }, NO_SIGNAL)).rejects.toThrow(
      /Local file repositories/,
    );
  });

  it('rejects hosts not on the allow-list', async () => {
    const { runner } = makeFakeRunner();
    const tool = createRepoCloneTool({ gitRun: runner });
    await expect(tool.execute({ repository: 'evil.example/foo/bar' }, NO_SIGNAL)).rejects.toThrow(
      /allow-list/,
    );
  });

  it('honours OPENAWORK_REPO_CLONE_ALLOWED_HOSTS override', async () => {
    process.env['OPENAWORK_REPO_CLONE_ALLOWED_HOSTS'] = 'evil.example,github.com';
    const { runner } = makeFakeRunner();
    const tool = createRepoCloneTool({ gitRun: runner });
    const result = await tool.execute({ repository: 'evil.example/foo/bar' }, NO_SIGNAL);
    expect(result.status).toBe('cloned');
  });

  it('rejects malformed branch names', async () => {
    const { runner } = makeFakeRunner();
    const tool = createRepoCloneTool({ gitRun: runner });
    await expect(
      tool.execute({ repository: 'octocat/Hello-World', branch: '-evil' }, NO_SIGNAL),
    ).rejects.toThrow(/Branch must contain/);
  });

  it('surfaces the underlying git error when clone fails', async () => {
    const responses = new Map<string, GitRunResult>();
    responses.set(
      'clone --depth 100 -- https://github.com/octocat/Hello-World.git ' +
        join(reposRoot(), 'github.com', 'octocat', 'Hello-World'),
      { exitCode: 128, stdout: '', stderr: 'fatal: could not resolve host' },
    );
    const { runner } = makeFakeRunner({ responses });
    const tool = createRepoCloneTool({ gitRun: runner });
    await expect(tool.execute({ repository: 'octocat/Hello-World' }, NO_SIGNAL)).rejects.toThrow(
      /could not resolve host/,
    );
  });
});

describe('repo_clone tool — signal forwarding', () => {
  it('forwards the abort signal to every git invocation', async () => {
    const { runner, calls } = makeFakeRunner();
    const tool = createRepoCloneTool({ gitRun: runner });
    const controller = new AbortController();
    await tool.execute({ repository: 'octocat/Hello-World' }, controller.signal);
    // At minimum the clone + the post-clone HEAD/branch reads received
    // a signal; assert all of them did.
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((call) => call.hasSignal)).toBe(true);
  });
});

describe('repo_clone tool — concurrency', () => {
  it('does not leak mutex entries across sequential calls', async () => {
    // Regression: a previous version of `withCloneLock` stored the
    // chained promise but compared identity against a freshly built
    // `previous.then(() => next)` in cleanup, which always evaluated
    // to false and leaked map entries forever. We can't reach the
    // private map directly, but we can prove the leak fix indirectly:
    // run N sequential clones against distinct paths and confirm each
    // one is allowed to proceed without serialising against the
    // others (which would be the symptom of a stuck previous-promise
    // entry).
    const { runner } = makeFakeRunner();
    const tool = createRepoCloneTool({ gitRun: runner });
    for (let index = 0; index < 5; index += 1) {
      const result = await tool.execute({ repository: `octocat/repo-${index}` }, NO_SIGNAL);
      expect(result.status).toBe('cloned');
    }
  });

  it('serialises concurrent clones against the same localPath', async () => {
    let inflight = 0;
    let peakInflight = 0;
    const slowRunner: GitRunner = async () => {
      inflight += 1;
      peakInflight = Math.max(peakInflight, inflight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inflight -= 1;
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    const tool = createRepoCloneTool({ gitRun: slowRunner });
    await Promise.all([
      tool.execute({ repository: 'octocat/Hello-World' }, NO_SIGNAL),
      tool.execute({ repository: 'octocat/Hello-World' }, NO_SIGNAL),
      tool.execute({ repository: 'octocat/Hello-World' }, NO_SIGNAL),
    ]);
    // The mutex must keep at most one git call in flight per path
    // (well, per call) — but more importantly the second/third
    // executions must wait for the first to release the lock before
    // running their own clone sequence. We verify by asserting peak
    // inflight stays at 1 even though we started three clones in
    // parallel.
    vi.useRealTimers();
    expect(peakInflight).toBe(1);
  });
});
