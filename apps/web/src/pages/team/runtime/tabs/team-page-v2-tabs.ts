/**
 * 260517-team-page-v2 · 主 tab 配置
 *
 * 把 TeamPageV2 中间区的「5 主 tab + 子 segmented」结构数据集中到这里，
 * 让页面文件聚焦于交互编排，避免 1500 行限制压力。
 *
 * 与 MiddleTabRouter 的关系：
 *   - 这里只声明子 tab 的 leaf key 与展示属性。
 *   - MiddleTabRouter 负责按 leaf key 渲染对应内容。
 *   - 两者通过 MiddleTabKey 联合类型在编译期保证一致。
 *
 * 视觉样式（主/子 tab 胶囊）由 `shell/header/TeamTabBar.tsx` 统一持有，
 * 本文件只保留结构数据。
 */

import type { MiddleTabKey } from './MiddleTabRouter.js';
import type { TeamTabIconName } from './team-tab-icons.js';

export type PrimaryTabKey =
  'overview' | 'files' | 'conversation' | 'tasks' | 'metrics' | 'governance';

export interface SubTabDef {
  key: MiddleTabKey;
  label: string;
  icon: TeamTabIconName;
}

export interface PrimaryTabDef {
  key: PrimaryTabKey;
  label: string;
  icon: TeamTabIconName;
  children: SubTabDef[];
}

export const PRIMARY_TABS: ReadonlyArray<PrimaryTabDef> = [
  {
    key: 'overview',
    label: '概览',
    icon: 'overview',
    children: [
      { key: 'dashboard', label: '仪表盘', icon: 'overview' },
      { key: 'graph', label: '关系图谱', icon: 'graph' },
      { key: 'health', label: '健康度', icon: 'health' },
    ],
  },
  {
    key: 'files',
    label: '文件',
    icon: 'files',
    children: [{ key: 'files', label: '工作区文件', icon: 'files' }],
  },
  {
    key: 'conversation',
    label: '对话',
    icon: 'conversation',
    children: [
      { key: 'conversation', label: '当前对话', icon: 'conversation' },
      { key: 'flow', label: '层级流动', icon: 'flow' },
      { key: 'layered', label: '历史层级', icon: 'layered' },
      { key: 'messages', label: '消息', icon: 'messages' },
    ],
  },
  {
    key: 'tasks',
    label: '任务',
    icon: 'tasks',
    children: [
      { key: 'taskboard', label: '任务看板', icon: 'tasks' },
      { key: 'artifacts', label: '任务与产物', icon: 'artifacts' },
      { key: 'review', label: '评审', icon: 'review' },
    ],
  },
  {
    key: 'metrics',
    label: '度量',
    icon: 'metrics',
    children: [
      { key: 'usage', label: '用量', icon: 'usage' },
      { key: 'timing', label: '耗时', icon: 'timing' },
      { key: 'tools', label: '工具调用', icon: 'settings' },
    ],
  },
  {
    key: 'governance',
    label: '治理',
    icon: 'governance',
    children: [
      { key: 'init', label: '初始化', icon: 'init' },
      { key: 'templates', label: '模板', icon: 'templates' },
      { key: 'shares', label: '共享', icon: 'shares' },
      { key: 'audit', label: '审计', icon: 'audit' },
      { key: 'settings', label: '设置', icon: 'settings' },
    ],
  },
];

/** 叶子 key → 所属主 tab；'office' 不在表里（独立沉浸视图）。 */
export const LEAF_TO_PRIMARY: ReadonlyMap<MiddleTabKey, PrimaryTabKey> = new Map(
  PRIMARY_TABS.flatMap((primary) =>
    primary.children.map((child) => [child.key, primary.key] as const),
  ),
);

/** 所有合法 leaf key 集合（含 'office' 沉浸视图，用于 localStorage 校验）。 */
export const MIDDLE_TAB_KEYS: ReadonlySet<MiddleTabKey> = new Set<MiddleTabKey>([
  'office',
  ...LEAF_TO_PRIMARY.keys(),
]);

/** 主 tab 默认子 tab：切到主 tab 但当前 leaf 不属于它时回落到此。 */
export function getDefaultLeafFor(primaryKey: PrimaryTabKey): MiddleTabKey {
  const def = PRIMARY_TABS.find((tab) => tab.key === primaryKey);
  // 类型上 children 至少要有一项才有意义；这里强断言以避免 noUncheckedIndexedAccess。
  const first = def?.children[0];
  if (!first) {
    throw new Error(`PRIMARY_TABS["${primaryKey}"] 必须至少声明一个子 tab`);
  }
  return first.key;
}
