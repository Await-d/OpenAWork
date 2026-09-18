/**
 * TerminalPanelTabs — 终端抽屉第 1 行：面板级页签（终端 / 端口）+ 面板操作
 * （最大化 / 还原、收起），并承载整条 rail 的面板级右键菜单。
 *
 * 页签是真页签（`role=tablist` / `role=tab` + `aria-selected` + `aria-controls`），
 * 键盘按 WAI-ARIA tabs 模式的「automatic activation」：←/→ 既移动焦点也切换
 * 视图，roving tabindex 保证整组只占一个 Tab 停靠点。
 *
 * 页签选择、最大化（见 uiState 的 `terminalPanelMaximized`）与停靠位置都由调用方
 * 持有 —— rail 只渲染与回调，不持有面板模式；位置与可用性判断（窄视口 / overlay）
 * 同样由调用方算出后传入。
 * 菜单复用 `TerminalContextMenu`（键盘 / 关闭 / 视口夹取都是既有行为）。
 */

import { useRef, useState } from 'react';
import {
  TERMINAL_PANEL_POSITIONS,
  type TerminalPanelPosition,
} from '../../../stores/ui/uiState.js';
import { TerminalContextMenu, type TerminalContextMenuItem } from './TerminalContextMenu.js';
import { ChevronDownIcon, MaximizeIcon, RestoreIcon } from './TerminalIcons.js';

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

/** 目的地文案：菜单项 label 与 title 共用，避免两处各写一遍中文。 */
const POSITION_LABELS: Record<TerminalPanelPosition, string> = {
  bottom: '底部',
  left: '左侧',
  right: '右侧',
};

/**
 * 可用状态下每个目的地的效果说明。侧停靠会收同侧侧栏，这是一个用户在选择前
 * 就应当看到的后果（尤其它不会在取消停靠时自动还回来）。
 */
const POSITION_TITLES: Record<TerminalPanelPosition, string> = {
  bottom: '把终端面板放回底部抽屉（此前为停靠让出的侧栏不会自动展开）',
  left: '把终端面板停靠到工作台左侧并占满全高；左侧边栏会自动收起',
  right: '把终端面板停靠到工作台右侧并占满全高；右侧停靠面板会自动收起',
};

/** 侧停靠列本身已占满工作台全高，最大化没有可扩展的空间。 */
const MAXIMIZE_DISABLED_TITLE = '侧停靠的终端列已占满工作台全高，无需最大化';

export interface TerminalPanelTabsProps {
  /** `useId()` 的基串，用于 tab ↔ tabpanel 的 id 关联。 */
  idBase: string;
  activeTab: TerminalPanelTabId;
  onSelectTab: (tab: TerminalPanelTabId) => void;
  onRequestClose: () => void;
  /** 面板是否已最大化：只驱动切换按钮的图标/文案与菜单项 label。 */
  maximized: boolean;
  /** 最大化 / 还原切换（瞬态，由调用方决定状态归属）。 */
  onToggleMaximized: () => void;
  /** 当前停靠位置（调用方传**有效**值：窄视口 / overlay 已降级为底部）。 */
  position: TerminalPanelPosition;
  /** 停靠到目的地的请求；最大化清理与侧栏让位由调用方补齐（见 QuickTerminalPanel）。 */
  onMovePosition: (position: TerminalPanelPosition) => void;
  /**
   * 停靠不可用的原因（窄视口 / overlay 形态），null = 可用。
   * 不可用时三项位置菜单禁用并以此为 title：禁用而不解释等于坏控件。
   */
  dockingDisabledReason: string | null;
}

export function TerminalPanelTabs({
  idBase,
  activeTab,
  onSelectTab,
  onRequestClose,
  maximized,
  onToggleMaximized,
  position,
  onMovePosition,
  dockingDisabledReason,
}: TerminalPanelTabsProps) {
  const tabRefs = useRef<Partial<Record<TerminalPanelTabId, HTMLButtonElement | null>>>({});
  // 右键菜单坐标（瞬态）：沿用 TerminalTabActions 的 menuPosition 模式，
  // 菜单本体复用 TerminalContextMenu，不再写第二套浮层。
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);

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

  // 面板级命令分三组：最大化/还原、停靠位置（只列出与当前不同的目的地）、隐藏。
  // 停靠组用 separatorBefore 与其余两组隔开；不可用（窄视口 / overlay）时整组禁用
  // 并复用同一个原因作为 title —— 菜单永远不出现「点了没反应」的项。
  const docked = position !== 'bottom';
  const menuItems: TerminalContextMenuItem[] = [
    {
      id: 'toggle-maximized',
      label: maximized ? '还原面板' : '最大化面板',
      title: docked
        ? MAXIMIZE_DISABLED_TITLE
        : maximized
          ? '把终端面板还原为原高度（记住的高度未被修改）'
          : '让终端面板占满工作台（不修改记住的高度）',
      disabled: docked,
      onSelect: onToggleMaximized,
    },
    ...TERMINAL_PANEL_POSITIONS.filter((candidate) => candidate !== position).map(
      (destination, index): TerminalContextMenuItem => ({
        id: `move-panel-${destination}`,
        label: `移动面板到${POSITION_LABELS[destination]}`,
        title: dockingDisabledReason ?? POSITION_TITLES[destination],
        disabled: dockingDisabledReason !== null,
        separatorBefore: index === 0,
        onSelect: () => onMovePosition(destination),
      }),
    ),
    {
      id: 'hide-panel',
      label: '隐藏面板',
      title: '收起终端面板（等价右侧的收起按钮）',
      separatorBefore: true,
      onSelect: onRequestClose,
    },
  ];

  return (
    <div
      className="terminal-panel__tab-rail"
      data-testid="terminal-panel-tab-rail"
      onContextMenu={(event) => {
        // 整条 rail（含空白区；页签的事件会冒泡到这里）都是菜单命中区。
        event.preventDefault();
        setMenuPosition({ x: event.clientX, y: event.clientY });
      }}
    >
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
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
      <div className="terminal-panel__tab-rail-actions">
        <button
          type="button"
          className="terminal-panel__icon-btn"
          aria-label={maximized ? '还原终端面板' : '最大化终端面板'}
          title={docked ? MAXIMIZE_DISABLED_TITLE : maximized ? '还原终端面板' : '最大化终端面板'}
          disabled={docked}
          data-maximized={maximized ? 'true' : 'false'}
          data-testid="terminal-panel-maximize-toggle"
          onClick={onToggleMaximized}
        >
          {maximized ? <RestoreIcon size={14} /> : <MaximizeIcon size={14} />}
        </button>
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
      {menuPosition ? (
        <TerminalContextMenu
          x={menuPosition.x}
          y={menuPosition.y}
          items={menuItems}
          onClose={() => setMenuPosition(null)}
        />
      ) : null}
    </div>
  );
}
