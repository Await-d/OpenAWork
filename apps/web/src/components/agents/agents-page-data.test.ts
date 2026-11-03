/**
 * `agents-page-data` 的纯函数覆盖：排序 / 统计 / 筛选 / 角色选项。
 *
 * 这些逻辑原先内联在 `AgentsPage.tsx` 里（无覆盖），布局重构时抽成独立模块，
 * 这里把行为契约固定下来——尤其是「后排的内置 Agent 也要能被中文说明搜到」这类
 * 容易被顺手改掉的细节。
 */

import { describe, expect, it } from 'vitest';
import {
  collectRoleOptions,
  filterAgents,
  sortAgents,
  summarizeAgents,
} from './agents-page-data.js';
import type { AgentsFilterState } from './agents-page-data.js';
import type { CoreRole, ManagedAgentRecord } from '@openAwork/shared';

function agent(overrides: Partial<ManagedAgentRecord> & { id: string }): ManagedAgentRecord {
  return {
    label: overrides.id,
    description: '',
    aliases: [],
    enabled: true,
    origin: 'builtin',
    source: 'builtin',
    removable: false,
    resettable: true,
    hasOverrides: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const NO_FILTER: AgentsFilterState = {
  query: '',
  originFilter: 'all',
  roleFilter: 'all',
  statusFilter: 'all',
};

function filter(patch: Partial<AgentsFilterState>): AgentsFilterState {
  return { ...NO_FILTER, ...patch };
}

describe('sortAgents', () => {
  it('按「启用 → 内置先于自定义 → 名称」排序且不改动入参数组', () => {
    const disabledBuiltin = agent({ id: 'aaa', label: 'Aaa', enabled: false });
    const enabledBuiltin = agent({ id: 'bbb', label: 'Bbb' });
    const enabledCustom = agent({ id: 'ccc', label: 'Ccc', origin: 'custom', source: 'custom' });
    const input = [disabledBuiltin, enabledBuiltin, enabledCustom];

    const sorted = sortAgents(input);

    // 启用的两条排在前面；同启用态下内置先于自定义（沿用旧实现的行为，未在本次重构中改动）。
    expect(sorted.map((item) => item.id)).toEqual(['bbb', 'ccc', 'aaa']);
    expect(input.map((item) => item.id)).toEqual(['aaa', 'bbb', 'ccc']);
  });

  it('同状态下按中文名称排序', () => {
    const sorted = sortAgents([
      agent({ id: 'z', label: '架构顾问' }),
      agent({ id: 'a', label: '数据管家' }),
    ]);
    expect(sorted.map((item) => item.label)).toEqual(['架构顾问', '数据管家']);
  });
});

describe('summarizeAgents', () => {
  it('统计总数 / 启用 / 禁用 / 自定义', () => {
    const summary = summarizeAgents([
      agent({ id: 'a' }),
      agent({ id: 'b', enabled: false }),
      agent({ id: 'c', origin: 'custom', source: 'custom' }),
    ]);

    expect(summary).toEqual({ total: 3, enabled: 2, disabled: 1, custom: 1 });
  });
});

describe('collectRoleOptions', () => {
  it('只收集真实出现过的角色并去重', () => {
    const roles = collectRoleOptions([
      agent({ id: 'a', canonicalRole: { coreRole: 'planner' } }),
      agent({ id: 'b', canonicalRole: { coreRole: 'planner', preset: 'architect' } }),
      agent({ id: 'c', canonicalRole: { coreRole: 'reviewer' } }),
      agent({ id: 'd' }),
    ]);

    expect(roles).toEqual<CoreRole[]>(['planner', 'reviewer']);
  });
});

describe('filterAgents 的筛选维度', () => {
  const planner = agent({
    id: 'architect-advisor',
    label: '架构顾问',
    description: '负责架构评审与设计权衡。',
    aliases: ['arch', '架构审查'],
    canonicalRole: { coreRole: 'planner', preset: 'architect' },
    model: 'anthropic/claude-opus-4.1',
    variant: 'high',
    fallbackModels: ['anthropic/claude-sonnet-4.5'],
    systemPrompt: '先确认约束条件与不变量。',
    note: '大重构评审专用',
    origin: 'custom',
    source: 'configured',
  });
  const build = agent({ id: 'build', label: 'Build', enabled: false });
  const agents = [build, planner];

  it('空查询保留全部并按排序规则输出', () => {
    expect(filterAgents(agents, NO_FILTER).map((item) => item.id)).toEqual([
      'architect-advisor',
      'build',
    ]);
  });

  it.each([
    ['名称', '架构'],
    ['id', 'architect-advisor'],
    ['说明', '设计权衡'],
    ['别名', '架构审查'],
    ['角色（原始）', 'planner'],
    ['角色（中文）', '规划 / 架构'],
    ['模型', 'claude-opus-4.1'],
    ['variant', 'high'],
    ['回退模型', 'sonnet-4.5'],
    ['系统提示词', '约束条件'],
    ['备注', '大重构'],
  ])('可按%s命中', (_label, query) => {
    expect(filterAgents(agents, filter({ query })).map((item) => item.id)).toEqual([
      'architect-advisor',
    ]);
  });

  it('内置 Agent 可用中文说明命中（本地化文案也进检索范围）', () => {
    expect(filterAgents(agents, filter({ query: '统筹执行' })).map((item) => item.id)).toEqual([
      'build',
    ]);
  });

  it('查询大小写不敏感且前后空白被忽略', () => {
    expect(filterAgents(agents, filter({ query: '  BUILD  ' })).map((item) => item.id)).toEqual([
      'build',
    ]);
  });

  it('类型筛选按 origin 区分内置与自定义（而不是按 source）', () => {
    // architect-advisor 的 source 是 configured，若按 source 过滤会一条都筛不出来，
    // 与头部统计「自定义 N」自相矛盾。
    expect(filterAgents(agents, filter({ originFilter: 'custom' })).map((i) => i.id)).toEqual([
      'architect-advisor',
    ]);
    expect(filterAgents(agents, filter({ originFilter: 'builtin' })).map((i) => i.id)).toEqual([
      'build',
    ]);
  });

  it('角色筛选与状态筛选生效', () => {
    expect(filterAgents(agents, filter({ roleFilter: 'planner' })).map((i) => i.id)).toEqual([
      'architect-advisor',
    ]);
    expect(filterAgents(agents, filter({ statusFilter: 'disabled' })).map((i) => i.id)).toEqual([
      'build',
    ]);
    expect(filterAgents(agents, filter({ statusFilter: 'enabled' })).map((i) => i.id)).toEqual([
      'architect-advisor',
    ]);
  });

  it('无匹配时返回空数组', () => {
    expect(filterAgents(agents, filter({ query: '不存在的关键字' }))).toEqual([]);
  });
});
