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
 *   - 任务执行体通过 `createPhaseCAwareRunner()` 注入，按 toRoleLayer 分发到
 *     pm1-runner / pm2-runner / executor-runner
 *   - graceful shutdown：stop() 等待当前 tick 完成
 *
 * 这一层把 watcher 从 scheduler 拆出来，让 watcher 专心做 DB ↔ scheduler
 * 的桥接，scheduler 专心做"已知任务的生命周期"。
 */

import { randomUUID } from 'node:crypto';
import { sqliteAll, sqliteGet, sqliteRun } from '../../infra/db.js';
import {
  claimHandoff,
  failHandoff,
  listPendingHandoffs,
  reclaimAbandonedHandoffs,
  startHandoff,
  type HandoffRecord,
} from '../store/handoff-store.js';
import {
  findStaleHeartbeatCutoffIso,
  HEARTBEAT_STALE_AFTER_MS,
  touchSessionHeartbeat,
} from '../bus/heartbeat.js';
import { getBackgroundTaskScheduler, type BackgroundTaskScheduler } from './scheduler.js';
import { publishHandoffEvent, publishHallucinationEvent } from '../bus/team-events-bus.js';
import { recordTeamRuntimeIncident } from '../../team/team-runtime-diagnostics-store.js';
import { findOrCreateTeamRoleSession } from '../bus/team-session-create.js';
import {
  buildTeamRosterManifest,
  mergeDelegatedSystemPromptIntoMetadata,
  mergeMemberCapabilitiesIntoMetadata,
  mergeMemberModelIntoMetadata,
  mergeTeamRosterManifestIntoMetadata,
  resolveMemberCapabilities,
  resolveMemberModelForHandoff,
  resolveMemberSystemPrompt,
} from '../bus/resolve-member-model.js';
import { reconcilePm2QualityReview } from './pm2-quality-review-reconciler.js';

const DEFAULT_WATCHER_INTERVAL_MS = 100;
const DEFAULT_RECOVERY_INTERVAL_MS = 5_000;
const DEFAULT_HEARTBEAT_STALE_MS = HEARTBEAT_STALE_AFTER_MS;
const DEFAULT_MAX_RETRY = 3;
/**
 * #8 doom-loop wall-clock cutoff：handoff 进入 running/claimed 后超过这个时长
 * 仍未结束的，即使心跳新鲜也强制 failed。30 分钟基本覆盖人类可耐心等待的极限，
 * 又远高于实际任务上限（reception/pm1/pm2 < 1min，executor 一般 < 10min）。
 */
const DEFAULT_RUNNING_TOO_LONG_MS = 30 * 60 * 1000;

interface AssignedMemberSessionSummary {
  id?: string;
  personaKey?: string;
  displayName?: string;
}

function readAssignedMemberSessionSummary(payload: unknown): AssignedMemberSessionSummary | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return null;
  }
  const assignedMember = (payload as Record<string, unknown>)['assignedMember'];
  if (
    typeof assignedMember !== 'object' ||
    assignedMember === null ||
    Array.isArray(assignedMember)
  ) {
    return null;
  }
  const record = assignedMember as Record<string, unknown>;
  const id = typeof record['id'] === 'string' && record['id'].trim() ? record['id'].trim() : null;
  const personaKey =
    typeof record['personaKey'] === 'string' && record['personaKey'].trim()
      ? record['personaKey'].trim()
      : null;
  const displayName =
    typeof record['displayName'] === 'string' && record['displayName'].trim()
      ? record['displayName'].trim()
      : null;
  if (!id && !personaKey && !displayName) {
    return null;
  }
  return {
    ...(id ? { id } : {}),
    ...(personaKey ? { personaKey } : {}),
    ...(displayName ? { displayName } : {}),
  };
}

/**
 * 单条 handoff 的"真正执行体"类型。
 *
 * 由 `createPhaseCAwareRunner()` 实现，按 toRoleLayer 分发到：
 *   - pm1 → runArtifactChain（spec/plan/tasks 产物链）
 *   - pm2 → pm2-runner（constitution check + dispatch + quality review）
 *   - executor/reviewer → runExecutionLayer（完整 stream 协议）
 */
export type HandoffTaskRunner = (input: {
  handoff: HandoffRecord;
  toSessionId: string;
  signal: AbortSignal;
}) => Promise<void>;

/** 默认 stub：标记完成，不做任何事。仅在未注入 taskRunner 时使用（测试场景）。 */
const defaultStubRunner: HandoffTaskRunner = async (_input) => {
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
  /**
   * #8 Doom-loop 墙钟超时：handoff 进入 running/claimed 后超过此时长仍未结束
   * 的，即使心跳还在更新也强制 failed（针对"工具死循环 / 推理失控"等持续
   * 假装活着的场景）。默认 30 分钟。0 或负数关闭此守卫。
   */
  runningTooLongMs?: number;
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
      runningTooLongMs: options.runningTooLongMs ?? DEFAULT_RUNNING_TOO_LONG_MS,
      taskRunner: options.taskRunner ?? defaultStubRunner,
      scheduler: options.scheduler ?? getBackgroundTaskScheduler(),
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => {
      // Isolate the background loop: a rejecting tick (e.g. transient SQLite
      // error) must not become an unhandled rejection that crashes the
      // gateway. Direct callers (tests / manual triggers) still observe the
      // rejection normally.
      this.tickOnce().catch((err: unknown) => {
        console.error(
          '[watcher] tickOnce failed',
          err instanceof Error ? err.message : String(err),
        );
      });
    }, this.options.watcherIntervalMs);
    // unref 让 watcher 不阻挡进程退出（生产 gateway 进程退出时不需要 watcher 强制 keep-alive）
    this.timer.unref?.();

    this.recoveryTimer = setInterval(() => {
      this.recoveryTick().catch((err: unknown) => {
        console.error(
          '[watcher] recoveryTick failed',
          err instanceof Error ? err.message : String(err),
        );
      });
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
        // Per-record resilience: each iteration claims a handoff then runs
        // member-model / persona / capability resolution + child-session
        // creation, any of which can throw (corrupt payload, JSON parse,
        // SQLite error). Without a per-record guard, ONE poison handoff would
        // abort the entire dispatch sweep — starving every other pending
        // handoff in the queue and orphaning this just-claimed record until
        // the recovery tick reclaims it. Isolate per record: skip the bad one
        // (the recovery tick re-pends any handoff left mid-claim) and let the
        // rest of the sweep proceed.
        try {
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
          // Phase 2：把该层成员在模板里绑定的模型（若有）注入子 session metadata，
          // 让 resolveStreamModelRoute 按 metadata.modelId/providerId 路由到指定模型。
          const memberModel = resolveMemberModelForHandoff({
            fromSessionId: record.fromSessionId,
            toRoleLayer: record.toRoleLayer,
            payload: record.payload,
          });
          // 自定义角色：把其人物提示词作为 delegatedSystemPrompt 注入，运行时用它当系统人设。
          const memberPersona = resolveMemberSystemPrompt({
            fromSessionId: record.fromSessionId,
            payload: record.payload,
          });

          // 从父 session 的 metadata 中继承 teamWorkspaceId，确保子 session 也能
          // 被 /team/runtime 的 listTeamRuntimeSessionRows 查询到（该查询通过
          // metadata.teamWorkspaceId 过滤）。没有这一步，PM1/PM2/executor/reviewer
          // 的 session 不会出现在前端的会话列表中。
          let childMetadataJson: string | undefined = undefined;
          try {
            const parentRow = sqliteGet<{ metadata_json: string }>(
              'SELECT metadata_json FROM sessions WHERE id = ? LIMIT 1',
              [record.fromSessionId],
            );
            if (parentRow?.metadata_json) {
              const parentMeta = JSON.parse(parentRow.metadata_json) as Record<string, unknown>;
              const inherited: Record<string, unknown> = {};
              if (typeof parentMeta['teamWorkspaceId'] === 'string') {
                inherited['teamWorkspaceId'] = parentMeta['teamWorkspaceId'];
              }
              if (typeof parentMeta['workingDirectory'] === 'string') {
                inherited['workingDirectory'] = parentMeta['workingDirectory'];
              }
              // 继承 yoloMode：team 成员在后台运行，无法与用户交互审批。
              // 父 session 开启了 yoloMode 时，子 session 也应继承免审批。
              if (parentMeta['yoloMode'] === true) {
                inherited['yoloMode'] = true;
              }
              if (Object.keys(inherited).length > 0) {
                childMetadataJson = JSON.stringify(inherited);
              }
            }
          } catch (err) {
            console.warn(
              `[watcher] 读取父 session metadata 失败：${err instanceof Error ? err.message : String(err)}`,
            );
          }

          childMetadataJson = mergeMemberModelIntoMetadata(childMetadataJson, memberModel);
          childMetadataJson = mergeDelegatedSystemPromptIntoMetadata(
            childMetadataJson,
            memberPersona?.systemPrompt,
          );
          // 模板初始能力绑定（skills / mcp）注入子 session metadata。
          const memberCaps = resolveMemberCapabilities({
            fromSessionId: record.fromSessionId,
            toRoleLayer: record.toRoleLayer,
            payload: record.payload,
          });
          childMetadataJson = mergeMemberCapabilitiesIntoMetadata(childMetadataJson, memberCaps);
          // 动态注入「团队编制清单」：把当前实时花名册（含自定义角色）按层渲染，
          // 让子 session 的成员感知上下游有谁、各自擅长什么 —— 上下关联处的动态提示词。
          const assignedMember = readAssignedMemberSessionSummary(record.payload);
          const rosterManifest = buildTeamRosterManifest({
            fromSessionId: record.fromSessionId,
            currentLayer: record.toRoleLayer,
            ...(assignedMember?.personaKey ? { currentPersonaKey: assignedMember.personaKey } : {}),
          });
          childMetadataJson = mergeTeamRosterManifestIntoMetadata(
            childMetadataJson,
            rosterManifest,
          );
          const { sessionId: toSessionId } = findOrCreateTeamRoleSession({
            userId: record.userId,
            roleLayer: record.toRoleLayer,
            teamParentSessionId: record.fromSessionId,
            handoffState: 'running',
            personaKey: assignedMember?.personaKey,
            displayName: assignedMember?.displayName ?? assignedMember?.id,
            ...(childMetadataJson ? { metadataJson: childMetadataJson } : {}),
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
        } catch (err) {
          // One handoff failing to dispatch must not abort the sweep. The
          // recovery tick re-pends any handoff left in `claimed`/`running`
          // past its heartbeat, so a record that threw after being claimed is
          // retried later rather than silently lost.
          skipped += 1;
          console.error(
            `[watcher] 派发 handoff ${record.id} 失败，跳过该条继续本轮扫描：${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
      await this.reconcilePendingPm2QualityReviews();
      return { claimed, skipped };
    } finally {
      this.tickInFlight = false;
    }
  }

  /**
   * 崩溃恢复 tick：把超过心跳超时的 claimed/running 退回 pending。
   * 也可手动触发用于测试。
   *
   * 对每条被 reclaim 的 handoff 发 'handoff.reclaimed' 事件，
   * 对达到 maxRetry 改 failed 的发 'handoff.failed' 事件，
   * 让前端实时感知崩溃恢复结果。
   */
  async recoveryTick(): Promise<{ recovered: number; failed: number }> {
    const cutoff = findStaleHeartbeatCutoffIso(this.options.heartbeatStaleAfterMs);
    // #8 doom-loop 墙钟阈值：started_at 早于此截止值的 running/claimed handoff
    // 即使心跳还在也强制 failed。复用 findStaleHeartbeatCutoffIso 的格式
    // ('YYYY-MM-DD HH:MM:SS' UTC) 与 SQLite datetime('now') 写入格式一致，
    // 让字符串比较产生正确时间序。runningTooLongMs<=0 时关闭此守卫。
    const runningStartedBeforeIso =
      this.options.runningTooLongMs > 0
        ? findStaleHeartbeatCutoffIso(this.options.runningTooLongMs)
        : undefined;
    const { reclaimedIds, failedIds } = reclaimAbandonedHandoffs({
      staleHeartbeatBeforeIso: cutoff,
      maxRetry: this.options.maxRetry,
      runningStartedBeforeIso,
    });

    // 对每条处理过的 handoff 拉取最新记录并发事件
    if (reclaimedIds.length > 0 || failedIds.length > 0) {
      const { getHandoffById } = await import('../store/handoff-store.js');
      const { setSubstate } = await import('../store/substate-store.js');
      // Per-id resilience: the reclaim/fail STATE is already committed
      // atomically by reclaimAbandonedHandoffs above; these loops only emit
      // events / incidents. A throw on one id (e.g. getHandoffById SQLite
      // error) must not skip emission for the remaining ids, so isolate each.
      for (const id of reclaimedIds) {
        try {
          const record = getHandoffById(id);
          if (record) {
            publishHandoffEvent({ type: 'handoff.reclaimed', record });
          }
        } catch (err) {
          console.error(
            `[watcher] recovery 发布 reclaimed 事件失败（${id}），跳过继续：${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
      for (const id of failedIds) {
        try {
          const record = getHandoffById(id);
          if (record) {
            recordTeamRuntimeIncident({
              category: 'handoff_failure',
              code: 'handoff-recovery-failed',
              context: {
                handoffId: record.id,
                retryCount: record.retryCount,
                toRoleLayer: record.toRoleLayer,
              },
              message: record.failureReason ?? 'heartbeat-timeout',
              severity: 'error',
              timestamp: Date.now(),
              userId: record.userId,
            });
            // 同步把 to_session 的 substate 推到 'failed'，让前端进度条立刻反映终态
            if (record.toSessionId) {
              try {
                setSubstate({
                  sessionId: record.toSessionId,
                  substate: 'failed',
                  userId: record.userId,
                  roleLayer: record.toRoleLayer,
                });
              } catch (e) {
                console.warn(
                  `[watcher] recovery setSubstate('failed') 失败：${e instanceof Error ? e.message : String(e)}`,
                );
              }
            }
            publishHandoffEvent({
              type: 'handoff.failed',
              record,
              payload: { reason: record.failureReason ?? 'heartbeat-timeout' },
            });
          }
        } catch (err) {
          console.error(
            `[watcher] recovery 处理 failed handoff ${id} 失败，跳过继续：${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    }
    // ─── Stale session state_status recovery ────────────────────────────────
    // 进程崩溃（OOM/SIGKILL）后 session 可能永久卡在 state_status='running'：
    // 正常路径的 catch/finally 来不及执行，runtime_thread 行的 heartbeat 停止
    // 更新但行本身还在。前端 2.5s polling 会持续空转，用户看到"正在运行"但
    // 永远没有新内容。这里检测：state_status='running' 且 runtime_thread 心跳
    // 已过期（或行不存在），则重置为 idle。只处理 team session（有 role_layer）
    // 避免误伤 chat 端正常的长时间 stream。
    try {
      const { SESSION_RUNTIME_THREAD_STALE_AFTER_MS } =
        await import('../../session/session-runtime-thread-store.js');
      const { setPersistedSessionStateStatus } = await import('../../routes/stream.js');
      const staleThreadCutoffMs = Date.now() - SESSION_RUNTIME_THREAD_STALE_AFTER_MS;
      const stuckSessions = sqliteAll<{ id: string; user_id: string }>(
        `SELECT s.id, s.user_id
           FROM sessions s
          WHERE s.state_status = 'running'
            AND s.role_layer IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM session_runtime_threads t
               WHERE t.session_id = s.id
                 AND t.heartbeat_at_ms > ?
            )`,
        [staleThreadCutoffMs],
      );
      for (const stuck of stuckSessions) {
        try {
          setPersistedSessionStateStatus({
            sessionId: stuck.id,
            status: 'idle',
            userId: stuck.user_id,
          });
        } catch (e) {
          console.warn(
            `[watcher] stale session reset failed (${stuck.id}): ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    } catch (err) {
      // Best-effort: 不阻塞 recoveryTick 主流程
      console.warn(
        `[watcher] stale session sweep failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // ─── Reception awaiting_downstream 死锁兜底 ──────────────────────────────
    // reception 派发后置 substate='awaiting_downstream'，正常由下游进度/完成事件
    // 驱动 UI。但若整条下游链全部终止（completed/failed/cancelled）却没有任何
    // 进度回流，reception 会永久停在 awaiting_downstream → 用户界面死锁。这里兜底：
    // 检测「reception 处于 awaiting_downstream 且其下游子树已无任何存活 handoff」，
    // 重置 substate 并写一条 assistant 反馈，避免无限等待。
    try {
      await this.reconcileStuckReceptionSessions();
    } catch (err) {
      console.warn(
        `[watcher] reception awaiting_downstream sweep failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return { recovered: reclaimedIds.length, failed: failedIds.length };
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private async reconcilePendingPm2QualityReviews(): Promise<void> {
    const candidates = sqliteAll<{ id: string; user_id: string; to_session_id: string | null }>(
      `SELECT id, user_id, to_session_id
         FROM handoff_records
        WHERE state = 'running' AND to_role_layer = 'pm2'`,
    ).map((row) => ({
      handoffId: row.id,
      userId: row.user_id,
      toSessionId: row.to_session_id,
    }));
    for (const candidate of candidates) {
      // §0.148: a pm2 handoff stays `running` while its e/f/g children work,
      // but the pm2 runner's own `run` has already returned — so nothing else
      // refreshes the pm2 session heartbeat. Only the streaming path writes
      // heartbeats; pm2 uses non-streaming LLM calls. Without this touch the
      // crash-recovery reclaim (which treats a stale / NULL last_heartbeat as
      // abandoned) re-pends a perfectly healthy pm2 that is merely awaiting its
      // children — duplicating the whole d→e/f/g dispatch. A genuine
      // watcher/process crash stops these ticks, so the heartbeat then goes
      // stale and recovery correctly reclaims on restart.
      if (candidate.toSessionId) {
        try {
          touchSessionHeartbeat(candidate.toSessionId);
        } catch {
          /* best-effort liveness ping */
        }
      }
      // Per-candidate resilience: reconcilePm2QualityReview can reject (its
      // own catch handler does SQLite + audit work that may throw). This loop
      // runs at the tail of tickOnce, so one poison pm2 review used to abort
      // the whole sweep — starving every other pending quality review AND
      // rejecting the entire tick. Isolate per candidate so the rest of the
      // pending pm2 reviews still reconcile this tick.
      try {
        await reconcilePm2QualityReview({
          pm2HandoffId: candidate.handoffId,
          userId: candidate.userId,
        });
      } catch (err) {
        console.error(
          `[watcher] pm2 质量评审 ${candidate.handoffId} 协调失败，跳过该条继续本轮：${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  /**
   * Reception awaiting_downstream 死锁兜底扫描。
   *
   * 找出所有 substate='awaiting_downstream' 的 reception session，检查其下游子树
   * （沿 team_parent_session_id 递归）是否还有任何**存活**（非终止）的 handoff：
   *   - 还有存活 handoff → 下游仍在跑，跳过（正常）。
   *   - 无任何存活 handoff（全 completed/failed/cancelled，或压根没派生出 handoff）
   *     → 下游链已彻底结束却没驱动 reception 复位 → 死锁。重置 substate 为 idle，
   *     并写一条 assistant 消息告知用户最终结果（若有失败/取消则提示可重试）。
   *
   * 每条 reception 独立 try/catch，单条出错不影响其余。
   */
  private async reconcileStuckReceptionSessions(): Promise<void> {
    // 年龄护栏：只处理已在 awaiting_downstream 停留超过 15 秒的 reception。
    // pm1→pm2 等自动链切换之间存在「上游已 completed、下游尚未创建」的
    // 微秒级窗口；15 秒已远超链切换延迟，但不会让用户在下游全部终止后等太久。
    // 原为 60s（heartbeatStaleAfterMs），但实际体验中太长导致用户看到卡顿。
    const RECEPTION_STUCK_CUTOFF_MS = 15_000;
    const cutoffIso = findStaleHeartbeatCutoffIso(RECEPTION_STUCK_CUTOFF_MS);
    const stuck = sqliteAll<{ id: string; user_id: string }>(
      `SELECT id, user_id
         FROM sessions
        WHERE role_layer = 'reception'
          AND substate = 'awaiting_downstream'
          AND (substate_updated_at IS NULL OR substate_updated_at < ?)`,
      [cutoffIso],
    );
    if (stuck.length === 0) return;

    const { setSubstate } = await import('../store/substate-store.js');

    for (const reception of stuck) {
      try {
        // 子树里（不含 reception 自身）所有存活 handoff 计数。reception 自己不会有
        // to/from 之外的 handoff；这里用 session 树覆盖 pm1/pm2/executor/reviewer。
        const liveRow = sqliteGet<{ c: number }>(
          `WITH RECURSIVE session_tree(id) AS (
             SELECT id FROM sessions WHERE id = ? AND user_id = ?
             UNION ALL
             SELECT child.id FROM sessions child
               JOIN session_tree tree ON child.team_parent_session_id = tree.id
              WHERE child.user_id = ?
           )
           SELECT COUNT(*) AS c
             FROM handoff_records h
            WHERE h.user_id = ?
              AND h.state NOT IN ('completed', 'failed', 'cancelled')
              AND (
                h.from_session_id IN (SELECT id FROM session_tree)
                OR h.to_session_id IN (SELECT id FROM session_tree)
              )`,
          [reception.id, reception.user_id, reception.user_id, reception.user_id],
        );
        const liveCount = liveRow?.c ?? 0;
        if (liveCount > 0) {
          // 下游仍在跑，正常等待。
          continue;
        }

        // 子树是否产生过 handoff（用于区分「从未派发」与「派发后全终止」）。
        const terminalRow = sqliteGet<{ total: number; failedOrCancelled: number }>(
          `WITH RECURSIVE session_tree(id) AS (
             SELECT id FROM sessions WHERE id = ? AND user_id = ?
             UNION ALL
             SELECT child.id FROM sessions child
               JOIN session_tree tree ON child.team_parent_session_id = tree.id
              WHERE child.user_id = ?
           )
           SELECT
             COUNT(*) AS total,
             SUM(CASE WHEN h.state IN ('failed', 'cancelled') THEN 1 ELSE 0 END) AS failedOrCancelled
           FROM handoff_records h
          WHERE h.user_id = ?
            AND (
              h.from_session_id IN (SELECT id FROM session_tree)
              OR h.to_session_id IN (SELECT id FROM session_tree)
            )`,
          [reception.id, reception.user_id, reception.user_id, reception.user_id],
        );
        const total = terminalRow?.total ?? 0;
        const failedOrCancelled = terminalRow?.failedOrCancelled ?? 0;

        // 重置 reception substate，解除前端死锁。
        setSubstate({
          sessionId: reception.id,
          substate: 'idle',
          userId: reception.user_id,
          roleLayer: 'reception',
        });
        sqliteRun(
          `UPDATE sessions
              SET state_status = 'idle',
                  updated_at = datetime('now')
            WHERE id = ? AND user_id = ?`,
          [reception.id, reception.user_id],
        );

        // 写一条用户可见反馈（只在「派发过但全部终止」且含失败/取消时提示重试，
        // 避免对正常完成的任务也刷无谓提示）。
        if (total > 0 && failedOrCancelled > 0) {
          try {
            const { appendSessionMessageV2 } = await import('../../message/message-v2-adapter.js');
            appendSessionMessageV2({
              sessionId: reception.id,
              userId: reception.user_id,
              role: 'assistant',
              agentId: 'interaction-agent',
              content: [
                {
                  type: 'text',
                  text: '团队的下游任务已全部结束，但其中有失败或被取消的环节，任务未能正常完成。你可以查看详情后重试或调整需求。',
                },
              ],
              clientRequestId: null,
            });
          } catch (ackErr) {
            console.warn(
              `[watcher] reception 死锁兜底反馈写入失败（${reception.id}）：${ackErr instanceof Error ? ackErr.message : String(ackErr)}`,
            );
          }
          recordTeamRuntimeIncident({
            category: 'handoff_failure',
            code: 'reception-awaiting-downstream-deadlock',
            context: { receptionSessionId: reception.id, totalHandoffs: total, failedOrCancelled },
            message: 'reception 停在 awaiting_downstream 但下游链已全部终止',
            severity: 'warning',
            timestamp: Date.now(),
            userId: reception.user_id,
          });
        }
      } catch (err) {
        console.warn(
          `[watcher] reception ${reception.id} awaiting_downstream 兜底失败，跳过：${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

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
        // §0.148: keep the to_session heartbeat fresh for the entire in-process
        // run. Only the streaming executor/reviewer path (stream-model-round)
        // writes heartbeats; pm1 (artifact chain) and pm2 use non-streaming LLM
        // calls, so their freshly-created child sessions stay last_heartbeat=NULL
        // — which the crash-recovery reclaim query treats as IMMEDIATELY stale.
        // With the 5s recovery tick that re-pends a healthy, still-running pm1
        // within seconds (duplicate child session + duplicate LLM spend). Stamp
        // once up front, then pump at staleMs/3 so a live run never trips the
        // stale cutoff, while a real crash stops the pump (interval dies with the
        // process) and recovery still fires after the full stale window.
        touchSessionHeartbeat(input.toSessionId);
        const heartbeatPumpMs = Math.max(1_000, Math.floor(this.options.heartbeatStaleAfterMs / 3));
        const heartbeatPump = setInterval(() => {
          try {
            touchSessionHeartbeat(input.toSessionId);
          } catch {
            /* best-effort liveness ping */
          }
        }, heartbeatPumpMs);
        // Don't let the liveness pump keep the process alive on its own; it is
        // always cleared in `finally` when the run settles, but unref-ing keeps
        // it consistent with the watcher's other timers.
        heartbeatPump.unref?.();
        heartbeatPump.unref?.();
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
          const { completeHandoff } = await import('../store/handoff-store.js');
          const didComplete =
            input.handoff.toRoleLayer === 'pm2'
              ? false
              : completeHandoff({
                  handoffId: input.handoff.id,
                  claimToken: input.claimToken,
                });
          if (didComplete) {
            // 幻觉检测门禁 — handoff 完成后验证 agent 输出是否真实
            //（参考 hermes-agent v0.13.0）
            try {
              const { listSessionMessagesV2 } = await import(
                '../../message/message-v2-adapter.js'
              );
              const messages = listSessionMessagesV2({
                sessionId: input.toSessionId,
                userId: input.handoff.userId,
              });
              // 检查最后一条 assistant 消息是否为空或包含错误标志
              const lastAssistant = [...messages]
                .reverse()
                .find((m) => m.role === 'assistant');
              if (lastAssistant) {
                const issues: Array<{ type: string; detail: string }> = [];
                const content = lastAssistant.content;
                const hasText = content.some(
                  (c) => c.type === 'text' && c.text.trim().length > 0,
                );
                if (!hasText) {
                  issues.push({
                    type: 'empty_output',
                    detail: 'handoff 标记完成但最后一条 assistant 消息无文本内容',
                  });
                }
                // 检查是否包含错误标志但状态是 completed
                const hasErrorFlag = content.some(
                  (c) =>
                    c.type === 'text' &&
                    /^(error|failed|❌|⚠️.*fail)/i.test(c.text.trim()),
                );
                if (hasErrorFlag) {
                  issues.push({
                    type: 'output_mismatch',
                    detail: 'handoff 标记完成但输出包含错误标志',
                  });
                }
                if (issues.length > 0) {
                  publishHallucinationEvent({
                    userId: input.handoff.userId,
                    sessionId: input.toSessionId,
                    nodeId: input.handoff.id,
                    issues,
                  });
                }
              }
            } catch (hallucinationErr) {
              // 幻觉检测失败不影响 handoff 完成流程
              console.warn(
                `[watcher] 幻觉检测失败：${hallucinationErr instanceof Error ? hallucinationErr.message : String(hallucinationErr)}`,
              );
            }

            publishHandoffEvent({
              type: 'handoff.completed',
              record: {
                ...input.handoff,
                toSessionId: input.toSessionId,
                state: 'completed' as const,
              },
            });

            // 在 toSession 写入完成消息，确保各层级 session 有完整的对话记录。
            // executor/reviewer 走 stream 管线已有 assistant 消息，但缺少明确的
            // "任务完成"状态消息；pm1 的完成消息同样缺失。这里补上让前端 recovery
            // 能拉取到完整的生命周期记录。
            try {
              const { appendSessionMessageV2 } =
                await import('../../message/message-v2-adapter.js');
              const layerLabel = input.handoff.toRoleLayer;
              appendSessionMessageV2({
                sessionId: input.toSessionId,
                userId: input.handoff.userId,
                role: 'assistant',
                agentId: input.handoff.toRoleLayer,
                content: [
                  {
                    type: 'text',
                    text: `✅ ${layerLabel} 层任务已完成。`,
                  },
                ],
                clientRequestId: `handoff:${input.handoff.id}:completed`,
              });
            } catch (msgErr) {
              console.warn(
                `[watcher] 写 handoff 完成消息失败：${msgErr instanceof Error ? msgErr.message : String(msgErr)}`,
              );
            }
          }

          // ─── 五层架构自动链式派发 ─────────────────────────────────────
          // 当一层完成后，自动创建下一层的 handoff：
          //   pm1 完成 → 创建 pm1→pm2（d 层接管 dispatch）
          //   pm2 的 dispatch 由 pm2-runner 自己创建（d→e/f/g）
          //   executor/reviewer 完成 → 不再链式（终端层）
          if (input.handoff.toRoleLayer === 'pm1') {
            try {
              const { createHandoff } = await import('../store/handoff-store.js');
              const { sqliteGet } = await import('../../infra/db.js');

              // Fix #3: 验证 toSessionId 确实存在且属于同一用户，避免 FK 约束失败
              const sessionExists = sqliteGet<{ id: string }>(
                `SELECT id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1`,
                [input.toSessionId, input.handoff.userId],
              );
              if (!sessionExists) {
                console.warn(
                  `[watcher] auto-chain pm1→pm2 skipped: toSessionId ${input.toSessionId} not found for user`,
                );
                return;
              }

              // 读取 c 层 handoff 的 result_json（含 spec/plan/tasks artifact ids）
              const completedRow = sqliteGet<{ result_json: string | null }>(
                `SELECT result_json FROM handoff_records WHERE id = ? LIMIT 1`,
                [input.handoff.id],
              );
              let resultJson: Record<string, unknown> | null = null;
              if (completedRow?.result_json) {
                try {
                  resultJson = JSON.parse(completedRow.result_json) as Record<string, unknown>;
                } catch {
                  /* ignore */
                }
              }
              // 从原始 handoff payload 读 teamWorkspaceId
              const originalPayload = input.handoff.payload as Record<string, unknown> | null;
              const teamWorkspaceId =
                typeof originalPayload?.['teamWorkspaceId'] === 'string'
                  ? originalPayload['teamWorkspaceId']
                  : null;

              const nextHandoff = createHandoff({
                userId: input.handoff.userId,
                fromSessionId: input.toSessionId,
                fromRoleLayer: 'pm1',
                toRoleLayer: 'pm2',
                // 幂等键：以 pm1 handoff id 派生。auto-chain 可能因双 tick / 进程重启
                // 后的重放被触发多次；没有幂等键时每次都会新建一条 pm1→pm2，导致 pm2
                // 重复接管 + 重复 d→e/f/g 派发 + 重复 LLM 花费。createHandoff 命中已存在
                // 的 idempotencyKey 会直接返回原记录（不再 INSERT），天然去重。
                idempotencyKey: `auto-chain:pm1-pm2:${input.handoff.id}`,
                payload: {
                  resultJson,
                  teamWorkspaceId,
                  sourceIntent: originalPayload?.['sourceIntent'] ?? null,
                  rewrittenIntent: originalPayload?.['rewrittenIntent'] ?? null,
                },
              });
              publishHandoffEvent({ type: 'handoff.created', record: nextHandoff });

              // 向 pm1 session 写入转交消息，让 pm1 的对话历史记录任务已转交 PM2。
              try {
                const { appendSessionMessageV2 } =
                  await import('../../message/message-v2-adapter.js');
                appendSessionMessageV2({
                  sessionId: input.toSessionId,
                  userId: input.handoff.userId,
                  role: 'assistant',
                  agentId: 'cassandra',
                  content: [
                    {
                      type: 'text',
                      text: '📋 spec/plan/tasks 已生成，已转交 PM2（开发管控层）进行架构审查和任务派发。',
                    },
                  ],
                  clientRequestId: `handoff:${input.handoff.id}:auto-chain-pm2`,
                });

                // 如果 PM1 是质量反馈退回的重新规划，也向 reception session 写消息
                // 让用户在接待层对话流中看到"已修正并重新提交"的反馈。
                const isQualityFeedback = originalPayload?.['isQualityFeedback'] === true;
                if (isQualityFeedback) {
                  const receptionSessionId = sqliteGet<{ from_session_id: string }>(
                    `SELECT from_session_id FROM handoff_records
                     WHERE to_role_layer = 'pm1' AND to_session_id = ?
                     ORDER BY created_at DESC LIMIT 1`,
                    [input.toSessionId],
                  )?.from_session_id;
                  if (receptionSessionId) {
                    appendSessionMessageV2({
                      sessionId: receptionSessionId,
                      userId: input.handoff.userId,
                      role: 'assistant',
                      agentId: 'interaction-agent',
                      content: [
                        {
                          type: 'text',
                          text: '✅ PM1 已根据质量评审反馈完成重新规划，修正后的 spec/plan/tasks 已提交给 PM2 管控层。PM2 将重新进行架构审查和任务派发。',
                        },
                      ],
                      clientRequestId: `handoff:${input.handoff.id}:replan-submitted`,
                    });
                  }
                }
              } catch (msgErr) {
                console.warn(
                  `[watcher] 写 pm1→pm2 转交消息失败：${msgErr instanceof Error ? msgErr.message : String(msgErr)}`,
                );
              }
            } catch (err) {
              recordTeamRuntimeIncident({
                category: 'handoff_failure',
                code: 'handoff-auto-chain-pm1-pm2-failed',
                context: {
                  fromSessionId: input.toSessionId,
                  handoffId: input.handoff.id,
                },
                message: err instanceof Error ? err.message : String(err),
                severity: 'warning',
                timestamp: Date.now(),
                userId: input.handoff.userId,
              });
              console.warn(
                `[watcher] auto-chain pm1→pm2 failed: ${err instanceof Error ? err.message : String(err)}`,
              );
              // #10 reception→pm1 自动链断裂的用户侧反馈：当 pm1 层完成但
              // pm1→pm2 链式派发失败时，pm1 的产物（spec/plan/tasks）已落库，
              // 但 pm2 不会接管 → 用户在 reception 里看到 pm1 完成却无后续动作。
              // 写一条 assistant 消息到 reception session（input.handoff.fromSessionId
              // 即 reception session id）让用户明确知道链路断了，可以手动重试或调整。
              try {
                const { appendSessionMessageV2 } =
                  await import('../../message/message-v2-adapter.js');
                appendSessionMessageV2({
                  sessionId: input.handoff.fromSessionId,
                  userId: input.handoff.userId,
                  role: 'assistant',
                  agentId: 'prometheus',
                  content: [
                    {
                      type: 'text',
                      text: '团队规划已完成，但向开发管控层（pm2）的自动派发失败。spec/plan/tasks 已生成，请稍后重试或手动调整。',
                    },
                  ],
                  clientRequestId: null,
                });
              } catch (ackErr) {
                console.warn(
                  `[watcher] auto-chain failure ack write failed: ${ackErr instanceof Error ? ackErr.message : String(ackErr)}`,
                );
              }
            }
          }

          // ─── d.4 质量评审触发：executor/reviewer 全部完成后 ─────────────
          // 当一个 executor/reviewer handoff 完成时，检查同一 pm2 session
          // 下的所有子 handoff 是否都已完成。如果是，触发完整的双重 review
          // （spec review + quality review）并根据结果做失败分流。
          if (
            input.handoff.toRoleLayer === 'executor' ||
            input.handoff.toRoleLayer === 'reviewer'
          ) {
            // 向 pm2 session 写入子任务完成进度消息，让 pm2 的对话历史记录
            // 每个 executor/reviewer 的完成情况。
            try {
              const { appendSessionMessageV2 } =
                await import('../../message/message-v2-adapter.js');
              appendSessionMessageV2({
                sessionId: input.handoff.fromSessionId,
                userId: input.handoff.userId,
                role: 'assistant',
                agentId: 'zeus',
                content: [
                  {
                    type: 'text',
                    text: `📦 ${input.handoff.toRoleLayer} 子任务已完成（handoff: ${input.handoff.id.slice(0, 8)}）。`,
                  },
                ],
                clientRequestId: `handoff:${input.handoff.id}:executor-completed`,
              });
            } catch (msgErr) {
              console.warn(
                `[watcher] 写 executor/reviewer 完成进度到 pm2 失败：${msgErr instanceof Error ? msgErr.message : String(msgErr)}`,
              );
            }

            try {
              // 找到 pm2 session（即当前 handoff 的 from_session_id）
              const pm2SessionId = input.handoff.fromSessionId;

              // 找到 pm2 handoff（to_session_id = pm2SessionId）
              const pm2HandoffRow = sqliteGet<{ id: string }>(
                `SELECT id, payload_json, user_id FROM handoff_records
                 WHERE to_session_id = ? AND to_role_layer = 'pm2'
                 ORDER BY created_at DESC LIMIT 1`,
                [pm2SessionId],
              );
              if (!pm2HandoffRow) {
                // 找不到 pm2 handoff，跳过 review
                return;
              }
              await reconcilePm2QualityReview({
                pm2HandoffId: pm2HandoffRow.id,
                userId: input.handoff.userId,
              });
            } catch (err) {
              recordTeamRuntimeIncident({
                category: 'handoff_failure',
                code: 'handoff-quality-review-failed',
                context: {
                  handoffId: input.handoff.id,
                  toSessionId: input.handoff.fromSessionId,
                },
                message: err instanceof Error ? err.message : String(err),
                severity: 'warning',
                timestamp: Date.now(),
                userId: input.handoff.userId,
              });
              console.warn(
                `[watcher] d.4 quality review failed: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }
        } catch (err) {
          if (signal.aborted) return;
          const reason = err instanceof Error ? err.message : String(err);
          const didFail = failHandoff({
            handoffId: input.handoff.id,
            claimToken: input.claimToken,
            reason,
          });

          // PM1 部分失败降级：如果 PM1 的 artifact-chain 在 spec/plan 生成后、
          // tasks 生成前失败（LLM 网络错误、校验失败等），spec/plan 产物已经
          // 落库但 handoff 被标 failed → auto-chain 不会触发 → PM2 永远不执行。
          // 降级策略：检查 PM1 session 是否已有 spec/plan/tasks 产物，如果有
          // 至少 spec+plan，就仍然创建 pm1→pm2 handoff 让 PM2 尝试接管。
          if (didFail && input.handoff.toRoleLayer === 'pm1') {
            try {
              const { sqliteGet } = await import('../../infra/db.js');
              const artifactRow = sqliteGet<{ c: number }>(
                `SELECT COUNT(*) AS c FROM artifacts
                  WHERE session_id = ? AND phase IN ('spec', 'plan', 'tasks')`,
                [input.toSessionId],
              );
              const artifactCount = artifactRow?.c ?? 0;
              // 降级条件放宽：只要有 spec 或 plan 产物就降级。
              // 即使没有 tasks 产物，PM2 runner 也有从 plan 内容创建默认任务的降级逻辑。
              const hasAnyArtifact = artifactCount >= 1;
              if (hasAnyArtifact) {
                const { createHandoff } = await import('../store/handoff-store.js');
                const completedRow = sqliteGet<{ result_json: string | null }>(
                  `SELECT result_json FROM handoff_records WHERE id = ? LIMIT 1`,
                  [input.handoff.id],
                );
                let resultJson: Record<string, unknown> | null = null;
                if (completedRow?.result_json) {
                  try {
                    resultJson = JSON.parse(completedRow.result_json) as Record<string, unknown>;
                  } catch {
                    /* ignore */
                  }
                }
                // 如果 result_json 为空（PM1 在写 result_json 之前就失败了），
                // 从 artifacts 表直接读 spec/plan/tasks artifact id
                if (!resultJson) {
                  const specRow = sqliteGet<{ id: string }>(
                    `SELECT id FROM artifacts WHERE session_id = ? AND phase = 'spec' ORDER BY updated_at DESC LIMIT 1`,
                    [input.toSessionId],
                  );
                  const planRow = sqliteGet<{ id: string }>(
                    `SELECT id FROM artifacts WHERE session_id = ? AND phase = 'plan' ORDER BY updated_at DESC LIMIT 1`,
                    [input.toSessionId],
                  );
                  const tasksRow = sqliteGet<{ id: string }>(
                    `SELECT id FROM artifacts WHERE session_id = ? AND phase = 'tasks' ORDER BY updated_at DESC LIMIT 1`,
                    [input.toSessionId],
                  );
                  resultJson = {
                    ...(specRow?.id ? { specArtifactId: specRow.id } : {}),
                    ...(planRow?.id ? { planArtifactId: planRow.id } : {}),
                    ...(tasksRow?.id ? { tasksArtifactId: tasksRow.id } : {}),
                    degraded: true,
                    degradationReason: reason,
                  };
                }
                const originalPayload = input.handoff.payload as Record<string, unknown> | null;
                const teamWorkspaceId =
                  typeof originalPayload?.['teamWorkspaceId'] === 'string'
                    ? originalPayload['teamWorkspaceId']
                    : null;
                const nextHandoff = createHandoff({
                  userId: input.handoff.userId,
                  fromSessionId: input.toSessionId,
                  fromRoleLayer: 'pm1',
                  toRoleLayer: 'pm2',
                  idempotencyKey: `auto-chain-degraded:pm1-pm2:${input.handoff.id}`,
                  payload: {
                    resultJson,
                    teamWorkspaceId,
                    sourceIntent: originalPayload?.['sourceIntent'] ?? null,
                    rewrittenIntent: originalPayload?.['rewrittenIntent'] ?? null,
                    degraded: true,
                    degradationReason: reason,
                  },
                });
                publishHandoffEvent({ type: 'handoff.created', record: nextHandoff });
                console.warn(
                  `[watcher] PM1 失败但已有 ${artifactCount} 个产物，降级创建 pm1→pm2 handoff ${nextHandoff.id}（原因：${reason}）`,
                );
                // 写一条消息让用户知道 PM1 部分失败但 PM2 会尝试接管
                try {
                  const { appendSessionMessageV2 } =
                    await import('../../message/message-v2-adapter.js');
                  appendSessionMessageV2({
                    sessionId: input.toSessionId,
                    userId: input.handoff.userId,
                    role: 'assistant',
                    agentId: 'pm1',
                    content: [
                      {
                        type: 'text',
                        text: `⚠️ PM1 规划过程中遇到错误（${reason}），但已有 spec/plan 产物。已降级将任务转交给 PM2 管控层尝试继续。`,
                      },
                    ],
                    clientRequestId: `handoff:${input.handoff.id}:degraded-chain`,
                  });
                } catch {
                  /* best-effort */
                }
              }
            } catch (degradedErr) {
              console.warn(
                `[watcher] PM1 降级 auto-chain 失败：${degradedErr instanceof Error ? degradedErr.message : String(degradedErr)}`,
              );
            }
          }

          if (didFail) {
            recordTeamRuntimeIncident({
              category: 'handoff_failure',
              code: 'handoff-runner-failed',
              context: {
                handoffId: input.handoff.id,
                toRoleLayer: input.handoff.toRoleLayer,
                toSessionId: input.toSessionId,
              },
              message: reason,
              severity: 'error',
              timestamp: Date.now(),
              userId: input.handoff.userId,
            });
            // 同步把 to_session 的 substate 推到 'failed'，让前端进度条立刻反映终态
            // （避免界面停留在 drafting_plan / dispatching 等中间态）
            try {
              const { setSubstate } = await import('../store/substate-store.js');
              setSubstate({
                sessionId: input.toSessionId,
                substate: 'failed',
                userId: input.handoff.userId,
                roleLayer: input.handoff.toRoleLayer,
              });
            } catch (e) {
              console.warn(
                `[watcher] setSubstate('failed') 失败：${e instanceof Error ? e.message : String(e)}`,
              );
            }

            // executor/reviewer 失败后主动触发 PM2 quality review 检查：
            // 子任务虽然失败了（不是 completed），但已进入终态，PM2 应该能感知到
            // 并决定重试、改派或回退。不等 reconcilePendingPm2QualityReviews 被动扫描。
            if (
              input.handoff.toRoleLayer === 'executor' ||
              input.handoff.toRoleLayer === 'reviewer'
            ) {
              try {
                const pm2SessionId = input.handoff.fromSessionId;
                const pm2HandoffRow = sqliteGet<{ id: string }>(
                  `SELECT id FROM handoff_records
                    WHERE to_session_id = ? AND to_role_layer = 'pm2'
                      AND state = 'running'
                    ORDER BY created_at DESC LIMIT 1`,
                  [pm2SessionId],
                );
                if (pm2HandoffRow) {
                  await reconcilePm2QualityReview({
                    pm2HandoffId: pm2HandoffRow.id,
                    userId: input.handoff.userId,
                    force: true,
                  });
                }
              } catch (reviewErr) {
                console.warn(
                  `[watcher] executor/reviewer 失败后触发 quality review 失败：${reviewErr instanceof Error ? reviewErr.message : String(reviewErr)}`,
                );
              }
            }

            publishHandoffEvent({
              type: 'handoff.failed',
              record: {
                ...input.handoff,
                toSessionId: input.toSessionId,
                state: 'failed' as const,
                failureReason: reason,
              },
              payload: { reason },
            });

            // 在 toSession 写入失败消息，让前端 recovery 能拉取到失败原因，
            // 而不是只能看到 substate=failed 却不知道为什么。
            try {
              const { appendSessionMessageV2 } =
                await import('../../message/message-v2-adapter.js');
              const isPm2 = input.handoff.toRoleLayer === 'pm2';
              const retryHint = isPm2
                ? '\n\n💡 请前往「任务 / 评审」tab 查看详情，可选择「重派 e/f/g」重新执行或「退回 PM1」重新规划。'
                : '';
              appendSessionMessageV2({
                sessionId: input.toSessionId,
                userId: input.handoff.userId,
                role: 'assistant',
                agentId: input.handoff.toRoleLayer,
                content: [
                  {
                    type: 'text',
                    text: `❌ ${input.handoff.toRoleLayer} 层任务执行失败：${reason}${retryHint}`,
                  },
                ],
                clientRequestId: `handoff:${input.handoff.id}:failed`,
              });
            } catch (msgErr) {
              console.warn(
                `[watcher] 写 handoff 失败消息失败：${msgErr instanceof Error ? msgErr.message : String(msgErr)}`,
              );
            }
          }
          throw err;
        } finally {
          clearInterval(heartbeatPump);
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
