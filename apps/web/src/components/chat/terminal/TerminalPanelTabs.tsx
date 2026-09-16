/**
 * TerminalPanelTabs — 终端抽屉第 1 行：面板级页签（终端 / 端口）+ 面板操作（收起）。
 *
 * 页签是真页签（`role=tablist` / `role=tab` + `aria-selected` + `aria-controls`），
 * 键盘按 WAI-ARIA tabs 模式的「automatic activation」：←/→ 既移动焦点也切换
 * 视图，roving tabindex 保证整组只占一个 Tab 停靠点。
 *
 * 页签选择是调用方的瞬态 state —— 打开面板总是先看终端，不落盘。
 */

import { useRef } from 'react';
import { ChevronDownIcon, PlugIcon, TerminalIcon } from './TerminalIcons.js';

export type TerminalPanelTabId = 'terminal' | 'ports';

interface PanelTabSpec {
  id: TerminalPanelTabId;
  label: string;
}

export const TERMINAL_PANEL_TABS: readonly PanelTabSpec[] = [
  { id: 'terminal', label: '终端' },
  { id: 'ports', label: '端口' },
];

export function terminalPanelTabElementId(idBase: string, tab: TerminalPanelTabId): string {
  return `${idBase}-tab-${tab}`;
}

export function terminalPanelPanelElementId(idBase: string): string {
  return `${idBase}-panel`;
}

export interface TerminalPanelTabsProps {
  /** `useId()` 的基串，用于 tab ↔ tabpanel 的 id 关联。 */
  idBase: string;
  activeTab: TerminalPanelTabId;
  onSelectTab: (tab: TerminalPanelTabId) => void;
  onRequestClose: () => void;
}

export function TerminalPanelTabs({
  idBase,
  activeTab,
  onSelectTab,
  onRequestClose,
}: TerminalPanelTabsProps) {
  const tabRefs = useRef<Partial<Record<TerminalPanelTabId, HTMLButtonElement | null>>>({});

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const index = TERMINAL_PANEL_TABS.findIndex((tab) => tab.id === activeTab);
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const next =
      TERMINAL_PANEL_TABS[
        (index + delta + TERMINAL_PANEL_TABS.length) % TERMINAL_PANEL_TABS.length
      ];
    if (!next) return;
    onSelectTab(next.id);
    tabRefs.current[next.id]?.focus();
  };

  return (
    <div className="terminal-panel__tab-rail">
      <div
        role="tablist"
        aria-label="终端面板视图"
        className="terminal-panel__tablist"
        onKeyDown={handleTabKeyDown}
      >
        {TERMINAL_PANEL_TABS.map((tab) => {
          const selected = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              ref={(node) => {
                tabRefs.current[tab.id] = node;
              }}
              role="tab"
              id={terminalPanelTabElementId(idBase, tab.id)}
              aria-selected={selected}
              aria-controls={terminalPanelPanelElementId(idBase)}
              tabIndex={selected ? 0 : -1}
              data-testid={`terminal-panel-tab-${tab.id}`}
              className="terminal-panel-tab"
              onClick={() => onSelectTab(tab.id)}
            >
              {tab.id === 'terminal' ? <TerminalIcon size={14} /> : <PlugIcon size={14} />}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
      <div className="terminal-panel__tab-rail-actions">
        <button
          type="button"
          className="terminal-panel__icon-btn"
          aria-label="收起终端面板"
          title="收起终端面板"
          data-testid="terminal-panel-collapse"
          onClick={onRequestClose}
        >
          <ChevronDownIcon size={14} />
        </button>
      </div>
    </div>
  );
}
