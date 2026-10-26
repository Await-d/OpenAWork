import { nextCronFireAfter } from './cron-expression.js';
import type {
  CronJobRecord,
  CronExecutionRecord,
  CronJobExecutionContext,
  CronJobHandler,
} from './types.js';

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

/**
 * 计算距离该 cron 表达式下一次触发的毫秒数。
 *
 * 历史实现只校验段数、恒定返回「到下一分钟」，并 `void tz` 丢弃时区——所有
 * `cron` 任务都会变成每分钟触发一次。现在按真实表达式 + 时区计算；表达式
 * 合法但 8 年内无解（如 `0 0 30 2 *`）时抛错，由 `scheduleJob` 记录并放弃建臂，
 * 不再退化成每分钟空转。
 */
function parseCronExpression(expr: string, tz: string): number {
  const next = nextCronFireAfter(expr, tz, Date.now());
  if (next === null) {
    throw new Error(`Cron expression "${expr}" has no fire time within the search horizon`);
  }
  return Math.max(next - Date.now(), 0);
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
  /**
   * Per-job "arm token". The `cron` branch reschedules itself from inside the
   * previous fire's `.then`, so a bare `clearTimeout` in `cancelJob` cannot
   * stop it: the already-scheduled continuation re-arms the timer after an
   * `updateJob` / `removeJob` / `disable` and the change appears to be
   * ignored (deleted jobs come back, edited expressions keep firing).
   * Bumping the token makes those stale continuations no-op.
   */
  private armTokens = new Map<string, number>();
  private armTokenSeq = 0;
  private handler: CronJobHandler;
  private jobTimeoutMs: number;
  private executionHistoryMax: number;
  private persistence: CronSchedulerPersistence | undefined;
  /** 调度建臂失败（表达式非法 / 无解）的观测出口；缺省静默丢弃。 */
  private scheduleErrorListener: ((jobId: string, message: string) => void) | undefined;
  /** 持久化失败（见 `persistSafely`）的观测出口；缺省静默丢弃。 */
  private persistenceErrorListener: ((label: string, error: unknown) => void) | undefined;

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

  /**
   * 用户操作路径（新增 / 修改 / 删除）统一约定：**先落库，成功后再改内存**。
   *
   * 反过来（先改内存再落库）在 DB 抛错时会留下永久不一致：
   *   - `removeJob` 先 `jobs.delete` 再 `deleteJob`：DB 失败 → 内存已删、库还在 →
   *     重启后任务**复活**（正是用户报的「删不掉」的变种）；
   *   - `addJob` 先 `jobs.set` 再 `upsertJob`：DB 失败 → 界面以为建好了，重启即消失。
   *
   * 与 `fireJob` 里「持久化失败一律吞掉」是**刻意的不对称**：那边的首要目标是不让
   * DB 故障破坏调度状态机（丢一条执行历史可接受）；这里的首要目标是让用户立刻
   * 知道操作没生效（失败冒泡成 HTTP 500 / 工具报错）。
   */
  addJob(job: CronJobRecord): void {
    this.persistence?.upsertJob(job);
    this.jobs.set(job.id, job);
    if (job.enabled) this.scheduleJob(job);
  }

  updateJob(id: string, patch: Partial<CronJobRecord>): void {
    const existing = this.jobs.get(id);
    if (!existing) return;
    const updated = { ...existing, ...patch, id, updated_at: Date.now() };
    this.persistence?.upsertJob(updated);
    this.jobs.set(id, updated);
    this.cancelJob(id);
    if (updated.enabled) this.scheduleJob(updated);
  }

  removeJob(id: string): void {
    // 先落库：失败时内存与定时器都不动，任务仍在正常调度，用户重试即可。
    this.persistence?.deleteJob(id);
    this.cancelJob(id);
    this.jobs.delete(id);
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
    // 先作废「重排令牌」：cron 分支在 fire 结束后会自行续臂，只清当前 handle
    // 挡不住旧闭包把定时器重新装回来（任务改不掉 / 删了又复活）。
    this.armTokens.delete(id);
    const active = this.activeJobs.get(id);
    if (!active) return;
    if (active.kind === 'interval') clearInterval(active.handle);
    else clearTimeout(active.handle);
    this.activeJobs.delete(id);
  }

  /** 注册建臂失败观测回调（路由层用于把坏表达式写进执行历史）。 */
  setScheduleErrorListener(listener: (jobId: string, message: string) => void): void {
    this.scheduleErrorListener = listener;
  }

  private scheduleJob(job: CronJobRecord): void {
    const token = (this.armTokenSeq += 1);
    this.armTokens.set(job.id, token);
    switch (job.schedule_kind) {
      case 'at': {
        if (!job.schedule_at) return;
        const delay = job.schedule_at - Date.now();
        if (delay <= 0) return;
        const handle = setTimeout(() => void this.fireJob(job.id), delay);
        this.activeJobs.set(job.id, { record: job, handle, kind: 'timeout' });
        break;
      }
      case 'every': {
        if (!job.schedule_every) return;
        const handle = setInterval(() => void this.fireJob(job.id), job.schedule_every);
        this.activeJobs.set(job.id, { record: job, handle, kind: 'interval' });
        break;
      }
      case 'cron': {
        if (!job.schedule_expr) return;
        const scheduleNext = () => {
          // 令牌已被 cancelJob 作废（改 / 删 / 停用）→ 不再续臂。
          if (this.armTokens.get(job.id) !== token) return;
          let delay: number;
          try {
            delay = parseCronExpression(job.schedule_expr!, job.schedule_tz);
          } catch (err) {
            // 表达式非法或搜索窗口内无解：记录后放弃建臂，不退化成每分钟空转。
            // listener 由外部注入（路由层会写一条 failed 执行记录）。它自身若抛错
            // （例如 DB 故障），绝不能从 catch 块逃出去——那会让 scheduleJob 抛，
            // 进而让 `restoreJobs` 在启动装载时整体失败，一条坏任务拖垮整个网关启动。
            try {
              this.scheduleErrorListener?.(
                job.id,
                err instanceof Error ? err.message : String(err),
              );
            } catch {
              // listener 自身故障：吞掉，建臂失败本身已经由 return 处理。
            }
            return;
          }
          const handle = setTimeout(() => {
            // Always reschedule the next cron tick, whether the fire
            // resolved or (defensively) rejected — otherwise a single
            // unexpected rejection would permanently stop this cron job
            // and surface as an unhandled rejection.
            void this.fireJob(job.id).then(
              () => scheduleNext(),
              () => scheduleNext(),
            );
          }, delay);
          this.activeJobs.set(job.id, { record: job, handle, kind: 'timeout' });
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
  private runHandlerWithTimeout(
    job: CronJobRecord,
    context: CronJobExecutionContext,
  ): Promise<void> {
    const handlerPromise = this.handler(job, context);
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

  /**
   * Fire a job by id, always reading the **latest** stored record.
   *
   * Timers are armed with a captured record, but that snapshot goes stale the
   * moment the job is updated (`fire_count`, `last_fired_at`, prompt, …). The
   * old `fire_count: job.fire_count + 1` therefore always computed `0 + 1`
   * for `every` jobs (the `setInterval` closure never saw a newer record), so
   * the execution counter stayed pinned at 1 in both the API and the UI.
   * Resolving the record through the map at fire time keeps it monotonic, and
   * also skips jobs that were removed or disabled between arm and fire.
   */
  private async fireJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job || !job.enabled) return;
    // Drop the overlapping fire if the previous run of THIS job is still
    // in flight — the next tick re-fires naturally once it settles.
    if (this.inFlightJobs.has(jobId)) return;
    if (this.runningCount >= this.maxConcurrent) return;

    this.inFlightJobs.add(jobId);
    this.runningCount++;
    const execId = crypto.randomUUID();
    const exec: CronExecutionRecord = {
      id: execId,
      job_id: jobId,
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
    // 持久化一律「尽力而为」（见 `persistSafely`）。**这两行在 try 之前**：
    // 若让它们抛错，`inFlightJobs` / `runningCount` 就再也不会被释放——
    // 该任务此后永久不再触发（`inFlightJobs.has(jobId)` 恒真），并且每泄漏一次
    // 就永久占用一个并发位，累计到 `maxConcurrent` 后**整个调度器停摆**。
    this.persistSafely(
      () => this.persistence?.recordExecution(job, exec),
      'recordExecution(start)',
    );

    const updated = { ...job, last_fired_at: Date.now(), fire_count: job.fire_count + 1 };
    this.jobs.set(jobId, updated);
    this.persistSafely(() => this.persistence?.upsertJob(updated), 'upsertJob(fire)');

    // 让 handler 在真正开跑前把执行会话 id 报回来，写进执行历史。
    // `exec.session_id` 此前永远为空，导致「执行成功但产出找不到」。
    const handlerContext: CronJobExecutionContext = {
      reportSession: (sessionId: string) => {
        exec.session_id = sessionId;
      },
    };

    try {
      await this.runHandlerWithTimeout(updated, handlerContext);
      exec.status = 'completed';
    } catch (err) {
      exec.status = 'failed';
      exec.error = err instanceof Error ? err.message : String(err);
    } finally {
      exec.finished_at = Date.now();
      this.runningCount--;
      // Release the per-job slot last so it is freed even if the handler
      // threw — otherwise the job would be permanently wedged in-flight.
      this.inFlightJobs.delete(jobId);
      // 执行记录以「最新任务态」的 user_id 落库（任务可能已被改归属）。
      const latest = this.jobs.get(jobId) ?? updated;
      this.persistSafely(
        () => this.persistence?.recordExecution(latest, exec),
        'recordExecution(end)',
      );

      if (updated.delete_after_run && updated.schedule_kind === 'at') {
        // 同理：删除失败只记日志，不能把 finally 抛出去（否则 fireJob 变成
        // rejected promise，而调用方是 `void this.fireJob(...)` → unhandled rejection）。
        this.persistSafely(() => this.removeJob(jobId), 'removeJob(delete_after_run)');
      }
    }
  }

  /**
   * 执行一次持久化动作，失败只记日志。
   *
   * `CronSchedulerPersistence` 是可选钩子（`cron-store` 用 SQLite 实现）。SQLite
   * 会因锁等待超时、磁盘满、表结构漂移等原因抛错，而调度状态机（`inFlightJobs` /
   * `runningCount` / 定时器）**绝不能被持久化失败带崩**：那会让任务永久静默停摆，
   * 比丢一条执行历史严重得多。执行历史本身可丢（它是诊断数据）。
   */
  private persistSafely(action: () => void, label: string): void {
    try {
      action();
    } catch (error) {
      // listener 同样是外部注入，可能写日志/落库；它抛错也不能扩散。
      try {
        this.persistenceErrorListener?.(label, error);
      } catch {
        // 观测链路故障：吞掉，调度状态机不受影响。
      }
    }
  }

  /** 注册持久化失败观测回调（路由层用于接管日志）。 */
  setPersistenceErrorListener(listener: (label: string, error: unknown) => void): void {
    this.persistenceErrorListener = listener;
  }

  /**
   * 计算某任务的「下次触发时间」（epoch 毫秒）；`at` / 已过期 / 无法解析时返回 `null`。
   *
   * 只读派生，不影响调度臂；供 HTTP 列表与 `schedule_manage` 展示，
   * 让用户能在界面上看到任务究竟什么时候跑（此前该字段前端恒为空）。
   *
   * **绝不允许抛错**：调用方是列表映射（`GET /cron/jobs` 逐条 `toView`），
   * 单条任务抛错会让整个列表 500、管理页白屏。表达式校验是本轮才加上的，
   * 库里的存量行（以及任何绕过 schema 的写入）都可能是坏表达式，因此这里
   * 把「算不出下次触发」一律降级为 `null`。
   */
  getNextFireAt(id: string): number | null {
    const job = this.jobs.get(id);
    if (!job || !job.enabled) return null;
    if (job.schedule_kind === 'at') {
      return typeof job.schedule_at === 'number' && job.schedule_at > Date.now()
        ? job.schedule_at
        : null;
    }
    if (job.schedule_kind === 'every') {
      if (typeof job.schedule_every !== 'number' || job.schedule_every <= 0) return null;
      const base = job.last_fired_at ?? job.created_at;
      let next = base + job.schedule_every;
      const now = Date.now();
      if (next <= now) {
        const missed = Math.ceil((now - next) / job.schedule_every);
        next += missed * job.schedule_every;
      }
      return next;
    }
    if (!job.schedule_expr) return null;
    try {
      return nextCronFireAfter(job.schedule_expr, job.schedule_tz, Date.now());
    } catch {
      // 坏表达式 / 搜索窗口内无解：只影响「下次触发」这一展示字段。
      return null;
    }
  }

  /** 手动触发一次（「立即运行」）：走与定时触发完全相同的路径与并发约束。 */
  async runJobNow(id: string): Promise<boolean> {
    const job = this.jobs.get(id);
    if (!job) return false;
    await this.fireJob(id);
    return this.executions.some((exec) => exec.job_id === id);
  }

  stopAll(): void {
    for (const id of [...this.activeJobs.keys()]) this.cancelJob(id);
    this.armTokens.clear();
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
