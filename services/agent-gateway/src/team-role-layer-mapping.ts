/**
 * 260515-team-phase-a · T-06 辅助
 *
 * 把当前 round 的 agent 映射到 5 层 SOUL（role_layer）。
 *
 * 现状：OpenAWork 已有的「core role」概念是 leader/planner/researcher/executor/reviewer，
 * 由 agent metadata 中的 `agentId` 携带。Phase A 的 5 层 SOUL 与之并不完全对齐：
 *
 *   - reception → 接待层，对应 "interaction-agent" / "leader"（聊天入口角色）
 *   - pm1       → 任务规划层，对应 "planner"（拆任务）
 *   - pm2       → 开发管控层，对应 "researcher"（研究 / 调度）+ team-leader 派发
 *   - executor  → 执行层，对应 "executor"
 *   - reviewer  → 评审层，对应 "reviewer"
 *
 * 本映射 *保守*：找不到匹配时返回 null，调用方就跳过 SOUL 注入；
 * 永远不会"猜"。这样可以避免给非团队场景注入不相关的角色 SOUL。
 */

import type { SoulRoleLayer } from './team-phase-a-content/index.js';

const AGENT_ID_TO_ROLE_LAYER: ReadonlyMap<string, SoulRoleLayer> = new Map<string, SoulRoleLayer>([
  // 接待层
  ['interaction-agent', 'reception'],
  ['interaction', 'reception'],
  ['reception', 'reception'],

  // PM1（任务规划）
  ['planner', 'pm1'],
  ['team-planner', 'pm1'],
  ['pm1', 'pm1'],

  // PM2（开发管控 / hermes 与 spec-kit 桥接）
  ['team-leader', 'pm2'],
  ['researcher', 'pm2'],
  ['leader', 'pm2'],
  ['pm2', 'pm2'],

  // 执行层
  ['executor', 'executor'],
  ['team-executor', 'executor'],

  // 评审层
  ['reviewer', 'reviewer'],
  ['team-reviewer', 'reviewer'],
]);

export function mapAgentToTeamRoleLayer(agentId: string | null | undefined): SoulRoleLayer | null {
  if (!agentId) return null;
  return AGENT_ID_TO_ROLE_LAYER.get(agentId) ?? null;
}
