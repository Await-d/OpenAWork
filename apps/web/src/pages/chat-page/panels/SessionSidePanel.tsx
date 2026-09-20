/**
 * SessionSidePanel — 会话侧面板的 Tab 条（桌面停靠面板 + 键盘导航的唯一事实来源）。
 *
 * 信息架构（一级扁平化）：
 *   [代码] [预览] [审查 N] [子代理 N] [会话概览]
 *
 * 桌面端不再有第二层「工作区」tab：代码编辑器与浏览器预览是一级 tab，共享同一个
 * 常驻工作区 pane（见 `FusionSessionSidePanel`）。
 *
 * `SidePanelTabId` 是桌面 / 移动端共享的联合类型：`files` / `browser` 只属于
 * 移动端底部面板（`FusionMobileBottomPanel`），`agent` 只属于桌面停靠面板的
 * 子代理预览；两端在各自消费入口先收敛，保证联合类型始终自洽。
 */

import {
  useCallback,
  useId,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import './SessionSidePanel.css';

export type SidePanelTabId =
  'review' | 'agent' | 'code' | 'preview' | 'context' | 'files' | 'browser';

export interface SessionSidePanelProps {
  readonly reviewCount?: number;
  readonly subAgentCount?: number;
  readonly activeTab: SidePanelTabId;
  readonly onTabChange: (tab: SidePanelTabId) => void;
  readonly children: ReactNode;
  readonly style?: CSSProperties;
  /**
   * Tab 条右端的附加动作槽位（可选扩展点）。不传时 tab 条只渲染 tab 按钮。
   */
  readonly trailingAction?: ReactNode;
}

interface TabDef {
  id: SidePanelTabId;
  label: string;
  badge?: number;
}

type TabDirection = 'next' | 'previous';

/** tab 顺序的唯一事实来源——键盘左右循环与 Home/End 都从它推导。 */
const PANEL_TAB_ORDER: readonly SidePanelTabId[] = [
  'code',
  'preview',
  'review',
  'agent',
  'context',
];

function getAdjacentTabId(tabId: SidePanelTabId, direction: TabDirection): SidePanelTabId {
  const index = PANEL_TAB_ORDER.indexOf(tabId);
  // 未知 / 移动端专属 id 不可能落在本 tab 条上（消费端会先收敛）；仍兜底到
  // 首位，保证键盘导航永远不会落到不存在的 tab。
  if (index < 0) {
    return PANEL_TAB_ORDER[0] ?? tabId;
  }
  const offset = direction === 'next' ? 1 : -1;
  const count = PANEL_TAB_ORDER.length;
  return PANEL_TAB_ORDER[(index + offset + count) % count] ?? tabId;
}

export function SessionSidePanel({
  reviewCount = 0,
  subAgentCount = 0,
  activeTab,
  onTabChange,
  children,
  style,
  trailingAction,
}: SessionSidePanelProps) {
  const panelInstanceId = useId();
  const tabButtonRefs = useRef<Record<SidePanelTabId, HTMLButtonElement | null>>({
    agent: null,
    browser: null,
    code: null,
    context: null,
    files: null,
    preview: null,
    review: null,
  });
  const tabs: TabDef[] = [
    { id: 'code', label: '代码' },
    { id: 'preview', label: '预览' },
    { id: 'review', label: '审查', badge: reviewCount || undefined },
    { id: 'agent', label: '子代理', badge: subAgentCount || undefined },
    { id: 'context', label: '会话概览' },
  ];
  const activePanelId = `${panelInstanceId}-${activeTab}-panel`;
  const activeTabId = `${panelInstanceId}-${activeTab}-tab`;
  const focusTab = useCallback(
    (tabId: SidePanelTabId) => {
      onTabChange(tabId);
      tabButtonRefs.current[tabId]?.focus();
    },
    [onTabChange],
  );
  const handleTabKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, tabId: SidePanelTabId) => {
      let nextTabId: SidePanelTabId | null = null;

      if (event.key === 'ArrowRight') {
        nextTabId = getAdjacentTabId(tabId, 'next');
      } else if (event.key === 'ArrowLeft') {
        nextTabId = getAdjacentTabId(tabId, 'previous');
      } else if (event.key === 'Home') {
        nextTabId = PANEL_TAB_ORDER[0] ?? tabId;
      } else if (event.key === 'End') {
        nextTabId = PANEL_TAB_ORDER[PANEL_TAB_ORDER.length - 1] ?? tabId;
      }

      if (nextTabId === null) {
        return;
      }

      event.preventDefault();
      focusTab(nextTabId);
    },
    [focusTab],
  );

  return (
    <aside className="session-side-panel" style={style}>
      <div className="session-side-panel__tabs-row">
        <div className="session-side-panel__tabs" role="tablist" aria-label="会话侧面板">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            const tabId = `${panelInstanceId}-${tab.id}-tab`;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-controls={isActive ? activePanelId : undefined}
                aria-selected={isActive}
                className="session-side-panel__tab"
                data-active={isActive ? 'true' : 'false'}
                id={tabId}
                onClick={() => onTabChange(tab.id)}
                onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
                ref={(element) => {
                  tabButtonRefs.current[tab.id] = element;
                }}
                tabIndex={isActive ? 0 : -1}
              >
                {tab.label}
                {tab.badge !== undefined && (
                  <span className="session-side-panel__tab-badge">{tab.badge}</span>
                )}
              </button>
            );
          })}
        </div>

        {trailingAction ? (
          <div className="session-side-panel__tabs-action">{trailingAction}</div>
        ) : null}
      </div>

      <div
        className="session-side-panel__content"
        role="tabpanel"
        aria-labelledby={activeTabId}
        id={activePanelId}
      >
        {children}
      </div>
    </aside>
  );
}
