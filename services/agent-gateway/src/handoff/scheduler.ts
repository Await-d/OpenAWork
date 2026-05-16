/**
 * 260515-team-phase-b · T-05
 *
 * BackgroundTaskScheduler 接口 + 内进程实现（InProcessScheduler）。
 *
 * 这个接口存在的意义：
 *   - Phase B 把 handoff watcher / 心跳 / 崩溃恢复都放在 gateway 进程里跑（MVP）
 *   - 但调度入口需要可替换，方便未来切到 Redis / Bullmq / 外部 scheduler
 *   - 接口对应 v3.11 D40 决策的 9 个方法
 *
 * 9 个方法：
 *   1. schedule(task)               入队一个任务
 *   2. cancel(taskId)               取消一个任务（如尚未开始）
 *   3. pause(taskId)                暂停一个任务（暂停后可 resume）
 *   4. resume(taskId)               恢复一个被暂停的任务
 *   5. pauseAll()                   批量暂停（用户的"全部暂停"按钮）
 *   6. resumeAll()                  批量恢复
 *   7. listActive()                 列出当前运行中 + pending 的任务
 *   8. getStatus(taskId)            获取单个任务状态
 *   9. subscribe(listener)          订阅任务状态变化（取消订阅返回 unsubscribe）
 *
 * Phase B 的"任务"语义：
 *   - 每个任务对应一个 handoff_records 行
 *   - status 反映 handoff_state（pending → claimed → running → completed/failed/cancelled/paused）
 *   - 调度器本身不写 DB，只负责 in-process 协程的生命周期；DB 状态由 watcher / store 维护
 *
 * 不做的事（Phase C+）：
 *   - 持久化排队（重启后内存任务消失，靠 watcher 从 DB pending 重新拉起）
 *   - 任务优先级队列（current implementation: FIFO）
 *   - 跨 gateway 实例的分布式调度（需要 Redis）
 */

export type ScheduledTaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'paused';

export interface ScheduledTaskSnapshot {
  id: string;
  status: ScheduledTaskStatus;
  enqueuedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  failureReason: string | null;
  /** 自定义元数据（一般是 handoffId / sessionId / roleLayer 等） */
  meta: Record<string, unknown>;
}

export interface ScheduledTaskInput {
  /**
   * 唯一 id；已存在时再次 schedule 等同于 noop。
   * 一般使用 handoff_records.id 或 `handoff:${handoffId}`。
   */
  id: string;
  meta?: Record<string, unknown>;
  /** 实际任务体，返回 promise；scheduler 只 await 而不分析返回值 */
  run: (signal: AbortSignal) => Promise<void>;
}

export type SchedulerEvent =
  | { type: 'enqueued'; task: ScheduledTaskSnapshot }
  | { type: 'started'; task: ScheduledTaskSnapshot }
  | { type: 'completed'; task: ScheduledTaskSnapshot }
  | { type: 'failed'; task: ScheduledTaskSnapshot; reason: string }
  | { type: 'cancelled'; task: ScheduledTaskSnapshot }
  | { type: 'paused'; task: ScheduledTaskSnapshot }
  | { type: 'resumed'; task: ScheduledTaskSnapshot };

export type SchedulerListener = (event: SchedulerEvent) => void;

/**
 * v3.11 D40 锁定的 9 个方法。
 * Phase B 唯一实现：InProcessScheduler。
 */
export interface BackgroundTaskScheduler {
  schedule(input: ScheduledTaskInput): ScheduledTaskSnapshot;
  cancel(taskId: string): boolean;
  pause(taskId: string): boolean;
  resume(taskId: string): boolean;
  pauseAll(): number;
  resumeAll(): number;
  listActive(): ScheduledTaskSnapshot[];
  getStatus(taskId: string): ScheduledTaskSnapshot | null;
  subscribe(listener: SchedulerListener): () => void;
}

interface InternalTask {
  snapshot: ScheduledTaskSnapshot;
  input: ScheduledTaskInput;
  abort: AbortController;
  /** running promise；pending 时为 null */
  runningPromise: Promise<void> | null;
  /** paused 时保存原 status，resume 时还原 */
  preParseStatus: ScheduledTaskStatus | null;
}

export class InProcessScheduler implements BackgroundTaskScheduler {
  private tasks = new Map<string, InternalTask>();
  private listeners = new Set<SchedulerListener>();
  /** 全局暂停标志：pauseAll 后新入队任务也保持 pending 不启动 */
  private globalPaused = false;

  schedule(input: ScheduledTaskInput): ScheduledTaskSnapshot {
    const existing = this.tasks.get(input.id);
    if (existing) {
      return cloneSnapshot(existing.snapshot);
    }

    const snapshot: ScheduledTaskSnapshot = {
      id: input.id,
      status: 'pending',
      enqueuedAt: Date.now(),
      startedAt: null,
      completedAt: null,
      failureReason: null,
      meta: input.meta ?? {},
    };
    const task: InternalTask = {
      snapshot,
      input,
      abort: new AbortController(),
      runningPromise: null,
      preParseStatus: null,
    };
    this.tasks.set(input.id, task);
    this.emit({ type: 'enqueued', task: cloneSnapshot(snapshot) });

    if (!this.globalPaused) {
      this.runTask(task);
    }
    return cloneSnapshot(snapshot);
  }

  cancel(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (
      task.snapshot.status === 'completed' ||
      task.snapshot.status === 'failed' ||
      task.snapshot.status === 'cancelled'
    ) {
      return false;
    }
    task.snapshot.status = 'cancelled';
    task.snapshot.completedAt = Date.now();
    task.abort.abort();
    this.emit({ type: 'cancelled', task: cloneSnapshot(task.snapshot) });
    return true;
  }

  pause(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (task.snapshot.status === 'paused') return false;
    if (
      task.snapshot.status === 'completed' ||
      task.snapshot.status === 'failed' ||
      task.snapshot.status === 'cancelled'
    ) {
      return false;
    }
    // 当前 InProcess 实现只在 status 层面记录 paused，实际正在 run 的协程
    // 通过 abort.signal 自行检查。这种"协作式 pause"对 LLM 调用就足够：
    // 下一轮 LLM 完成时检查 signal 即可决定是否继续。
    task.preParseStatus = task.snapshot.status;
    task.snapshot.status = 'paused';
    task.abort.abort(); // 触发 signal，让 run 内部自检退出
    this.emit({ type: 'paused', task: cloneSnapshot(task.snapshot) });
    return true;
  }

  resume(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (task.snapshot.status !== 'paused') return false;
    // 重新生成 abort controller，因为 paused 时已 abort 过一次
    task.abort = new AbortController();
    task.snapshot.status = task.preParseStatus ?? 'pending';
    task.preParseStatus = null;
    this.emit({ type: 'resumed', task: cloneSnapshot(task.snapshot) });
    if (!this.globalPaused && task.snapshot.status === 'pending') {
      this.runTask(task);
    }
    return true;
  }

  pauseAll(): number {
    this.globalPaused = true;
    let count = 0;
    for (const task of this.tasks.values()) {
      if (task.snapshot.status === 'pending' || task.snapshot.status === 'running') {
        if (this.pause(task.input.id)) count += 1;
      }
    }
    return count;
  }

  resumeAll(): number {
    this.globalPaused = false;
    let count = 0;
    for (const task of this.tasks.values()) {
      if (task.snapshot.status === 'paused') {
        if (this.resume(task.input.id)) count += 1;
      }
    }
    return count;
  }

  listActive(): ScheduledTaskSnapshot[] {
    const active: ScheduledTaskSnapshot[] = [];
    for (const task of this.tasks.values()) {
      if (
        task.snapshot.status === 'pending' ||
        task.snapshot.status === 'running' ||
        task.snapshot.status === 'paused'
      ) {
        active.push(cloneSnapshot(task.snapshot));
      }
    }
    return active;
  }

  getStatus(taskId: string): ScheduledTaskSnapshot | null {
    const task = this.tasks.get(taskId);
    return task ? cloneSnapshot(task.snapshot) : null;
  }

  subscribe(listener: SchedulerListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private runTask(task: InternalTask): void {
    if (task.runningPromise) return;
    task.snapshot.status = 'running';
    task.snapshot.startedAt = Date.now();
    this.emit({ type: 'started', task: cloneSnapshot(task.snapshot) });

    task.runningPromise = task.input
      .run(task.abort.signal)
      .then(() => {
        // 在 paused / cancelled 后，run 内部主动返回也算 paused/cancelled
        // 不再 emit completed
        if (task.snapshot.status === 'running') {
          task.snapshot.status = 'completed';
          task.snapshot.completedAt = Date.now();
          this.emit({ type: 'completed', task: cloneSnapshot(task.snapshot) });
        }
      })
      .catch((err: unknown) => {
        const reason = err instanceof Error ? err.message : String(err);
        if (task.snapshot.status === 'running') {
          task.snapshot.status = 'failed';
          task.snapshot.completedAt = Date.now();
          task.snapshot.failureReason = reason;
          this.emit({ type: 'failed', task: cloneSnapshot(task.snapshot), reason });
        }
      })
      .finally(() => {
        task.runningPromise = null;
      });
  }

  private emit(event: SchedulerEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        // 监听器异常不应影响调度器主流程
        console.warn(
          `[InProcessScheduler] listener threw: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}

function cloneSnapshot(snapshot: ScheduledTaskSnapshot): ScheduledTaskSnapshot {
  return {
    ...snapshot,
    meta: { ...snapshot.meta },
  };
}

/**
 * 进程级单例。当前简单直接的全局实例；如未来要做多 gateway，
 * 替换实现即可（接口稳定）。
 */
let singleton: BackgroundTaskScheduler | null = null;

export function getBackgroundTaskScheduler(): BackgroundTaskScheduler {
  if (!singleton) {
    singleton = new InProcessScheduler();
  }
  return singleton;
}

/**
 * 仅供测试使用：重置单例，让每个测试文件用全新实例。
 */
export function __resetBackgroundTaskSchedulerForTesting(): void {
  singleton = null;
}
