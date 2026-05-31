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
import { sqliteAll, sqliteGet } from '../../infra/db.js';
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
import { publishHandoffEvent } from '../bus/team-events-bus.js';
import { recordTeamRuntimeIncident } from '../../team/team-runtime-diagnostics-store.js';
import { createTeamSession } from '../bus/team-session-create.js';
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
          let childMetadataJson = mergeMemberModelIntoMetadata(undefined, memberModel);
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
          const assignedPersonaKey =
            record.payload &&
            typeof record.payload === 'object' &&
            !Array.isArray(record.payload) &&
            typeof (record.payload as Record<string, unknown>)['assignedMember'] === 'object'
              ? (
                  (record.payload as Record<string, unknown>)['assignedMember'] as Record<
                    string,
                    unknown
                  >
                )['personaKey']
              : undefined;
          const rosterManifest = buildTeamRosterManifest({
            fromSessionId: record.fromSessionId,
            currentLayer: record.toRoleLayer,
            ...(typeof assignedPersonaKey === 'string'
              ? { currentPersonaKey: assignedPersonaKey }
              : {}),
          });
          childMetadataJson = mergeTeamRosterManifestIntoMetadata(
            childMetadataJson,
            rosterManifest,
          );
          const { sessionId: toSessionId } = createTeamSession({
            userId: record.userId,
            roleLayer: record.toRoleLayer,
            teamParentSessionId: record.fromSessionId,
            handoffState: 'running',
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
    const { reclaimedIds, failedIds } = reclaimAbandonedHandoffs({
      staleHeartbeatBeforeIso: cutoff,
      maxRetry: this.options.maxRetry,
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
            publishHandoffEvent({
              type: 'handoff.completed',
              record: {
                ...input.handoff,
                toSessionId: input.toSessionId,
                state: 'completed' as const,
              },
            });
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
                payload: {
                  resultJson,
                  teamWorkspaceId,
                  sourceIntent: originalPayload?.['sourceIntent'] ?? null,
                  rewrittenIntent: originalPayload?.['rewrittenIntent'] ?? null,
                },
              });
              publishHandoffEvent({ type: 'handoff.created', record: nextHandoff });
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
