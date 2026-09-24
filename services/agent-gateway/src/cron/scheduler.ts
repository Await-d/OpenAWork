import type { CronJobRecord, CronExecutionRecord, CronJobHandler } from './types.js';

type TimerHandle = ReturnType<typeof setTimeout>;

/**
 * Default wall-clock ceiling for a single cron handler invocation.
 * The scheduler tracks a global `runningCount` against `maxConcurrent`;
 * a handler that hangs (e.g. an upstream socket that connects but never
 * responds) would otherwise hold its concurrency slot forever, and after
 * `maxConcurrent` such hangs every future fire would silently no-op.
 * Bounding each invocation guarantees slots are always reclaimed. Pass a
 * non-positive value to disable.
 */
export const DEFAULT_CRON_JOB_TIMEOUT_MS = 600_000;

/**
 * Cap on the in-memory cron execution-history ring. `fireJob` pushes one
 * `CronExecutionRecord` per fire and previously never trimmed, so a
 * frequently-firing job (`every` minute, or sub-minute in tests) grew this
 * array without bound for the scheduler's lifetime. History is read-only
 * diagnostics (the `/cron/jobs/:id/history` route), so keeping the most
 * recent N records is sufficient; older rows are dropped FIFO. The newest
 * record (the one just pushed, possibly still `running`) is never trimmed as
 * long as the cap exceeds `maxConcurrent`. Pass a non-positive value to
 * disable trimming.
 */
export const DEFAULT_CRON_EXECUTION_HISTORY_MAX = 1_000;

export class CronJobTimeoutError extends Error {
  public readonly timeoutMs: number;

  constructor(jobId: string, timeoutMs: number) {
    super(`Cron job "${jobId}" timed out after ${timeoutMs}ms`);
    this.name = 'CronJobTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

interface ActiveJob {
  record: CronJobRecord;
  handle: TimerHandle;
  kind: 'timeout' | 'interval';
}

/**
 * 调度器持久化钩子（可选）。由 `cron-store` 提供实现；缺省时不落库，
 * 既有单测（超时 / 重入 / 历史裁剪）保持无 DB 依赖。
 */
export interface CronSchedulerPersistence {
  upsertJob(job: CronJobRecord): void;
  deleteJob(id: string): void;
  recordExecution(job: CronJobRecord, exec: CronExecutionRecord): void;
}

function parseCronExpression(expr: string, tz: string): number {
  void tz;
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Invalid cron expression: ${expr}`);
  const now = new Date();
  const next = new Date(now);
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() + 1);
  return next.getTime() - now.getTime();
}

export class CronScheduler {
  private jobs = new Map<string, CronJobRecord>();
  private activeJobs = new Map<string, ActiveJob>();
  private executions: CronExecutionRecord[] = [];
  private maxConcurrent: number;
  private runningCount = 0;
  /**
   * Per-job reentrancy guard. The global `runningCount` cap stops the
   * scheduler as a whole from over-subscribing, but it does NOT stop a
   * single `every`/`cron` job whose handler outruns its period from
   * stacking copies of *itself*: each tick that fires while the prior
   * run is still pending consumes another concurrency slot for the same
   * job, double-firing non-idempotent work and starving every other
   * job. Tracking in-flight job ids lets us drop the overlapping fire.
   */
  private inFlightJobs = new Set<string>();
  private handler: CronJobHandler;
  private jobTimeoutMs: number;
  private executionHistoryMax: number;
  private persistence: CronSchedulerPersistence | undefined;

  constructor(
    handler: CronJobHandler,
    maxConcurrent = 3,
    jobTimeoutMs = DEFAULT_CRON_JOB_TIMEOUT_MS,
    executionHistoryMax = DEFAULT_CRON_EXECUTION_HISTORY_MAX,
    persistence?: CronSchedulerPersistence,
  ) {
    this.handler = handler;
    this.maxConcurrent = maxConcurrent;
    this.jobTimeoutMs = jobTimeoutMs;
    this.executionHistoryMax = executionHistoryMax;
    this.persistence = persistence;
  }

  addJob(job: CronJobRecord): void {
    this.jobs.set(job.id, job);
    this.persistence?.upsertJob(job);
    if (job.enabled) this.scheduleJob(job);
  }

  updateJob(id: string, patch: Partial<CronJobRecord>): void {
    const existing = this.jobs.get(id);
    if (!existing) return;
    const updated = { ...existing, ...patch, id, updated_at: Date.now() };
    this.jobs.set(id, updated);
    this.persistence?.upsertJob(updated);
    this.cancelJob(id);
    if (updated.enabled) this.scheduleJob(updated);
  }

  removeJob(id: string): void {
    this.cancelJob(id);
    this.jobs.delete(id);
    this.persistence?.deleteJob(id);
  }

  /**
   * 启动装载：把持久化的任务定义放回调度器，但**不**触发 persistence 回写
   * （避免每次启动对全表做无意义 upsert）。只对 enabled 任务建定时器。
   */
  restoreJobs(jobs: readonly CronJobRecord[]): void {
    for (const job of jobs) {
      this.jobs.set(job.id, job);
      if (job.enabled) this.scheduleJob(job);
    }
  }

  cancelJob(id: string): void {
    const active = this.activeJobs.get(id);
    if (!active) return;
    if (active.kind === 'interval') clearInterval(active.handle);
    else clearTimeout(active.handle);
    this.activeJobs.delete(id);
  }

  private scheduleJob(job: CronJobRecord): void {
    switch (job.schedule_kind) {
      case 'at': {
        if (!job.schedule_at) return;
        const delay = job.schedule_at - Date.now();
        if (delay <= 0) return;
        const handle = setTimeout(() => void this.fireJob(job), delay);
        this.activeJobs.set(job.id, { record: job, handle, kind: 'timeout' });
        break;
      }
      case 'every': {
        if (!job.schedule_every) return;
        const handle = setInterval(() => void this.fireJob(job), job.schedule_every);
        this.activeJobs.set(job.id, { record: job, handle, kind: 'interval' });
        break;
      }
      case 'cron': {
        if (!job.schedule_expr) return;
        const scheduleNext = () => {
          try {
            const delay = parseCronExpression(job.schedule_expr!, job.schedule_tz);
            const handle = setTimeout(() => {
              // Always reschedule the next cron tick, whether the fire
              // resolved or (defensively) rejected — otherwise a single
              // unexpected rejection would permanently stop this cron job
              // and surface as an unhandled rejection.
              void this.fireJob(job).then(
                () => scheduleNext(),
                () => scheduleNext(),
              );
            }, delay);
            this.activeJobs.set(job.id, { record: job, handle, kind: 'timeout' });
          } catch (err) {
            void err;
          }
        };
        scheduleNext();
        break;
      }
    }
  }

  /**
   * Race the handler against a wall-clock deadline. On timeout the returned
   * promise rejects with `CronJobTimeoutError` so `fireJob` records the
   * failure and its `finally` reclaims the concurrency slot. A rejection
   * handler is attached to the underlying handler promise so its eventual
   * (post-timeout) settlement never surfaces as an unhandled rejection.
   */
  private runHandlerWithTimeout(job: CronJobRecord): Promise<void> {
    const handlerPromise = this.handler(job);
    if (!Number.isFinite(this.jobTimeoutMs) || this.jobTimeoutMs <= 0) {
      return handlerPromise;
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new CronJobTimeoutError(job.id, this.jobTimeoutMs));
      }, this.jobTimeoutMs);
      timer.unref?.();
      handlerPromise.then(
        () => {
          clearTimeout(timer);
          resolve();
        },
        (err: unknown) => {
          clearTimeout(timer);
          reject(err instanceof Error ? err : new Error(String(err)));
        },
      );
    });
  }

  private async fireJob(job: CronJobRecord): Promise<void> {
    // Drop the overlapping fire if the previous run of THIS job is still
    // in flight — the next tick re-fires naturally once it settles.
    if (this.inFlightJobs.has(job.id)) return;
    if (this.runningCount >= this.maxConcurrent) return;

    this.inFlightJobs.add(job.id);
    this.runningCount++;
    const execId = crypto.randomUUID();
    const exec: CronExecutionRecord = {
      id: execId,
      job_id: job.id,
      started_at: Date.now(),
      finished_at: null,
      status: 'running',
    };
    this.executions.push(exec);
    // Bound the history ring: drop oldest records once over the cap. The
    // record just pushed is the newest, so a cap > maxConcurrent guarantees a
    // still-`running` execution is never trimmed before its finally mutates it.
    if (this.executionHistoryMax > 0 && this.executions.length > this.executionHistoryMax) {
      this.executions.splice(0, this.executions.length - this.executionHistoryMax);
    }
    this.persistence?.recordExecution(job, exec);

    const updated = { ...job, last_fired_at: Date.now(), fire_count: job.fire_count + 1 };
    this.jobs.set(job.id, updated);
    this.persistence?.upsertJob(updated);

    try {
      await this.runHandlerWithTimeout(updated);
      exec.status = 'completed';
    } catch (err) {
      exec.status = 'failed';
      exec.error = err instanceof Error ? err.message : String(err);
    } finally {
      exec.finished_at = Date.now();
      this.runningCount--;
      // Release the per-job slot last so it is freed even if the handler
      // threw — otherwise the job would be permanently wedged in-flight.
      this.inFlightJobs.delete(job.id);
      this.persistence?.recordExecution(job, exec);

      if (job.delete_after_run && job.schedule_kind === 'at') {
        this.removeJob(job.id);
      }
    }
  }

  stopAll(): void {
    for (const id of this.activeJobs.keys()) this.cancelJob(id);
    // Drop reentrancy bookkeeping so a handler still mid-flight at stop()
    // doesn't leave a stale id that falsely skips the first fire after a
    // later restart.
    this.inFlightJobs.clear();
  }

  listJobs(): CronJobRecord[] {
    return [...this.jobs.values()];
  }

  getExecutionHistory(jobId?: string): CronExecutionRecord[] {
    if (jobId) return this.executions.filter((e) => e.job_id === jobId);
    return [...this.executions];
  }

  getJob(id: string): CronJobRecord | undefined {
    return this.jobs.get(id);
  }
}
