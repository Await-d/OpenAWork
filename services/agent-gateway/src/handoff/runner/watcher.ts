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
import {
  claimHandoff,
  failHandoff,
  listPendingHandoffs,
  reclaimAbandonedHandoffs,
  startHandoff,
  type HandoffRecord,
} from '../store/handoff-store.js';
import { findStaleHeartbeatCutoffIso, HEARTBEAT_STALE_AFTER_MS } from '../bus/heartbeat.js';
import { getBackgroundTaskScheduler, type BackgroundTaskScheduler } from './scheduler.js';
import { publishHandoffEvent } from '../bus/team-events-bus.js';
import { createTeamSession } from '../bus/team-session-create.js';

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
      for (const id of reclaimedIds) {
        const record = getHandoffById(id);
        if (record) {
          publishHandoffEvent({ type: 'handoff.reclaimed', record });
        }
      }
      for (const id of failedIds) {
        const record = getHandoffById(id);
        if (record) {
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
      }
    }
    return { recovered: reclaimedIds.length, failed: failedIds.length };
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
          const { completeHandoff } = await import('../store/handoff-store.js');
          const didComplete = completeHandoff({
            handoffId: input.handoff.id,
            claimToken: input.claimToken,
          });
          if (didComplete) {
            publishHandoffEvent({
              type: 'handoff.completed',
              record: { ...input.handoff, toSessionId: input.toSessionId, state: 'completed' as const },
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
              const { sqliteGet } = await import('../../db.js');

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
                } catch { /* ignore */ }
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
              const { sqliteAll, sqliteGet } = await import('../../db.js');
              const { appendSessionMessageV2 } = await import('../../message/message-v2-adapter.js');
              const { setSubstate } = await import('../store/substate-store.js');
              const { resolveAuxiliaryLlmConfig } = await import('../../provider/auxiliary-llm-config.js');
              const { runReviewAggregation, checkAllChildrenCompleted, determineFailureDisposition } =
                await import('../workflow/review-aggregator.js');
              const { getTeamConstitution } = await import('../../team/team-constitution-store.js');

              // 找到 pm2 session（即当前 handoff 的 from_session_id）
              const pm2SessionId = input.handoff.fromSessionId;

              // 找到 pm2 handoff（to_session_id = pm2SessionId）
              const pm2HandoffRow = sqliteGet<{ id: string; payload_json: string; user_id: string }>(
                `SELECT id, payload_json, user_id FROM handoff_records
                 WHERE to_session_id = ? AND to_role_layer = 'pm2'
                 ORDER BY created_at DESC LIMIT 1`,
                [pm2SessionId],
              );
              if (!pm2HandoffRow) {
                // 找不到 pm2 handoff，跳过 review
                return;
              }

              const { allDone, children } = checkAllChildrenCompleted(pm2HandoffRow.id);
              if (!allDone) {
                // 还有子 handoff 未完成，等下一个完成时再检查
                return;
              }

              // 所有子 handoff 都完成了 → 触发 d.4 review
              setSubstate({
                sessionId: pm2SessionId,
                substate: 'reviewing',
                userId: input.handoff.userId,
                roleLayer: 'pm2',
              });

              // 读取 spec 内容（从 pm2 handoff payload 中的 resultJson.specArtifactId）
              let specContent = '';
              let constitutionBody = '';
              try {
                const pm2Payload = JSON.parse(pm2HandoffRow.payload_json || '{}') as Record<string, unknown>;
                const resultJson = pm2Payload['resultJson'] as Record<string, unknown> | null;
                const specArtifactId = resultJson?.['specArtifactId'] as string | null;
                const teamWorkspaceId = (pm2Payload['teamWorkspaceId'] as string) ?? null;

                if (specArtifactId) {
                  const specRow = sqliteGet<{ content: string }>(
                    `SELECT content FROM artifacts WHERE id = ?`,
                    [specArtifactId],
                  );
                  specContent = specRow?.content ?? '';
                }

                if (teamWorkspaceId) {
                  const constitution = getTeamConstitution({
                    userId: input.handoff.userId,
                    teamWorkspaceId,
                  });
                  constitutionBody = constitution?.body ?? '';
                }
              } catch {
                // 读取失败不阻断 review
              }

              // 尝试获取 LLM 配置来跑完整 review
              const llmConfig = await resolveAuxiliaryLlmConfig(input.handoff.userId);
              if (llmConfig) {
                const { requestWorkflowLlmCompletion } = await import('../../routes/workflow-llm.js');
                const callLlm = async (system: string, user: string): Promise<string> => {
                  return requestWorkflowLlmCompletion({
                    apiBaseUrl: llmConfig.apiBaseUrl,
                    apiKey: llmConfig.apiKey,
                    model: llmConfig.model,
                    ...(llmConfig.providerType ? { providerType: llmConfig.providerType } : {}),
                    ...(llmConfig.upstreamProtocol ? { upstreamProtocol: llmConfig.upstreamProtocol } : {}),
                    prompt: `${system}\n\n---\n\n${user}`,
                    temperature: 0.1,
                  });
                };

                const report = await runReviewAggregation({
                  userId: input.handoff.userId,
                  pm2HandoffId: pm2HandoffRow.id,
                  pm2SessionId,
                  childHandoffs: children,
                  specContent,
                  constitutionBody,
                  callLlm,
                });

                // 写 review report 到 pm2 session 消息流
                appendSessionMessageV2({
                  sessionId: pm2SessionId,
                  userId: input.handoff.userId,
                  role: 'assistant',
                  content: [{ type: 'text', text: report.reportMarkdown }],
                });

                if (report.overallVerdict === 'pass') {
                  // 评审通过 → pm2 完成
                  setSubstate({
                    sessionId: pm2SessionId,
                    substate: 'completed',
                    userId: input.handoff.userId,
                    roleLayer: 'pm2',
                  });
                } else {
                  // 评审未通过 → 失败分流
                  const escalationRound = (() => {
                    const row = sqliteGet<{ retry_count: number }>(
                      `SELECT retry_count FROM handoff_records WHERE id = ?`,
                      [pm2HandoffRow.id],
                    );
                    return row?.retry_count ?? 0;
                  })();

                  const disposition = determineFailureDisposition({
                    report,
                    escalationRound,
                  });

                  if (disposition.action === 'redispatch') {
                    // 实现型失败 → 重新派发给 e/f/g
                    setSubstate({
                      sessionId: pm2SessionId,
                      substate: 'dispatching',
                      userId: input.handoff.userId,
                      roleLayer: 'pm2',
                    });
                    appendSessionMessageV2({
                      sessionId: pm2SessionId,
                      userId: input.handoff.userId,
                      role: 'assistant',
                      content: [{ type: 'text', text: `⚠️ 实现型失败，准备重新派发。原因：${disposition.reason}` }],
                    });
                    // 注：实际重新派发需要重新调 pm2-runner 的 dispatch 逻辑。
                    // 当前通过 retry_count+1 + 退回 pending 让 watcher 重新 claim 来实现。
                    const { sqliteRun: dbRun } = await import('../../db.js');
                    dbRun(
                      `UPDATE handoff_records
                         SET state = 'pending', claim_token = NULL, claimed_at = NULL,
                             started_at = NULL, retry_count = retry_count + 1,
                             updated_at = datetime('now')
                       WHERE id = ? AND state = 'running'`,
                      [pm2HandoffRow.id],
                    );
                  } else if (disposition.action === 'return-to-c') {
                    // 规划型失败 → 退回 c 层
                    setSubstate({
                      sessionId: pm2SessionId,
                      substate: 'escalating',
                      userId: input.handoff.userId,
                      roleLayer: 'pm2',
                    });
                    appendSessionMessageV2({
                      sessionId: pm2SessionId,
                      userId: input.handoff.userId,
                      role: 'assistant',
                      content: [{ type: 'text', text: `⚠️ 规划型失败，退回 PM1 重新规划。原因：${disposition.reason}` }],
                    });
                    // 通知 reception 层（通过 inbound escalation_request）
                    const { submitInboundMessage } = await import('../store/inbound-store.js');
                    // 找到 reception session（pm2 的上游链路）
                    const receptionSession = sqliteGet<{ from_session_id: string }>(
                      `SELECT from_session_id FROM handoff_records
                       WHERE to_role_layer = 'pm1' AND to_session_id = (
                         SELECT from_session_id FROM handoff_records WHERE id = ?
                       ) LIMIT 1`,
                      [pm2HandoffRow.id],
                    );
                    if (receptionSession) {
                      submitInboundMessage({
                        userId: input.handoff.userId,
                        toSessionId: receptionSession.from_session_id,
                        fromRoleLayer: 'pm2',
                        messageType: 'escalation_request',
                        payload: {
                          reason: disposition.reason,
                          source: 'quality-review',
                          pm2HandoffId: pm2HandoffRow.id,
                        },
                      });
                    }
                    setSubstate({
                      sessionId: pm2SessionId,
                      substate: 'failed',
                      userId: input.handoff.userId,
                      roleLayer: 'pm2',
                    });
                  } else {
                    // escalate-to-user → 标记失败，通知用户
                    setSubstate({
                      sessionId: pm2SessionId,
                      substate: 'failed',
                      userId: input.handoff.userId,
                      roleLayer: 'pm2',
                    });
                    appendSessionMessageV2({
                      sessionId: pm2SessionId,
                      userId: input.handoff.userId,
                      role: 'assistant',
                      content: [{ type: 'text', text: `🔴 多次重试仍未通过评审，需要用户介入。原因：${disposition.reason}` }],
                    });
                    // 通知 reception
                    const { submitInboundMessage } = await import('../store/inbound-store.js');
                    const receptionSession = sqliteGet<{ from_session_id: string }>(
                      `SELECT from_session_id FROM handoff_records
                       WHERE to_role_layer = 'pm1' AND to_session_id = (
                         SELECT from_session_id FROM handoff_records WHERE id = ?
                       ) LIMIT 1`,
                      [pm2HandoffRow.id],
                    );
                    if (receptionSession) {
                      submitInboundMessage({
                        userId: input.handoff.userId,
                        toSessionId: receptionSession.from_session_id,
                        fromRoleLayer: 'pm2',
                        messageType: 'escalation_request',
                        payload: {
                          reason: disposition.reason,
                          source: 'quality-review-escalation',
                          pm2HandoffId: pm2HandoffRow.id,
                          escalationRound,
                        },
                      });
                    }
                  }
                }
              } else {
                // 没有 LLM 配置 → 降级为简单统计 summary（与之前行为一致）
                const siblings = sqliteAll<{ state: string }>(
                  `SELECT state FROM handoff_records
                   WHERE from_session_id = ? AND to_role_layer IN ('executor', 'reviewer')`,
                  [pm2SessionId],
                );
                const completed = siblings.filter((s) => s.state === 'completed').length;
                const failed = siblings.filter((s) => s.state === 'failed').length;
                const summary = [
                  `## 质量评审总结（d.4 降级模式）`,
                  '',
                  `所有执行层任务已完成（无 LLM 配置，跳过 spec/quality review）：`,
                  `- ✅ 成功：${completed}`,
                  `- ❌ 失败：${failed}`,
                ].join('\n');
                appendSessionMessageV2({
                  sessionId: pm2SessionId,
                  userId: input.handoff.userId,
                  role: 'assistant',
                  content: [{ type: 'text', text: summary }],
                });
                setSubstate({
                  sessionId: pm2SessionId,
                  substate: failed > 0 ? 'failed' : 'completed',
                  userId: input.handoff.userId,
                  roleLayer: 'pm2',
                });
              }
            } catch (err) {
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
