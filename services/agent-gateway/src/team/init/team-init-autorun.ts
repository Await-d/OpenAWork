/**
 * team-init-autorun · 任务对话前的「自动初始化前置」
 *
 * 背景：用户可能不点弹窗里的「执行」，直接在接待会话里提任务。此前的行为是把
 * 未完成的 teamInit 直接标记为 skipped——团队等于没了解项目就开工，不周全。
 *
 * 本模块提供 `ensureTeamInitBeforeTask`：在 reception 编排真正派发任务前调用，
 * 自动把所有还处于 `proposed` 的初始化步骤跑完（复用 team-init-runner 的单步执行 +
 * 其内置的并发保护），再让编排带着初始化产物（架构摘要 / 项目记忆）继续。
 *
 * 设计约束：
 *   - best-effort：单步失败不抛错、不阻塞后续任务（失败步骤标 failed，记录但继续）。
 *   - 幂等 + 并发安全：runTeamInitStep 自带 in-flight guard；这里再加一层 session 级
 *     in-flight 防止「用户手动点执行」与「自动 run」同时跑同一会话。
 *   - 仅跑 proposed 步骤：用户已手动 done / skipped 的步骤保持原状，不重复执行。
 *   - 跑完后把 phase 推进到 completed（若还有 proposed 被中途加入则由 deriveTeamInitPhase
 *     自然处理）。
 */

import {
  TEAM_INIT_STEP_ORDER,
  type TeamInitState,
  type TeamInitStepKey,
} from '@openAwork/shared';
import { loadTeamInitSessionContext } from './team-init-store.js';
import { runTeamInitStep } from './team-init-runner.js';
import { publishTeamEvent } from '../../handoff/bus/team-events-bus.js';

export interface EnsureTeamInitResult {
  /** 是否实际执行了至少一步初始化。 */
  ran: boolean;
  /** 自动执行过的步骤 key。 */
  executedSteps: TeamInitStepKey[];
  /** 执行后失败的步骤 key。 */
  failedSteps: TeamInitStepKey[];
  /** 最终的 teamInit 状态（可为 null：会话无初始化清单）。 */
  state: TeamInitState | null;
  /** 跳过原因（无清单 / 已完成 / 已跳过 / 并发中）。 */
  reason?: string;
}

// session 级 in-flight guard：避免自动 run 与用户手动点执行 / 重复请求并发跑同一会话。
const inFlightAutoInit = new Set<string>();

function autoInitKey(userId: string, sessionId: string): string {
  return `${userId}::${sessionId}`;
}

/**
 * 在任务编排前确保初始化完成。
 *
 * @returns EnsureTeamInitResult — 调用方据此决定是否把产物注入编排 context。
 */
export async function ensureTeamInitBeforeTask(input: {
  sessionId: string;
  userId: string;
}): Promise<EnsureTeamInitResult> {
  const ctx = loadTeamInitSessionContext(input.sessionId, input.userId);
  if (!ctx?.teamInit) {
    return { ran: false, executedSteps: [], failedSteps: [], state: null, reason: 'no-plan' };
  }

  // 已结束（用户手动跑完 / 显式跳过）→ 不再自动跑，尊重用户选择。
  if (ctx.teamInit.phase === 'completed' || ctx.teamInit.phase === 'skipped') {
    return {
      ran: false,
      executedSteps: [],
      failedSteps: [],
      state: ctx.teamInit,
      reason: ctx.teamInit.phase,
    };
  }

  const guardKey = autoInitKey(input.userId, input.sessionId);
  if (inFlightAutoInit.has(guardKey)) {
    return {
      ran: false,
      executedSteps: [],
      failedSteps: [],
      state: ctx.teamInit,
      reason: 'already-running',
    };
  }
  inFlightAutoInit.add(guardKey);

  const executedSteps: TeamInitStepKey[] = [];
  const failedSteps: TeamInitStepKey[] = [];
  let latestState: TeamInitState | null = ctx.teamInit;

  try {
    // 按标准顺序执行所有 proposed 步骤。每轮都重新读最新状态，避免基于陈旧快照。
    for (const stepKey of TEAM_INIT_STEP_ORDER) {
      const fresh = loadTeamInitSessionContext(input.sessionId, input.userId);
      if (!fresh?.teamInit) break;
      latestState = fresh.teamInit;
      const step = fresh.teamInit.steps.find((s) => s.key === stepKey);
      if (!step || step.status !== 'proposed') {
        continue;
      }
      const result = await runTeamInitStep({
        sessionId: input.sessionId,
        userId: input.userId,
        stepKey,
      });
      if (result.state) latestState = result.state;
      executedSteps.push(stepKey);
      if (!result.ok) {
        failedSteps.push(stepKey);
        // best-effort：失败不阻塞后续步骤与任务派发。
      }
    }
  } finally {
    inFlightAutoInit.delete(guardKey);
  }

  // 自动初始化跑过任意步骤后，通知前端刷新（弹窗 / 横幅据此更新进度 / 收起）。
  if (executedSteps.length > 0) {
    try {
      publishTeamEvent({
        type: 'session.init.changed',
        sessionId: input.sessionId,
        layer: 'reception',
        timestamp: Date.now(),
        payload: { source: 'auto-run', executed: executedSteps, failed: failedSteps },
        userId: input.userId,
      });
    } catch (err) {
      console.warn(
        `[team-init-autorun] publish init.changed failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return {
    ran: executedSteps.length > 0,
    executedSteps,
    failedSteps,
    state: latestState,
  };
}

/**
 * 从最终的 teamInit 状态构建编排上下文文本（架构摘要 + 项目记忆要点）。
 * 与 inbound 路由里原本的拼接逻辑一致，抽出来供 autorun 后复用。
 */
export function buildInitContextFromState(state: TeamInitState | null): string | null {
  if (!state) return null;
  const summary = state.bindings.architectureSummary;
  const digest = state.bindings.projectMemoryDigest;
  const parts: string[] = [];
  if (typeof summary === 'string' && summary.trim()) {
    parts.push(`项目架构摘要：\n${summary.trim()}`);
  }
  if (typeof digest === 'string' && digest.trim()) {
    parts.push(`项目记忆要点：\n${digest.trim()}`);
  }
  return parts.length > 0 ? parts.join('\n\n') : null;
}
