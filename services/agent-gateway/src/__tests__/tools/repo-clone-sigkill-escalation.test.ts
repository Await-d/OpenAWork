/**
 * Regression (§0.122, repo_clone git network-stall enforcement):
 * defaultGitRunner's deadline / abort path sent only SIGTERM. A `git clone`
 * stuck in a network pack negotiation (or one that doesn't forward the signal
 * to its git-remote-https helper) can ignore SIGTERM and keep the promise
 * pending past the deadline — the repo_clone tool would hang for the whole
 * tool-execution window instead of honouring timeoutMs. The runner now
 * escalates to SIGKILL after a grace period (mirrors bash-tools).
 *
 * We mock child_process.spawn with a fake git child that IGNORES SIGTERM and
 * only closes on SIGKILL, then assert the runner escalates and still settles.
 */

import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

import { defaultGitRunner } from '../../tools/repo-clone-tools.js';

class FakeGitChild extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly killSignals: string[] = [];
  kill(signal: NodeJS.Signals): boolean {
    this.killSignals.push(signal);
    // Simulate a git child wedged in a network pack negotiation: SIGTERM is
    // ignored; only SIGKILL terminates it (→ 'close').
    if (signal === 'SIGKILL') {
      this.emit('close', null);
    }
    return true;
  }
}

describe('defaultGitRunner SIGKILL escalation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    spawnMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('escalates SIGTERM→SIGKILL when the git child ignores the deadline SIGTERM', async () => {
    const child = new FakeGitChild();
    spawnMock.mockReturnValue(child);

    const promise = defaultGitRunner(['clone', 'https://example.test/x.git'], {
      timeoutMs: 100,
    });
    let settled = false;
    void promise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    // Deadline fires → SIGTERM, which the wedged child ignores.
    await vi.advanceTimersByTimeAsync(100);
    expect(child.killSignals).toEqual(['SIGTERM']);
    expect(settled).toBe(false);

    // Grace window elapses → SIGKILL forces the child to close.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(child.killSignals).toContain('SIGKILL');

    const result = await promise;
    // close with no numeric code → exitCode -1, runner still settles.
    expect(result.exitCode).toBe(-1);
  });
});
