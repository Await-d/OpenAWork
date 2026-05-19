/**
 * 260518-team-l1.3 改造 2 · sessions.substate 数据访问层
 *
 * 关联文档：
 *   - docs/team-architecture-l1-3-streaming-handoff-spec.md §1.2
 *   - docs/team-architecture-l1-baseline.md L1.3
 *
 * 设计要点：
 *   1. **原子 UPDATE**：substate 与 substate_updated_at 同事务写入，保证下游订阅者
 *      看到的子状态与时间戳一致（不变量 I2 简化版）。
 *   2. **不强制流转规则**：本模块只做存写入，转移规则由上层 runner（artifact-chain
 *      / pm2-runner）保证。
 *   3. **事件总线**：每次 setSubstate 后发布 'session.substate.changed' team event，
 *      让前端订阅 substate 流式变化（前端的 TeamSubstateProgressBar 已在用）。
 */

import { sqliteGet, sqliteRun } from '../../db.js';
import { publishTeamEvent } from '../bus/team-events-bus.js';
import { assertSubstateAllowed } from '../capability/layer-capabilities.js';
import type { HandoffRoleLayer } from './handoff-store.js';

export const SUBSTATES_C = {
  IDLE: 'idle',
  DRAFTING_SPEC: 'drafting_spec',
  SPEC_READY: 'spec_ready',
  CLARIFYING: 'clarifying',
  DRAFTING_PLAN: 'drafting_plan',
  PLAN_READY: 'plan_ready',
  DRAFTING_TASKS: 'drafting_tasks',
  TASKS_READY: 'tasks_ready',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

export const SUBSTATES_D = {
  IDLE: 'idle',
  CONSTITUTION_CHECK: 'constitution_check',
  ARCHITECTURE_REVIEW: 'architecture_review',
  DISPATCHING: 'dispatching',
  AWAITING_EG: 'awaiting_eg',
  REVIEWING: 'reviewing',
  ESCALATING: 'escalating',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

export const SUBSTATES_RECEPTION = {
  IDLE: 'idle',
  CHATTING: 'chatting',
  ROUTING: 'routing',
  DISPATCHING: 'dispatching',
  AWAITING_DOWNSTREAM: 'awaiting_downstream',
} as const;

export type SubstateValue = string;

export interface SetSubstateInput {
  sessionId: string;
  /** null 表示清空（回到无 substate 状态）。 */
  substate: SubstateValue | null;
  /** 用于事件总线 publish；非必传。 */
  userId?: string;
  /** 用于事件总线 publish；非必传（reception/pm1/pm2/...）。 */
  roleLayer?: string;
}

/**
 * 原子 UPDATE substate + substate_updated_at，并广播 team event。
 *
 * 调用方应在每个有意义的子状态边界调用一次（如 drafting_spec → spec_ready）。
 *
 * L1.4 Guard #3：检查 substate 是否在该 roleLayer 白名单内。
 * 违反 → 抛 LayerCapabilityViolationError + audit log。
 */
export function setSubstate(input: SetSubstateInput): void {
  // L1.4 Guard #3: 检查 substate 是否在该层白名单中（roleLayer 已知时强制）
  assertSubstateAllowed({
    roleLayer: input.roleLayer as HandoffRoleLayer | undefined,
    substate: input.substate,
    ...(input.userId !== undefined ? { userId: input.userId } : {}),
    sessionId: input.sessionId,
  });

  sqliteRun(
    `UPDATE sessions
       SET substate = ?,
           substate_updated_at = datetime('now'),
           updated_at = datetime('now')
     WHERE id = ?`,
    [input.substate, input.sessionId],
  );

  // 广播 team event，前端 TeamSubstateProgressBar / Push notifications 用
  if (input.userId) {
    publishTeamEvent({
      type: 'session.substate.changed',
      sessionId: input.sessionId,
      taskId: input.sessionId, // event 总线要求带 taskId，这里用 sessionId 兜底
      layer: (input.roleLayer ?? 'unknown') as never,
      timestamp: Date.now(),
      userId: input.userId,
      payload: { substate: input.substate },
    });
  }
}

/**
 * 读取 session 当前 substate 及最近更新时间。
 * 主要用于 inbound 循环中"等待 substate 变更"的检查（避免时序竞态）。
 */
export function getSubstate(
  sessionId: string,
): { substate: string | null; updatedAt: string | null } | null {
  const row = sqliteGet<{ substate: string | null; substate_updated_at: string | null }>(
    `SELECT substate, substate_updated_at FROM sessions WHERE id = ? LIMIT 1`,
    [sessionId],
  );
  if (!row) return null;
  return {
    substate: row.substate,
    updatedAt: row.substate_updated_at,
  };
}
