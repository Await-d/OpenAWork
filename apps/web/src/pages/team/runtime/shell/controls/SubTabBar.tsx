/**
 * SubTabBar · 子 tab 导航条
 *
 * 渲染当前主 tab 下的子视图切换胶囊。仅当子视图 >1 个时显示。
 * 放在中间内容区顶部，让 tab 内容获得完整的中间区宽度。
 */

import { type CSSProperties, type ReactNode } from 'react';
import { PRIMARY_TABS, type PrimaryTabKey } from '../../tabs/team-page-v2-tabs.js';
import type { MiddleTabKey } from '../../tabs/MiddleTabRouter.js';

const SUB_TAB_BAR_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  padding: '6px 10px',
  borderBottom: '1px solid color-mix(in srgb, var(--border-default) 25%, transparent)',
  overflowX: 'auto',
  scrollbarWidth: 'none',
  flexShrink: 0,
  background: 'var(--bg-overlay)',
};

const SUB_TAB_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '5px 12px',
  borderRadius: 7,
  border: 'none',
  background: 'transparent',
  color: 'var(--fg-subtle)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  transition: 'background 120ms ease, color 120ms ease',
};

const SUB_TAB_ACTIVE_STYLE: CSSProperties = {
  ...SUB_TAB_STYLE,
  background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
  color: 'var(--accent)',
  fontWeight: 700,
};

function Badge({ count }: { count: number }): ReactNode | null {
  if (count <= 0) return null;
  return (
    <span
      style={{
        marginLeft: 2,
        padding: '0 6px',
        minWidth: 17,
        height: 17,
        borderRadius: 999,
        background: 'var(--danger)',
        color: 'var(--fg-on-accent)',
        fontSize: 10,
        fontWeight: 700,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

export interface SubTabBarProps {
  activePrimary: PrimaryTabKey | null;
  middleTab: MiddleTabKey;
  onMiddleChange: (key: MiddleTabKey) => void;
  unreadCount: number;
}

export function SubTabBar({
  activePrimary,
  middleTab,
  onMiddleChange,
  unreadCount,
}: SubTabBarProps) {
  const subTabs =
    activePrimary != null
      ? (PRIMARY_TABS.find((tab) => tab.key === activePrimary)?.children ?? [])
      : [];

  if (subTabs.length <= 1) return null;

  return (
    <div style={SUB_TAB_BAR_STYLE} role="tablist" aria-label="子视图切换">
      {subTabs.map((sub) => {
        const active = middleTab === sub.key;
        return (
          <button
            key={sub.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onMiddleChange(sub.key)}
            className="team-sub-tab"
            data-active={active || undefined}
            style={active ? SUB_TAB_ACTIVE_STYLE : SUB_TAB_STYLE}
            title={sub.label}
          >
            <span aria-hidden style={{ fontSize: 13 }}>
              {sub.icon}
            </span>
            <span>{sub.label}</span>
            {sub.key === 'messages' ? <Badge count={unreadCount} /> : null}
          </button>
        );
      })}
    </div>
  );
}
