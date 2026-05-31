import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Regression: a single git invocation must be bounded by a wall-clock
 * deadline. Before the fix, `runGit` (both the execFile and spawn-with-stdin
 * paths) had only a maxBuffer guard and no timeout, so a git process that
 * hangs (index.lock contention, a stuck hook, a credential/editor prompt on
 * a tty we never provide, a stalled network filesystem) left the promise
 * pending forever and wedged the snapshot capture/restore awaiting it.
 *
 * We substitute the git binary with a script that sleeps far longer than the
 * deadline, then assert both runGit paths settle with a timeout failure
 * result (exitCode 1, "timed out") rather than hanging.
 */

let dir: string;
let sleeperPath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'shadow-git-timeout-'));
  sleeperPath = join(dir, 'sleeper.sh');
  // A stand-in "git" that ignores its args and sleeps well past the deadline.
  await writeFile(sleeperPath, '#!/bin/sh\nsleep 30\n', 'utf8');
  await chmod(sleeperPath, 0o755);
});

afterEach(async () => {
  const mod = await import('../../snapshot/shadow-git-store.js');
  mod.__setGitBinaryForTests(null);
  await rm(dir, { recursive: true, force: true }).catch(() => {});
});

describe('shadow-git runGit wall-clock timeout', () => {
  it('execFile 路径：git 挂起超过 timeoutMs 时返回超时失败结果而非永久挂起', async () => {
    const mod = await import('../../snapshot/shadow-git-store.js');
    mod.__setGitBinaryForTests(sleeperPath);

    const start = Date.now();
    const result = await mod.__runGitForTests({
      args: ['status'],
      cwd: dir,
      timeoutMs: 150,
    });
    const elapsed = Date.now() - start;

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('timed out');
    // Settled near the deadline, nowhere near the 30s sleep.
    expect(elapsed).toBeLessThan(5_000);
  });

  it('spawn(stdin) 路径：git 挂起超过 timeoutMs 时返回超时失败结果而非永久挂起', async () => {
    const mod = await import('../../snapshot/shadow-git-store.js');
    mod.__setGitBinaryForTests(sleeperPath);

    const start = Date.now();
    const result = await mod.__runGitForTests({
      args: ['hash-object', '-w', '--stdin'],
      cwd: dir,
      stdin: 'payload',
      timeoutMs: 150,
    });
    const elapsed = Date.now() - start;

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('timed out');
    expect(elapsed).toBeLessThan(5_000);
  });
});
