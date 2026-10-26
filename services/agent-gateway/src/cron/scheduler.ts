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

/**
 * 单次定时器的延迟上限（2^31-1 毫秒 ≈ 24.8 天）。
 *
 * `setTimeout` 的 delay 是 32 位有符号整数：超过该值会被 Node / Bun **钳成 1ms
 * 并立即触发**（实测 3_000_000_000ms 的定时器 1ms 内就跑了，还会打印
 * `TimeoutOverflowWarning`）。因此长周期任务不能把真实剩余时间直接交给
 * `setTimeout`，必须分段等待；超过该值的 `every` 直接要求改用 cron。
 */
export const MAX_TIMER_DELAY_MS = 2_147_483_647;

/**
 * 同一个任务「触发被跳过」的记录最小间隔。
 *
 * 跳过本身可能每隔几秒发生一次（`every` 1 分钟 + 执行 10 分钟），逐次落库会把
 * 执行历史（每任务保留 200 条）冲成清一色的 skipped。按任务每分钟最多一条，
 * 既能证明「它确实在到点触发，只是被挡住了」，又不会挤掉真正的执行记录。
 */
export const SKIP_RECORD_MIN_INTERVAL_MS = 60_000;

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

/** 手动触发没跑起来的原因。 */
export type CronFireSkipReason = 'missing' | 'disabled' | 'in-flight' | 'busy';

/**
 * 一次触发是否**真的开始执行**。
 *
 * 定时器到点的跳过是静默的（下一次 tick 自然重试），但手动「立即运行」必须把
 * 跳过原因如实回给调用方——否则界面只能给出「已触发」的假成功。
 */
export type CronFireStartResult =
  | { readonly started: true; readonly executionId: string }
  | { readonly started: false; readonly reason: CronFireSkipReason };

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
  /** 每个任务上一次「跳过记录」的时刻（见 `SKIP_RECORD_MIN_INTERVAL_MS`）。 */
  private skipRecordedAt = new Map<string, number>();
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

    // 只改名字 / prompt / 模型不应该重装定时器：重装一次 `every` 会把间隔起点
    // 重置（用户看到「还有 3 分钟」突然变回满间隔），而已发射的一次性任务还会
    // 因为「时间已过」在重装时被记一条建臂失败——那是编辑标题带来的假故障。
    const schedulingChanged =
      patch.enabled !== undefined ||
      patch.schedule_kind !== undefined ||
      patch.schedule_at !== undefined ||
      patch.schedule_every !== undefined ||
      patch.schedule_expr !== undefined ||
      patch.schedule_tz !== undefined;
    if (!schedulingChanged) return;

    this.cancelJob(id);
    if (updated.enabled) this.scheduleJob(updated);
  }

  removeJob(id: string): void {
    // 先落库：失败时内存与定时器都不动，任务仍在正常调度，用户重试即可。
    this.persistence?.deleteJob(id);
    this.cancelJob(id);
    this.jobs.delete(id);
    this.skipRecordedAt.delete(id);
  }

  /**
   * 启动装载：把持久化的任务定义放回调度器。只对 enabled 任务建定时器。
   *
   * 一次性任务（`at`）在装载期做一次状态归并，见 `disableAtJob`；其余任务
   * **不**回写持久化（避免每次启动对全表做无意义 upsert）。
   */
  restoreJobs(jobs: readonly CronJobRecord[]): void {
    for (const job of jobs) {
      if (job.enabled && job.schedule_kind === 'at') {
        if (typeof job.schedule_at !== 'number') {
          this.disableAtJob(job, '一次性任务缺少 schedule_at，无法建臂，已自动停用。');
          continue;
        }
        if (job.schedule_at <= Date.now()) {
          // 已完成的一次性任务无法再触发：静默停用即可（它已经跑过，记 failed
          // 会让历史看起来像「这次失败了」）。真正被错过的那次才需要留一条
          // failed 说明——否则「停机错过」就退化成「静默消失」。
          //
          // 判定用 `fire_count` 而不是时间比较：手动「立即运行」会把
          // `last_fired_at` 写在计划时刻之前，按时间比较会把它误判成「错过」。
          this.disableAtJob(
            job,
            job.fire_count > 0
              ? null
              : '一次性任务在网关停机期间已过期，已自动停用（本次未执行）。',
          );
          continue;
        }
      }
      this.jobs.set(job.id, job);
      if (job.enabled) this.scheduleJob(job);
    }
  }

  /**
   * 停用一个「已经不可能再触发」的一次性任务；`failure` 非空时额外落一条 failed
   * 执行记录。
   *
   * 旧行为是 `scheduleJob` 对 `delay <= 0` 直接 return：任务保持 enabled、
   * `getNextFireAt` 为 null、执行历史空白——用户看到「已启用」却永远不会再有
   * 结果（网关停机期间错过的一次性任务就是这样静默消失的）。
   *
   * 刻意**不补跑**：一次性任务的语义是「在指定时刻执行」，过期补跑可能产生
   * 比不跑更糟的副作用（例如补发一份早已过时的日报）。
   */
  private disableAtJob(job: CronJobRecord, failure: string | null): void {
    const disabled: CronJobRecord = { ...job, enabled: false, updated_at: Date.now() };
    this.jobs.set(job.id, disabled);
    this.persistSafely(() => this.persistence?.upsertJob(disabled), 'upsertJob(at-disabled)');
    if (failure === null) return;

    const now = Date.now();
    const exec: CronExecutionRecord = {
      id: crypto.randomUUID(),
      job_id: job.id,
      started_at: now,
      finished_at: now,
      status: 'failed',
      error: failure,
    };
    this.executions.push(exec);
    if (this.executionHistoryMax > 0 && this.executions.length > this.executionHistoryMax) {
      this.executions.splice(0, this.executions.length - this.executionHistoryMax);
    }
    this.persistSafely(
      () => this.persistence?.recordExecution(disabled, exec),
      'recordExecution(at-disabled)',
    );
  }

  /**
   * 上报建臂失败。listener 由外部注入（路由层写一条 failed 执行记录），它自身
   * 抛错绝不能扩散——否则一条坏任务能让 `restoreJobs` 整体失败、拖垮网关启动。
   */
  private reportScheduleError(jobId: string, message: string): void {
    try {
      this.scheduleErrorListener?.(jobId, message);
    } catch {
      // listener 自身故障：吞掉，建臂失败本身已由调用方 return 处理。
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
        if (typeof job.schedule_at !== 'number') {
          // 静默 return 会让任务永远停在「已启用但不会触发」——记录一条建臂失败，
          // 用户至少能在执行历史里看到原因（重启装载的过期任务由 restoreJobs 处理，
          // 不会走到这里，故不会重复记录）。
          this.reportScheduleError(job.id, '一次性任务缺少 schedule_at，未建立触发臂。');
          return;
        }
        const delay = job.schedule_at - Date.now();
        if (delay <= 0) {
          this.reportScheduleError(job.id, '一次性任务的触发时间已过，未建立触发臂。');
          return;
        }
        // 分段等待：超过 32 位上限的 delay 会被运行时钳成 1ms（见 MAX_TIMER_DELAY_MS）。
        const arm = (): void => {
          if (this.armTokens.get(job.id) !== token) return;
          const remaining = job.schedule_at! - Date.now();
          if (remaining <= 0) {
            void this.fireJob(job.id);
            return;
          }
          const handle = setTimeout(arm, Math.min(remaining, MAX_TIMER_DELAY_MS));
          this.activeJobs.set(job.id, { record: job, handle, kind: 'timeout' });
        };
        arm();
        break;
      }
      case 'every': {
        // 非正数/非法间隔必须显式拦下：`setInterval(fn, -1)` 会被运行时钳成 1ms，
        // 直接变成高频空转（历史实现只判了 falsy，负数照样能建臂）。
        if (
          typeof job.schedule_every !== 'number' ||
          !Number.isFinite(job.schedule_every) ||
          job.schedule_every <= 0
        ) {
          this.reportScheduleError(job.id, '固定间隔任务缺少有效的 schedule_every，未建立触发臂。');
          return;
        }
        if (job.schedule_every > MAX_TIMER_DELAY_MS) {
          // `setInterval` 同样受 32 位上限约束：超长间隔会被钳成 1ms 空转。
          // 这类「每月 / 每年」语义请用 cron 表达式表达（如 `0 0 1 * *`）。
          this.reportScheduleError(
            job.id,
            '固定间隔任务的间隔超过单次定时器上限（约 24.8 天），请改用 cron 表达式。',
          );
          return;
        }
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
            // listener 自身抛错不能扩散，否则 `restoreJobs` 会被一条坏任务拖垮。
            this.reportScheduleError(job.id, err instanceof Error ? err.message : String(err));
            return;
          }
          const handle = setTimeout(
            () => {
              // 超过 32 位上限的等待（如每年 / 闰日）先睡一段再重算，不能直接
              // 交给 setTimeout——它会被钳成 1ms 立刻触发，形成执行风暴。
              if (delay > MAX_TIMER_DELAY_MS) {
                scheduleNext();
                return;
              }
              // Always reschedule the next cron tick, whether the fire
              // resolved or (defensively) rejected — otherwise a single
              // unexpected rejection would permanently stop this cron job
              // and surface as an unhandled rejection.
              void this.fireJob(job.id).then(
                () => scheduleNext(),
                () => scheduleNext(),
              );
            },
            Math.min(delay, MAX_TIMER_DELAY_MS),
          );
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
    // 定时触发：被跳过时要落一条 skipped 记录（手动触发由调用方处理，不落）。
    const started = this.beginFire(jobId, { recordSkip: true });
    if (started.started) await started.completion;
  }

  /**
   * 守卫判定 + 建执行记录 + 起跑（同步返回是否真的开始）。
   *
   * 拆出来的原因：手动「立即运行」要立刻返回 202/409，不能等 handler 跑完；
   * 而定时器分支需要等本次执行结束再续臂（见 `fireJob`），否则 `cron` 的
   * 下一次触发会按「开始时间」而不是「结束时间」计算。
   */
  private beginFire(
    jobId: string,
    options: { readonly ignoreEnabled?: boolean; readonly recordSkip?: boolean } = {},
  ):
    | { readonly started: false; readonly reason: CronFireSkipReason }
    | { readonly started: true; readonly executionId: string; readonly completion: Promise<void> } {
    const job = this.jobs.get(jobId);
    if (!job) return { started: false, reason: 'missing' };
    if (!job.enabled && options.ignoreEnabled !== true) {
      return { started: false, reason: 'disabled' };
    }
    // Drop the overlapping fire if the previous run of THIS job is still
    // in flight — the next tick re-fires naturally once it settles.
    if (this.inFlightJobs.has(jobId)) {
      // 定时触发（`recordSkip`）必须留下痕迹：否则界面只能看到「一直没跑」，
      // 分不清是没到点、被跳过还是失败。手动触发由调用方拿到 reason，不记录。
      if (options.recordSkip === true) this.recordSkippedFire(job, 'in-flight');
      return { started: false, reason: 'in-flight' };
    }
    if (this.runningCount >= this.maxConcurrent) {
      if (options.recordSkip === true) this.recordSkippedFire(job, 'busy');
      return { started: false, reason: 'busy' };
    }

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

    return { started: true, executionId: execId, completion: this.executeJob(exec, updated) };
  }

  /**
   * 记录一次「到点但没跑成」的触发（按任务每分钟最多一条，见
   * `SKIP_RECORD_MIN_INTERVAL_MS`）。
   *
   * 不写 `last_fired_at` / `fire_count`：它确实没有执行，计数不该被跳过污染。
   */
  private recordSkippedFire(job: CronJobRecord, reason: 'in-flight' | 'busy'): void {
    const now = Date.now();
    const last = this.skipRecordedAt.get(job.id) ?? 0;
    if (now - last < SKIP_RECORD_MIN_INTERVAL_MS) return;
    this.skipRecordedAt.set(job.id, now);

    const exec: CronExecutionRecord = {
      id: crypto.randomUUID(),
      job_id: job.id,
      started_at: now,
      finished_at: now,
      status: 'skipped',
      error:
        reason === 'in-flight'
          ? '上一次执行尚未结束，本次触发已跳过。'
          : '网关并发上限已满，本次触发已跳过。',
    };
    this.executions.push(exec);
    if (this.executionHistoryMax > 0 && this.executions.length > this.executionHistoryMax) {
      this.executions.splice(0, this.executions.length - this.executionHistoryMax);
    }
    this.persistSafely(
      () => this.persistence?.recordExecution(job, exec),
      'recordExecution(skipped)',
    );
  }

  /**
   * 执行一次已登记的执行记录。**不会 reject**：handler 的异常被收敛为
   * `exec.status = 'failed'`，因此调用方可以安全地 `void` 它。
   */
  private async executeJob(exec: CronExecutionRecord, job: CronJobRecord): Promise<void> {
    const jobId = job.id;
    // 让 handler 在真正开跑前把执行会话 id 报回来，写进执行历史。
    // `exec.session_id` 此前永远为空，导致「执行成功但产出找不到」。
    const handlerContext: CronJobExecutionContext = {
      reportSession: (sessionId: string) => {
        exec.session_id = sessionId;
      },
    };

    try {
      await this.runHandlerWithTimeout(job, handlerContext);
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
      const latest = this.jobs.get(jobId) ?? job;
      this.persistSafely(
        () => this.persistence?.recordExecution(latest, exec),
        'recordExecution(end)',
      );

      if (job.delete_after_run && job.schedule_kind === 'at') {
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

  /**
   * 手动触发一次（「立即运行」）：走与定时触发完全相同的路径与并发约束。
   *
   * 返回「是否真的开始」而不是恒真布尔：任务在途 / 并发已满时旧实现仍返回
   * true（它只看历史里有没有记录），调用方只能给出假成功。
   * 手动触发**忽略 `enabled`**：用户点「立即运行」是明确要现在跑一次。
   */
  async runJobNow(id: string): Promise<CronFireStartResult> {
    const result = this.beginFire(id, { ignoreEnabled: true });
    if (!result.started) return { started: false, reason: result.reason };
    await result.completion;
    return { started: true, executionId: result.executionId };
  }

  /** 同 `runJobNow`，但不等执行结束（HTTP / 工具需要立即返回）。 */
  startJobNow(id: string): CronFireStartResult {
    const result = this.beginFire(id, { ignoreEnabled: true });
    if (!result.started) return { started: false, reason: result.reason };
    void result.completion.catch(() => undefined);
    return { started: true, executionId: result.executionId };
  }

  stopAll(): void {
    for (const id of [...this.activeJobs.keys()]) this.cancelJob(id);
    this.armTokens.clear();
    // Drop reentrancy bookkeeping so a handler still mid-flight at stop()
    // doesn't leave a stale id that falsely skips the first fire after a
    // later restart.
    this.inFlightJobs.clear();
    this.skipRecordedAt.clear();
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
