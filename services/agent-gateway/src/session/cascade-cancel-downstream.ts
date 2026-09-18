/**
 * cascade-cancel-downstream — 级联取消某个 session 子树下的所有未终止 handoff。
 *
 * 单条 `cancelHandoff` 只翻自身状态；本函数沿 `team_parent_session_id` 递归取消整棵
 * 下游子树（复用 `cancelTeamRuntimeTree`），并对每个下游 session：
 *   1. 注入 cancel_signal（team-stream-control gate 在下个 round 边界中止执行）。
 *   2. stopAllInFlightStreamRequestsForSession 立即 abort 正在跑的 LLM 流。
 *   3. setSubstate('cancelled') 让前端进度条立刻反映终态。
 *
 * 全程 best-effort：单个 session 的信号注入 / 停流失败不阻塞其余 session。
 *
 * 原为 `routes/team-handoffs.ts` 的模块私有函数；回合回退编排器
 * （`session/session-turn-rollback.ts`）也需要它，故迁到 `session/` 共享模块，
 * 避免 `session/` 反向依赖 `routes/`（计划 Phase 2.3a）。
 */

import { cancelTeamRuntimeTree } from '../team/team-runtime-control-store.js';
import { getHandoff } from '../handoff/store/handoff-store.js';
import { submitInboundMessage } from '../handoff/store/inbound-store.js';
import { setSubstate } from '../handoff/store/substate-store.js';
import { publishHandoffEvent } from '../handoff/bus/team-events-bus.js';
import { logTeamAudit } from '../team/team-audit-store.js';
import { stopAllInFlightStreamRequestsForSession } from '../routes/stream-cancellation.js';

export async function cascadeCancelDownstream(input: {
  rootSessionId: string;
  userId: string;
  excludeHandoffId?: string;
  /** 触发本次级联取消的回合键（调用方可知时传入）；缺失落 NULL。 */
  clientRequestId?: string | null;
}): Promise<void> {
  const result = cancelTeamRuntimeTree({
    rootSessionId: input.rootSessionId,
    userId: input.userId,
  });
  if (!result) return;

  // 对子树里每个 session 停流 + 置 substate。treeSessionIds 含 root 自身与所有后代。
  for (const sessionId of result.treeSessionIds) {
    try {
      submitInboundMessage({
        userId: input.userId,
        toSessionId: sessionId,
        fromRoleLayer: 'system',
        messageType: 'cancel_signal',
        payload: { reason: 'cascade-cancel', rootSessionId: input.rootSessionId },
      });
    } catch (err) {
      console.warn(
        `[cascade-cancel] cascade cancel_signal 注入失败（${sessionId}）：${err instanceof Error ? err.message : String(err)}`,
      );
    }
    try {
      await stopAllInFlightStreamRequestsForSession({ sessionId, userId: input.userId });
    } catch (err) {
      console.warn(
        `[cascade-cancel] cascade 停流失败（${sessionId}）：${err instanceof Error ? err.message : String(err)}`,
      );
    }
    try {
      setSubstate({ sessionId, substate: 'cancelled', userId: input.userId });
    } catch (err) {
      console.warn(
        `[cascade-cancel] cascade setSubstate('cancelled') 失败（${sessionId}）：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  for (const cancelledHandoffId of result.cancelledHandoffIds) {
    if (cancelledHandoffId === input.excludeHandoffId) continue;
    const record = getHandoff({ userId: input.userId, handoffId: cancelledHandoffId });
    if (record) {
      publishHandoffEvent({ type: 'handoff.cancelled', record });
    }
  }

  // 审计：记录级联取消的范围（根 session、波及 session 数、取消 handoff 数），
  // 便于事后排查「取消了什么」。best-effort，不阻塞。
  try {
    logTeamAudit({
      action: 'handoff_control',
      actorUserId: input.userId,
      clientRequestId: input.clientRequestId ?? null,
      detail: JSON.stringify({
        action: 'cascade-cancel',
        rootSessionId: input.rootSessionId,
        excludeHandoffId: input.excludeHandoffId ?? null,
        treeSessionCount: result.treeSessionIds.length,
        cascadeCancelledHandoffIds: result.cancelledHandoffIds,
      }),
      entityId: input.rootSessionId,
      entityType: 'session',
      sessionId: input.rootSessionId,
      summary: `cascade cancel: root=${input.rootSessionId.slice(0, 8)} sessions=${result.treeSessionIds.length} handoffs=${result.cancelledHandoffIds.length}`,
      userId: input.userId,
    });
  } catch (err) {
    console.warn(
      `[cascade-cancel] cascade 审计日志写入失败（不阻塞）：${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
