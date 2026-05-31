/**
 * 260530-team-page · Wave 5 · use-office-layer-binding（F4 3D 与层级联动）
 *
 * 把 useHandoffStore / useLayerStore 的**真实**层级运行状态映射为 3D 办公室
 * agent 的 working / discussing / resting 状态，替换原先纯角色映射的 mock 状态。
 *
 * 设计（低风险）：
 *   - 不改 OfficeThreeCanvas 的走位 / 动画系统，只替换它消费的 `officeAgents`
 *     的 status 来源。状态变化后既有 waypoint 系统会自动让 agent 在
 *     work/discuss/rest 区之间走动——这就是"联动"。
 *   - 4 个角色槽位（leader/researcher/executor/critic）按索引近似映射到 5 层。
 *   - feature flag：localStorage['teamV2.office.liveBinding']='0' 可回退到原 mock。
 *
 * 纯映射逻辑抽成 `deriveOfficeStatusOverlay`，便于单测。
 */

import { useMemo } from 'react';
import {
  useHandoffStore,
  useLayerStore,
  type HandoffEntry,
  type LayerNode,
  type TeamRoleLayer,
} from '../../../../stores/team/team-events.js';
import type { AgentTeamsOfficeAgent, AgentOfficeStatus } from '../data/team-runtime-types.js';

/** 办公室角色槽位（按 OFFICE_AGENT_POSITIONS 顺序）近似映射到团队层级。 */
const AGENT_INDEX_TO_LAYER: TeamRoleLayer[] = ['pm1', 'pm2', 'executor', 'reviewer'];

export interface LayerActivity {
  running: Set<TeamRoleLayer>;
  pending: Set<TeamRoleLayer>;
  failed: Set<TeamRoleLayer>;
}

/** 从 layer 节点与 handoff 派生每层的活动状态集合。 */
export function deriveLayerActivity(input: {
  layerNodes: Iterable<LayerNode>;
  handoffs: Iterable<HandoffEntry>;
}): LayerActivity {
  const running = new Set<TeamRoleLayer>();
  const pending = new Set<TeamRoleLayer>();
  const failed = new Set<TeamRoleLayer>();

  for (const node of input.layerNodes) {
    if (node.state === 'running') running.add(node.roleLayer);
    else if (node.state === 'pending' || node.state === 'claimed') pending.add(node.roleLayer);
    else if (node.state === 'failed') failed.add(node.roleLayer);
  }
  for (const entry of input.handoffs) {
    if (entry.state === 'running') running.add(entry.toRoleLayer);
    else if (entry.state === 'pending' || entry.state === 'claimed') pending.add(entry.toRoleLayer);
    else if (entry.state === 'failed') failed.add(entry.toRoleLayer);
  }
  return { running, pending, failed };
}

/** 根据某层的活动状态决定 agent 的 3D 状态。 */
export function layerToOfficeStatus(
  layer: TeamRoleLayer,
  activity: LayerActivity,
): AgentOfficeStatus {
  if (activity.running.has(layer)) return 'working';
  if (activity.pending.has(layer)) return 'discussing';
  return 'resting';
}

/**
 * 把真实层级活动映射成 office agent 的 status 覆盖。
 * 返回新的 officeAgents 数组（仅 status 被覆盖），无活动时原样返回（全 resting）。
 */
export function deriveOfficeStatusOverlay(
  agents: AgentTeamsOfficeAgent[],
  activity: LayerActivity,
): AgentTeamsOfficeAgent[] {
  const hasAnyActivity =
    activity.running.size > 0 || activity.pending.size > 0 || activity.failed.size > 0;
  if (!hasAnyActivity) {
    return agents;
  }
  return agents.map((agent, index) => {
    const layer = AGENT_INDEX_TO_LAYER[index] ?? 'executor';
    return { ...agent, status: layerToOfficeStatus(layer, activity) };
  });
}

function isLiveBindingEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  return window.localStorage.getItem('teamV2.office.liveBinding') !== '0';
}

/**
 * 消费 OfficeThreeCanvas 的 officeAgents，叠加真实 layer/handoff 状态。
 * flag 关闭或无活动时返回原数组。
 */
export function useOfficeLayerBinding(agents: AgentTeamsOfficeAgent[]): AgentTeamsOfficeAgent[] {
  const layerNodes = useLayerStore((s) => s.nodes);
  const handoffs = useHandoffStore((s) => s.handoffs);

  return useMemo(() => {
    if (!isLiveBindingEnabled()) return agents;
    const activity = deriveLayerActivity({
      layerNodes: layerNodes.values(),
      handoffs: handoffs.values(),
    });
    return deriveOfficeStatusOverlay(agents, activity);
  }, [agents, layerNodes, handoffs]);
}

export { AGENT_INDEX_TO_LAYER };
