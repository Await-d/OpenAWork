/**
 * 260517-team-page-v2 · 主 tab 配置
 *
 * 把 TeamPageV2 中间区的「5 主 tab + 子 segmented」结构数据和样式集中到这里，
 * 让页面文件聚焦于交互编排，避免 1500 行限制压力。
 *
 * 与 MiddleTabRouter 的关系：
 *   - 这里只声明子 tab 的 leaf key 与展示属性。
 *   - MiddleTabRouter 负责按 leaf key 渲染对应内容。
 *   - 两者通过 MiddleTabKey 联合类型在编译期保证一致。
 */

import type { CSSProperties } from 'react';
import type { MiddleTabKey } from './MiddleTabRouter.js';

export type PrimaryTabKey = 'overview' | 'conversation' | 'tasks' | 'metrics' | 'governance';

export interface SubTabDef {
  key: MiddleTabKey;
  label: string;
  icon: string;
}

export interface PrimaryTabDef {
  key: PrimaryTabKey;
  label: string;
  icon: string;
  children: SubTabDef[];
}

export const PRIMARY_TABS: ReadonlyArray<PrimaryTabDef> = [
  {
    key: 'overview',
    label: '概览',
    icon: '📊',
    children: [
      { key: 'dashboard', label: '仪表盘', icon: '📊' },
      { key: 'topology', label: '拓扑', icon: '🕸️' },
      { key: 'health', label: '健康度', icon: '🩺' },
    ],
  },
  {
    key: 'conversation',
    label: '对话',
    icon: '💬',
    children: [
      { key: 'conversation', label: '当前对话', icon: '💬' },
      { key: 'layered', label: '层级', icon: '🪜' },
      { key: 'messages', label: '消息', icon: '✉️' },
    ],
  },
  {
    key: 'tasks',
    label: '任务',
    icon: '📋',
    children: [
      { key: 'tasks', label: '任务流', icon: '📋' },
      { key: 'dispatch', label: '派发包', icon: '📦' },
      { key: 'artifacts', label: '产物', icon: '🧱' },
      { key: 'review', label: '评审', icon: '✅' },
    ],
  },
  {
    key: 'metrics',
    label: '度量',
    icon: '⏱️',
    children: [
      { key: 'timing', label: '耗时', icon: '⏱️' },
      { key: 'usage', label: '用量', icon: '🔋' },
      { key: 'tools', label: '工具调用', icon: '🛠️' },
    ],
  },
  {
    key: 'governance',
    label: '治理',
    icon: '⚙️',
    children: [
      { key: 'members', label: '成员', icon: '👥' },
      { key: 'templates', label: '模板', icon: '📐' },
      { key: 'shares', label: '共享', icon: '🤝' },
      { key: 'audit', label: '审计', icon: '📜' },
      { key: 'settings', label: '设置', icon: '⚙️' },
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

// ─── 主 tab 栏（顶部，强调） ─────────────────────────────────────
export const PRIMARY_TAB_BAR_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'stretch',
  gap: 2,
  paddingInline: 10,
  paddingTop: 0,
  borderBottom: '1px solid color-mix(in srgb, var(--border-default) 45%, transparent)',
  flexShrink: 0,
  background: 'var(--bg-overlay)',
  overflowX: 'auto',
  overflowY: 'hidden',
  scrollbarWidth: 'thin',
  height: 34,
};

export const PRIMARY_TAB_BTN_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '0 12px',
  border: 'none',
  borderBottom: '2px solid transparent',
  background: 'transparent',
  color: 'var(--fg-muted)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  flexShrink: 0,
  whiteSpace: 'nowrap',
  letterSpacing: '0.005em',
  transition: 'color 120ms ease, border-color 120ms ease',
  marginBottom: -1,
};

export const PRIMARY_TAB_BTN_ACTIVE_STYLE: CSSProperties = {
  ...PRIMARY_TAB_BTN_STYLE,
  // 与基础样式保持同一种写法（shorthand），避免在 active 切换时 React 报
  // “Removing a style property during rerender (borderBottomColor) when a
  // conflicting property is set (borderBottom)” 的警告。
  borderBottom: '2px solid var(--accent)',
  color: 'var(--fg-strong)',
  fontWeight: 700,
};

// ─── 子 tab 栏（segmented，轻量） ─────────────────────────────────
export const SUB_TAB_BAR_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  paddingInline: 12,
  paddingBlock: 4,
  borderBottom: '1px solid color-mix(in srgb, var(--border-default) 25%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 60%, var(--bg-base))',
  flexShrink: 0,
  overflowX: 'auto',
  overflowY: 'hidden',
  scrollbarWidth: 'thin',
  minHeight: 28,
};

export const SUB_TAB_BTN_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 10px',
  border: '1px solid transparent',
  background: 'transparent',
  color: 'var(--fg-muted)',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  borderRadius: 6,
  flexShrink: 0,
  whiteSpace: 'nowrap',
  transition: 'background 120ms ease, color 120ms ease',
};

export const SUB_TAB_BTN_ACTIVE_STYLE: CSSProperties = {
  ...SUB_TAB_BTN_STYLE,
  background: 'color-mix(in srgb, var(--accent) 16%, transparent)',
  color: 'var(--accent)',
  fontWeight: 700,
};

// ─── 3D 办公独立按钮 ─────────────────────────────────────────────
export const OFFICE_TOGGLE_STYLE: CSSProperties = {
  marginLeft: 'auto',
  marginInline: '4px 8px',
  alignSelf: 'center',
  padding: '5px 12px',
  border: '1px solid color-mix(in srgb, var(--border-default) 55%, transparent)',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--fg-default)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  flexShrink: 0,
};

export const OFFICE_TOGGLE_ACTIVE_STYLE: CSSProperties = {
  ...OFFICE_TOGGLE_STYLE,
  background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
  // 与基础同样使用 border shorthand，避免 React 在切换 active 状态时
  // 因为 borderColor 与 border 混用而报警告。
  border: '1px solid color-mix(in srgb, var(--accent) 50%, transparent)',
  color: 'var(--accent)',
};
