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

/**
 * 分段式标签栏。方案 B 把它从页面级工具条降级为**左列列表头部的视图切换**，
 * 因为它切换的正是左列的数据源（市场 / 本地工作区 / 已安装）。
 *
 * 控件外观走 `console-surface` 的 `console-seg`（与 Agent 页的来源筛选同源），
 * 这里不再自带一套内联样式。
 */
export function SkillsTabBar({ activeTab, updateCount, onTabChange }: SkillsTabBarProps) {
  return (
    <div className="console-seg" role="tablist" aria-label="技能视图">
      {TABS.map((tab) => {
        const active = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`console-seg__btn${active ? ' is-active' : ''}`}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.label}
            {tab.id === 'installed' && updateCount > 0 ? (
              <span className="console-seg__count">{updateCount}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
