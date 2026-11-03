/**
 * Agent 目录的排序、统计与筛选（纯函数）。
 *
 * 从 `AgentsPage.tsx` 内联实现抽出：页面容器只做动作编排与状态持有，这里负责
 * 「给定全量记录 + 筛选条件 → 可见列表」，便于单独推理与测试。
 */

import { formatCanonicalRole } from '@openAwork/shared';
import type { CoreRole, ManagedAgentRecord } from '@openAwork/shared';
import { formatCanonicalRoleZh, localizeAgentDescription } from './agents-editor-state.js';

export type AgentStatusFilter = 'all' | 'enabled' | 'disabled';

/**
 * 类型筛选（内置 / 自定义）。
 *
 * 比对的是 `origin` 而不是 `source`：用户创建的 Agent 其 `source` 通常是
 * `configured`，只有系统内置才是 `builtin`。若按 `source` 过滤，会出现
 * 「头部统计『自定义 2』、筛选『自定义』却 0 条」的自相矛盾。
 */
type AgentOriginFilter = 'all' | ManagedAgentRecord['origin'];

export interface AgentsFilterState {
  query: string;
  originFilter: AgentOriginFilter;
  roleFilter: 'all' | CoreRole;
  statusFilter: AgentStatusFilter;
}

export interface AgentsSummary {
  total: number;
  enabled: number;
  disabled: number;
  custom: number;
}

/** 排序：启用优先 → 内置先于自定义 → 名称（zh-CN）。 */
export function sortAgents(agents: ManagedAgentRecord[]): ManagedAgentRecord[] {
  return [...agents].sort((left, right) => {
    const statusDelta = Number(right.enabled) - Number(left.enabled);
    if (statusDelta !== 0) {
      return statusDelta;
    }
    const originDelta = Number(left.origin === 'builtin') - Number(right.origin === 'builtin');
    if (originDelta !== 0) {
      return -originDelta;
    }
    return left.label.localeCompare(right.label, 'zh-CN');
  });
}

export function summarizeAgents(agents: ManagedAgentRecord[]): AgentsSummary {
  return {
    total: agents.length,
    enabled: agents.filter((agent) => agent.enabled).length,
    disabled: agents.filter((agent) => !agent.enabled).length,
    custom: agents.filter((agent) => agent.origin === 'custom').length,
  };
}

/** 筛选栏的角色下拉：只列出当前数据里真实出现过的角色。 */
export function collectRoleOptions(agents: ManagedAgentRecord[]): CoreRole[] {
  return Array.from(
    new Set(
      agents
        .map((agent) => agent.canonicalRole?.coreRole)
        .filter((role): role is CoreRole => typeof role === 'string'),
    ),
  );
}

function buildHaystack(agent: ManagedAgentRecord): string {
  return [
    agent.id,
    agent.label,
    agent.description,
    localizeAgentDescription(agent),
    agent.canonicalRole ? formatCanonicalRole(agent.canonicalRole) : '',
    formatCanonicalRoleZh(agent) ?? '',
    agent.model ?? '',
    agent.variant ?? '',
    ...(agent.fallbackModels ?? []),
    agent.note ?? '',
    agent.systemPrompt ?? '',
    ...agent.aliases,
  ]
    .join(' ')
    .toLowerCase();
}

export function filterAgents(
  agents: ManagedAgentRecord[],
  filter: AgentsFilterState,
): ManagedAgentRecord[] {
  const normalizedQuery = filter.query.trim().toLowerCase();
  return sortAgents(agents).filter((agent) => {
    if (filter.originFilter !== 'all' && agent.origin !== filter.originFilter) {
      return false;
    }
    if (filter.roleFilter !== 'all' && agent.canonicalRole?.coreRole !== filter.roleFilter) {
      return false;
    }
    if (filter.statusFilter === 'enabled' && !agent.enabled) {
      return false;
    }
    if (filter.statusFilter === 'disabled' && agent.enabled) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }
    return buildHaystack(agent).includes(normalizedQuery);
  });
}
