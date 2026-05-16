/**
 * 260516-team-page-v2 · T-02（视觉优化版）
 *
 * 右侧可收起三 Tab 面板（任务 / 团队 / 设置）。
 *
 * - 由父组件以 grid template 控制宽度（折叠 → 0）
 * - 收起按钮固定在面板左边缘外侧（半圆贴边）
 * - 三 Tab 用 segmented control 风格
 */

import { useState, type CSSProperties, type ReactNode } from 'react';

const CONTAINER_STYLE: CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  borderLeft: '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
  background: 'color-mix(in srgb, var(--surface) 84%, var(--bg))',
  overflow: 'hidden',
  minHeight: 0,
  transition: 'width 200ms ease, opacity 150ms ease',
};

const HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: 8,
  borderBottom: '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
};

const SEGMENTED_GROUP_STYLE: CSSProperties = {
  display: 'flex',
  flex: 1,
  padding: 2,
  gap: 2,
  borderRadius: 8,
  background: 'color-mix(in srgb, var(--bg-2) 70%, var(--bg))',
};

const TAB_BUTTON_STYLE: CSSProperties = {
  flex: 1,
  padding: '5px 8px',
  borderRadius: 6,
  border: 'none',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  color: 'var(--text-3)',
};

const TAB_BUTTON_ACTIVE_STYLE: CSSProperties = {
  ...TAB_BUTTON_STYLE,
  color: 'var(--text)',
  boxShadow: '0 1px 2px color-mix(in srgb, #000 8%, transparent)',
};

const COLLAPSE_BUTTON_BASE: CSSProperties = {
  position: 'absolute',
  width: 22,
  height: 44,
  border: '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
  fontSize: 12,
  cursor: 'pointer',
  zIndex: 1,
  color: 'var(--text-2)',
  display: 'grid',
  placeItems: 'center',
};

export type RightPanelTabKey = 'tasks' | 'team' | 'settings';

const TAB_LABELS: Record<RightPanelTabKey, string> = {
  tasks: '任务',
  team: '团队',
  settings: '设置',
};

function isRightPanelTabKey(value: string | null): value is RightPanelTabKey {
  return value === 'tasks' || value === 'team' || value === 'settings';
}

export interface RightPanelProps {
  /** 收起状态由父组件控制（可持久化） */
  collapsed: boolean;
  expandedWidth: number;
  onToggleCollapsed: () => void;
  activeTab: RightPanelTabKey;
  onTabChange: (tab: RightPanelTabKey) => void;
  tasksContent: ReactNode;
  teamContent: ReactNode;
  settingsContent: ReactNode;
}

export function RightPanel({
  collapsed,
  expandedWidth,
  onToggleCollapsed,
  activeTab,
  onTabChange,
  tasksContent,
  teamContent,
  settingsContent,
}: RightPanelProps) {
  return (
    <aside
      aria-label="右侧面板"
      aria-hidden={collapsed}
      style={{
        ...CONTAINER_STYLE,
        width: collapsed ? 0 : expandedWidth,
        maxWidth: '100%',
        opacity: collapsed ? 0 : 1,
        pointerEvents: collapsed ? 'none' : 'auto',
      }}
    >
      {!collapsed ? (
        <button
          className="team-v2-control team-v2-control--surface"
          type="button"
          onClick={onToggleCollapsed}
          aria-label="收起右侧面板"
          title="收起右侧面板"
          style={{
            ...COLLAPSE_BUTTON_BASE,
            left: -22,
            top: 80,
            borderTopLeftRadius: 8,
            borderBottomLeftRadius: 8,
            borderTopRightRadius: 0,
            borderBottomRightRadius: 0,
            borderRight: 'none',
          }}
        >
          ▶
        </button>
      ) : null}

      <header
        style={{
          ...HEADER_STYLE,
          visibility: collapsed ? 'hidden' : 'visible',
        }}
      >
        <div style={SEGMENTED_GROUP_STYLE}>
          {(['tasks', 'team', 'settings'] as RightPanelTabKey[]).map((tab) => {
            const active = tab === activeTab;
            return (
              <button
                key={tab}
                className={`team-v2-control ${active ? 'team-v2-control--tab-active' : 'team-v2-control--transparent'}`}
                type="button"
                onClick={() => onTabChange(tab)}
                style={active ? TAB_BUTTON_ACTIVE_STYLE : TAB_BUTTON_STYLE}
              >
                {TAB_LABELS[tab]}
              </button>
            );
          })}
        </div>
      </header>

      <div
        key={activeTab}
        className="team-v2-panel-tab-content"
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          padding: 12,
          visibility: collapsed ? 'hidden' : 'visible',
        }}
      >
        {activeTab === 'tasks' ? tasksContent : null}
        {activeTab === 'team' ? teamContent : null}
        {activeTab === 'settings' ? settingsContent : null}
      </div>
    </aside>
  );
}

/**
 * 受控的 collapsed 状态 hook，持久化到 localStorage。
 */
export function useRightPanelState(): {
  collapsed: boolean;
  toggleCollapsed: () => void;
  activeTab: RightPanelTabKey;
  setActiveTab: (tab: RightPanelTabKey) => void;
} {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('teamV2.rightPanel.collapsed') === '1';
  });
  const [activeTab, setActiveTab] = useState<RightPanelTabKey>(() => {
    if (typeof window === 'undefined') return 'tasks';
    const stored = window.localStorage.getItem('teamV2.rightPanel.tab');
    return isRightPanelTabKey(stored) ? stored : 'tasks';
  });

  return {
    collapsed,
    toggleCollapsed: () => {
      setCollapsed((c) => {
        const next = !c;
        if (typeof window !== 'undefined') {
          window.localStorage.setItem('teamV2.rightPanel.collapsed', next ? '1' : '0');
        }
        return next;
      });
    },
    activeTab,
    setActiveTab: (tab) => {
      setActiveTab(tab);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('teamV2.rightPanel.tab', tab);
      }
    },
  };
}
