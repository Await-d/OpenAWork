/**
 * Minimal in-process scheduler for gateway background maintenance tasks.
 *
 * Unlike the user-facing `CronScheduler` (which exists to fire LLM-driven
 * agent sessions on a user-defined cadence), this scheduler is purely
 * internal: it owns the rare set of system-side jobs that have to run
 * regardless of user activity — refreshing system-skill rows after a
 * filesystem change, pre-warming GitHub registry caches, checking
 * remote SKILL.md versions, etc.
 *
 * Design goals:
 *   1. **Non-overlapping execution**: if a task is still running when
 *      its next tick arrives, the next tick is skipped (NOT queued).
 *      Long-running scans that briefly outrun their interval don't
 *      pile up and starve the event loop.
 *   2. **Failure-tolerant**: a thrown exception inside `run()` is
 *      logged via the optional `onError` hook and the schedule
 *      continues; one bad tick must never kill the timer.
 *   3. **Clean shutdown**: `stopAll()` cancels every pending timer
 *      and waits for any in-flight task to settle, called from the
 *      Fastify `onClose` hook so hot-reload doesn't leak timers.
 *   4. **Configurable**: each task can have its initial delay and
 *      interval tweaked via env vars (recommended pattern: the
 *      caller resolves the env var, this module stays env-agnostic).
 */

export interface BackgroundTask {
  /** Stable identifier used for diagnostics and dedup. */
  name: string;
  /** Milliseconds between ticks. Must be > 0. */
  intervalMs: number;
  /**
   * Delay before the first tick. Defaults to `intervalMs`. Stagger
   * tasks so a 0-delay boot storm doesn't hammer the network all at
   * once.
   */
  initialDelayMs?: number;
  /** Actual work — must be idempotent and respect cancellation. */
  run: () => Promise<void>;
  /** Optional sink for failures. Defaults to console.warn. */
  onError?: (err: unknown) => void;
}

interface ActiveEntry {
  task: BackgroundTask;
  timer: ReturnType<typeof setTimeout>;
  /** True while `run()` is awaiting; the next tick will be skipped. */
  running: boolean;
  /** Resolves when the currently-running task finishes (for stopAll). */
  inflight: Promise<void> | null;
}

export class BackgroundScheduler {
  private entries = new Map<string, ActiveEntry>();
  private stopped = false;

  /**
   * Register a periodic task. Returns silently if a task with the
   * same `name` is already registered (idempotent).
   */
  register(task: BackgroundTask): void {
    if (this.stopped) return;
    if (this.entries.has(task.name)) return;
    if (task.intervalMs <= 0) {
      throw new Error(`BackgroundScheduler: intervalMs must be > 0 (got ${task.intervalMs})`);
    }

    const entry: ActiveEntry = {
      task,
      timer: setTimeout(() => this.tick(task.name), task.initialDelayMs ?? task.intervalMs),
      running: false,
      inflight: null,
    };
    this.entries.set(task.name, entry);
  }

  /**
   * Unregister and cancel a task. Any currently-running invocation
   * keeps going to completion (consistent with `stopAll`).
   */
  unregister(name: string): void {
    const entry = this.entries.get(name);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.entries.delete(name);
  }

  /**
   * Cancel every task, then await any in-flight executions so the
   * caller (typically `onClose`) doesn't return while a scan is
   * still touching the DB.
   */
  async stopAll(): Promise<void> {
    this.stopped = true;
    const inflights: Array<Promise<void>> = [];
    for (const entry of this.entries.values()) {
      clearTimeout(entry.timer);
      if (entry.inflight) inflights.push(entry.inflight.catch(() => undefined));
    }
    this.entries.clear();
    await Promise.all(inflights);
  }

  /** Test-only: peek at registered task names. */
  listTaskNames(): string[] {
    return Array.from(this.entries.keys());
  }

  private tick(name: string): void {
    const entry = this.entries.get(name);
    if (!entry || this.stopped) return;

    // Skip if the previous invocation is still running. The next
    // tick will be rescheduled below regardless.
    if (entry.running) {
      entry.timer = setTimeout(() => this.tick(name), entry.task.intervalMs);
      return;
    }

    entry.running = true;
    entry.inflight = (async () => {
      try {
        await entry.task.run();
      } catch (err) {
        const handler = entry.task.onError ?? defaultErrorHandler(name);
        try {
          handler(err);
        } catch {
          // onError must never crash the loop.
        }
      } finally {
        entry.running = false;
        entry.inflight = null;
        // Re-arm only if (a) we're not stopped, and (b) the entry
        // under `name` is still the SAME object we were running —
        // otherwise the user unregister()'d + register()'d a fresh
        // task with the same name and its own initialDelayMs timer,
        // and we must not clobber it.
        const current = this.entries.get(name);
        if (current === entry && !this.stopped) {
          entry.timer = setTimeout(() => this.tick(name), entry.task.intervalMs);
        }
      }
    })();
  }
}

function defaultErrorHandler(name: string): (err: unknown) => void {
  return (err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[background-scheduler] task "${name}" failed: ${message}`);
  };
}

/** Singleton used across the gateway. */
export const backgroundScheduler = new BackgroundScheduler();
