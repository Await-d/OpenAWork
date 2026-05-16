/**
 * 260515-team-phase-b · T-04 / T-06
 *
 * Handoff Watcher 守护进程（gateway 内嵌）。
 *
 * 职责：
 *   1. 周期性扫描 `state='pending'` 的 handoff_records
 *   2. 抢占式 claim → 创建子 session → start handoff（写 to_session_id）
 *   3. 通过 `BackgroundTaskScheduler.schedule` 把"实际跑这一层 agent"的任务排队
 *   4. 周期性调用 `reclaimAbandonedHandoffs` 做崩溃恢复（T-06）
 *
 * 设计要点：
 *   - 默认 100ms 轮询（v3.11 plan 默认值）；可由 `OPENAWORK_HANDOFF_WATCHER_INTERVAL_MS` 调整
 *   - 单 gateway 进程单 watcher（singleton）；多 gateway 场景靠 SQLite UPDATE 抢占（claim 是原子）
 *   - 任务执行体 `runHandoffTask` 在 Phase B 是占位实现（仅写日志 + 完成）；
 *     真正的 LLM 调用在 T-09/T-10 重构 interaction-agent / team-leader 时接入
 *   - graceful shutdown：stop() 等待当前 tick 完成
 *
 * 这一层把 watcher 从 scheduler 拆出来，让 watcher 专心做 DB ↔ scheduler
 * 的桥接，scheduler 专心做"已知任务的生命周期"。
 */

import { randomUUID } from 'node:crypto';
import {
  claimHandoff,
  failHandoff,
  listPendingHandoffs,
  reclaimAbandonedHandoffs,
  startHandoff,
  type HandoffRecord,
} from './handoff-store.js';
import { findStaleHeartbeatCutoffIso, HEARTBEAT_STALE_AFTER_MS } from './heartbeat.js';
import { getBackgroundTaskScheduler, type BackgroundTaskScheduler } from './scheduler.js';
import { publishHandoffEvent } from './team-events-bus.js';
import { createTeamSession } from './team-session-create.js';

const DEFAULT_WATCHER_INTERVAL_MS = 100;
const DEFAULT_RECOVERY_INTERVAL_MS = 5_000;
const DEFAULT_HEARTBEAT_STALE_MS = HEARTBEAT_STALE_AFTER_MS;
const DEFAULT_MAX_RETRY = 3;

/**
 * 单条 handoff 的"真正执行体"占位。
 *
 * Phase B Wave 2 阶段先做最小可工作版本：
 *   - 把 handoff payload 塞进新 session 的 metadata（待 T-09/T-10 替换为 LLM 调用）
 *   - 等待一小段时间模拟 work（生产环境会被真正 LLM 流替代）
 *   - 完成后通过 store 完成 handoff
 *
 * **这是占位 stub**——真正 agent 调用在 T-09/T-10 接入。
 */
export type HandoffTaskRunner = (input: {
  handoff: HandoffRecord;
  toSessionId: string;
  signal: AbortSignal;
}) => Promise<void>;

/** 默认 stub：标记完成，不做任何事。让 Watcher 不阻塞在 pending 队列。 */
const defaultStubRunner: HandoffTaskRunner = async (_input) => {
  // 占位 stub：Phase B 阶段 watcher 只做状态流转，不执行真实 LLM 调用。
  // T-09/T-10 注入真实 runner 后此 stub 不再被使用。
  void _input;
};

export interface HandoffWatcherOptions {
  /** 主轮询间隔，默认 100ms */
  watcherIntervalMs?: number;
  /** 崩溃恢复扫描间隔，默认 5s */
  recoveryIntervalMs?: number;
  /** 心跳超时阈值，默认 60s（D51） */
  heartbeatStaleAfterMs?: number;
  /** 最大重试次数，默认 3（达到后改 fail 而不是无限重试） */
  maxRetry?: number;
  /** 自定义任务执行体（测试 / T-09/T-10 注入） */
  taskRunner?: HandoffTaskRunner;
  /** 注入 scheduler（测试用） */
  scheduler?: BackgroundTaskScheduler;
}

export class HandoffWatcher {
  private timer: NodeJS.Timeout | null = null;
  private recoveryTimer: NodeJS.Timeout | null = null;
  private running = false;
  private tickInFlight = false;
  private readonly options: Required<Omit<HandoffWatcherOptions, 'taskRunner' | 'scheduler'>> & {
    taskRunner: HandoffTaskRunner;
    scheduler: BackgroundTaskScheduler;
  };

  constructor(options: HandoffWatcherOptions = {}) {
    this.options = {
      watcherIntervalMs: options.watcherIntervalMs ?? DEFAULT_WATCHER_INTERVAL_MS,
      recoveryIntervalMs: options.recoveryIntervalMs ?? DEFAULT_RECOVERY_INTERVAL_MS,
      heartbeatStaleAfterMs: options.heartbeatStaleAfterMs ?? DEFAULT_HEARTBEAT_STALE_MS,
      maxRetry: options.maxRetry ?? DEFAULT_MAX_RETRY,
      taskRunner: options.taskRunner ?? defaultStubRunner,
      scheduler: options.scheduler ?? getBackgroundTaskScheduler(),
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => {
      void this.tickOnce();
    }, this.options.watcherIntervalMs);
    // unref 让 watcher 不阻挡进程退出（生产 gateway 进程退出时不需要 watcher 强制 keep-alive）
    this.timer.unref?.();

    this.recoveryTimer = setInterval(() => {
      void this.recoveryTick();
    }, this.options.recoveryIntervalMs);
    this.recoveryTimer.unref?.();
  }

  /**
   * 停止 watcher。等待当前 tick 完成（最多 1s）。
   */
  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.recoveryTimer) {
      clearInterval(this.recoveryTimer);
      this.recoveryTimer = null;
    }
    // 等待最多 1s 让 in-flight tick 收尾
    const deadline = Date.now() + 1000;
    while (this.tickInFlight && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  /**
   * 主轮询 tick：拉取 pending → claim → 创建子 session → 排队执行体。
   * 暴露为 public 方便测试 / 手动触发。
   */
  async tickOnce(): Promise<{ claimed: number; skipped: number }> {
    if (this.tickInFlight) {
      return { claimed: 0, skipped: 0 };
    }
    this.tickInFlight = true;
    try {
      const pending = listPendingHandoffs(50);
      let claimed = 0;
      let skipped = 0;
      for (const record of pending) {
        const claimToken = randomUUID();
        const claimedRecord = claimHandoff({
          handoffId: record.id,
          claimToken,
        });
        if (!claimedRecord) {
          skipped += 1;
          continue;
        }
        publishHandoffEvent({ type: 'handoff.claimed', record: claimedRecord });

        // 创建子 session
        const { sessionId: toSessionId } = createTeamSession({
          userId: record.userId,
          roleLayer: record.toRoleLayer,
          teamParentSessionId: record.fromSessionId,
          handoffState: 'running',
        });

        const startOk = startHandoff({
          handoffId: record.id,
          claimToken,
          toSessionId,
        });
        if (!startOk) {
          // 极少数情况：start 失败（比如刚被 cancel）；直接跳过
          skipped += 1;
          continue;
        }
        const startedRecord = { ...claimedRecord, toSessionId, state: 'running' as const };
        publishHandoffEvent({ type: 'handoff.started', record: startedRecord });
        claimed += 1;

        // 排队执行体（scheduler 会异步跑）
        this.scheduleHandoffTask({
          handoff: startedRecord,
          toSessionId,
          claimToken,
        });
      }
      return { claimed, skipped };
    } finally {
      this.tickInFlight = false;
    }
  }

  /**
   * 崩溃恢复 tick：把超过心跳超时的 claimed/running 退回 pending。
   * 也可手动触发用于测试。
   */
  async recoveryTick(): Promise<{ recovered: number }> {
    const cutoff = findStaleHeartbeatCutoffIso(this.options.heartbeatStaleAfterMs);
    const recovered = reclaimAbandonedHandoffs({
      staleHeartbeatBeforeIso: cutoff,
      maxRetry: this.options.maxRetry,
    });
    if (recovered > 0) {
      // 不知道具体哪条被 reclaim，简单广播一次"事件总线收到一些 reclaim"
      // 详细 record 由前端通过 GET /team/sessions/.../handoffs 拉取
    }
    return { recovered };
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private scheduleHandoffTask(input: {
    handoff: HandoffRecord;
    toSessionId: string;
    claimToken: string;
  }): void {
    this.options.scheduler.schedule({
      id: `handoff:${input.handoff.id}`,
      meta: {
        handoffId: input.handoff.id,
        toSessionId: input.toSessionId,
        toRoleLayer: input.handoff.toRoleLayer,
        userId: input.handoff.userId,
      },
      run: async (signal) => {
        try {
          await this.options.taskRunner({
            handoff: input.handoff,
            toSessionId: input.toSessionId,
            signal,
          });
          if (signal.aborted) {
            return;
          }
          // T-09/T-10 注入的 runner 自己负责 completeHandoff；这里只做兜底：
          // 若 runner 是默认 stub（什么都没做），状态仍是 running，需要补
          // 调一次 complete 让前端能看到终态。runner 自己 complete 过则
          // completeHandoff 第二次会因状态不再是 running 而返回 false，无副作用。
          const { completeHandoff } = await import('./handoff-store.js');
          completeHandoff({
            handoffId: input.handoff.id,
            claimToken: input.claimToken,
          });
        } catch (err) {
          if (signal.aborted) return;
          const reason = err instanceof Error ? err.message : String(err);
          failHandoff({
            handoffId: input.handoff.id,
            claimToken: input.claimToken,
            reason,
          });
          throw err;
        }
      },
    });
  }
}

// ─── 进程级单例 ────────────────────────────────────────────────────────────

let singleton: HandoffWatcher | null = null;

export function getHandoffWatcher(): HandoffWatcher {
  if (!singleton) {
    singleton = new HandoffWatcher();
  }
  return singleton;
}

export function startHandoffWatcher(options?: HandoffWatcherOptions): HandoffWatcher {
  if (singleton) {
    return singleton;
  }
  singleton = new HandoffWatcher(options);
  singleton.start();
  return singleton;
}

export async function stopHandoffWatcher(): Promise<void> {
  if (singleton) {
    await singleton.stop();
    singleton = null;
  }
}

export function __resetHandoffWatcherForTesting(): void {
  singleton = null;
}
