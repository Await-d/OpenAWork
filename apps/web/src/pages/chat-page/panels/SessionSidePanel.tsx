/**
 * SessionSidePanel — 右侧统一 Tab 式侧面板。
 *
 * 参照 OpenCode SessionSidePanel：
 *   [审查 N] [文件] [Context] [+]
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

export type SidePanelTabId = 'review' | 'files' | 'context';

export interface SessionSidePanelProps {
  readonly reviewCount?: number;
  readonly activeTab: SidePanelTabId;
  readonly onTabChange: (tab: SidePanelTabId) => void;
  readonly onAddFile?: () => void;
  readonly children: ReactNode;
  readonly style?: CSSProperties;
}

interface TabDef {
  id: SidePanelTabId;
  label: string;
  badge?: number;
}

type TabDirection = 'next' | 'previous';

function getAdjacentTabId(tabId: SidePanelTabId, direction: TabDirection): SidePanelTabId {
  if (tabId === 'review') {
    return direction === 'next' ? 'files' : 'context';
  }
  if (tabId === 'files') {
    return direction === 'next' ? 'context' : 'review';
  }
  return direction === 'next' ? 'review' : 'files';
}

export function SessionSidePanel({
  reviewCount = 0,
  activeTab,
  onTabChange,
  onAddFile,
  children,
  style,
}: SessionSidePanelProps) {
  const panelInstanceId = useId();
  const tabButtonRefs = useRef<Record<SidePanelTabId, HTMLButtonElement | null>>({
    context: null,
    files: null,
    review: null,
  });
  const tabs: TabDef[] = [
    { id: 'review', label: '审查', badge: reviewCount || undefined },
    { id: 'files', label: '文件' },
    { id: 'context', label: 'Context' },
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
        nextTabId = 'review';
      } else if (event.key === 'End') {
        nextTabId = 'context';
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

        {onAddFile && (
          <button
            type="button"
            className="session-side-panel__add-button"
            title="打开文件"
            aria-label="打开文件"
            onClick={onAddFile}
          >
            <svg
              aria-hidden="true"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        )}
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
