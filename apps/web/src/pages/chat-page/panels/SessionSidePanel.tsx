/**
 * SessionSidePanel — 右侧统一 Tab 式侧面板。
 *
 * 参照 OpenCode SessionSidePanel：
 *   [审查 N] [文件] [Context] [+]
 */

import type { CSSProperties, ReactNode } from 'react';
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

export function SessionSidePanel({
  reviewCount = 0,
  activeTab,
  onTabChange,
  onAddFile,
  children,
  style,
}: SessionSidePanelProps) {
  const tabs: TabDef[] = [
    { id: 'review', label: '审查', badge: reviewCount || undefined },
    { id: 'files', label: '文件' },
    { id: 'context', label: 'Context' },
  ];

  return (
    <aside className="session-side-panel" style={style}>
      <div className="session-side-panel__tabs">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              className="session-side-panel__tab"
              data-active={isActive ? 'true' : 'false'}
              onClick={() => onTabChange(tab.id)}
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

      <div className="session-side-panel__content">{children}</div>
    </aside>
  );
}
