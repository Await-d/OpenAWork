import type { CSSProperties } from 'react';

export type SkillsTab = 'market' | 'local' | 'installed';

export interface SkillsTabBarProps {
  activeTab: SkillsTab;
  updateCount: number;
  onTabChange: (tab: SkillsTab) => void;
}

const TABS: Array<{ id: SkillsTab; label: string }> = [
  { id: 'market', label: '市场' },
  { id: 'local', label: '本地' },
  { id: 'installed', label: '已安装' },
];

const baseTab: CSSProperties = {
  background: 'transparent',
  border: 'none',
  borderRadius: 6,
  color: 'var(--fg-muted)',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
  padding: '5px 12px',
  transition: 'background 100ms ease, color 100ms ease',
};

const activeTabStyle: CSSProperties = {
  ...baseTab,
  background: 'var(--bg-overlay)',
  boxShadow: 'var(--shadow-sm, 0 1px 2px rgba(0, 0, 0, 0.25))',
  color: 'var(--fg-strong)',
};

/** 分段式标签栏（替代旧版「技能工作区」工具条卡）。 */
export function SkillsTabBar({ activeTab, updateCount, onTabChange }: SkillsTabBarProps) {
  return (
    <div
      role="tablist"
      aria-label="技能视图"
      style={{
        alignItems: 'center',
        alignSelf: 'flex-start',
        background: 'var(--bg-raised)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 8,
        display: 'inline-flex',
        gap: 2,
        padding: 3,
      }}
    >
      {TABS.map((tab) => {
        const active = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onTabChange(tab.id)}
            style={active ? activeTabStyle : baseTab}
          >
            {tab.label}
            {tab.id === 'installed' && updateCount > 0 ? (
              <span
                style={{
                  background: 'var(--contrast-muted)',
                  borderRadius: 9999,
                  color: 'var(--contrast)',
                  fontSize: 10,
                  fontWeight: 700,
                  marginLeft: 6,
                  padding: '1px 6px',
                }}
              >
                {updateCount}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
