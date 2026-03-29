import type { CronJobRecord, CronExecutionRecord, CronJobHandler } from './types.js';

type TimerHandle = ReturnType<typeof setTimeout>;

interface ActiveJob {
  record: CronJobRecord;
  handle: TimerHandle;
  kind: 'timeout' | 'interval';
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
  private handler: CronJobHandler;

  constructor(handler: CronJobHandler, maxConcurrent = 3) {
    this.handler = handler;
    this.maxConcurrent = maxConcurrent;
  }

  addJob(job: CronJobRecord): void {
    this.jobs.set(job.id, job);
    if (job.enabled) this.scheduleJob(job);
  }

  updateJob(id: string, patch: Partial<CronJobRecord>): void {
    const existing = this.jobs.get(id);
    if (!existing) return;
    const updated = { ...existing, ...patch, id, updated_at: Date.now() };
    this.jobs.set(id, updated);
    this.cancelJob(id);
    if (updated.enabled) this.scheduleJob(updated);
  }

  removeJob(id: string): void {
    this.cancelJob(id);
    this.jobs.delete(id);
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
              void this.fireJob(job).then(() => scheduleNext());
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

  private async fireJob(job: CronJobRecord): Promise<void> {
    if (this.runningCount >= this.maxConcurrent) return;

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

    const updated = { ...job, last_fired_at: Date.now(), fire_count: job.fire_count + 1 };
    this.jobs.set(job.id, updated);

    try {
      await this.handler(updated);
      exec.status = 'completed';
    } catch (err) {
      exec.status = 'failed';
      exec.error = err instanceof Error ? err.message : String(err);
    } finally {
      exec.finished_at = Date.now();
      this.runningCount--;

      if (job.delete_after_run && job.schedule_kind === 'at') {
        this.removeJob(job.id);
      }
    }
  }

  stopAll(): void {
    for (const id of this.activeJobs.keys()) this.cancelJob(id);
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
