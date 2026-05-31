import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Regression: the `git rev-parse --show-toplevel` worktree probe in
 * resolveRequestedWorktree must be bounded by a wall-clock deadline. Before
 * the fix the execFile call had `cwd` but no `timeout`/`maxBuffer`, so a git
 * process that hangs (index.lock contention, a stalled network filesystem)
 * left the probe pending forever and wedged loop-execution setup.
 *
 * We substitute the probe git binary with a script that sleeps far past the
 * deadline and assert the call settles with the degraded "needs init" note
 * (the catch branch) rather than hanging.
 */
let dir: string;
let sleeperPath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'worktree-probe-'));
  sleeperPath = join(dir, 'sleeper.sh');
  await writeFile(sleeperPath, '#!/bin/sh\nsleep 30\n', 'utf8');
  await chmod(sleeperPath, 0o755);
});

afterEach(async () => {
  const mod = await import('../../routes/command-loop-runtime.js');
  mod.__setWorktreeProbeGitForTests(null);
  await rm(dir, { recursive: true, force: true }).catch(() => {});
});

describe('resolveRequestedWorktree git probe wall-clock timeout', () => {
  it('git 探针挂起超过 timeout 时降级为「需要初始化」提示而非永久挂起', async () => {
    const mod = await import('../../routes/command-loop-runtime.js');
    mod.__setWorktreeProbeGitForTests(sleeperPath, 150);

    const start = Date.now();
    // `dir` is an existing directory, so fs.stat passes and we reach the
    // git probe — which hangs and must time out into the catch branch.
    const result = await mod.resolveRequestedWorktree(dir);
    const elapsed = Date.now() - start;

    expect(result.requestedPath).toBe(dir);
    expect(result.path).toBeUndefined();
    expect(result.note ?? '').toContain('git worktree add');
    // Settled near the 150ms deadline, nowhere near the 30s sleep.
    expect(elapsed).toBeLessThan(5_000);
  });
});
