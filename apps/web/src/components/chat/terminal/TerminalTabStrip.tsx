/**
 * TerminalTabStrip — 终端抽屉第 2 行左侧：当前可接管终端的 tab 列表。
 *
 * 行内重命名、关闭 ×、空态都在这里；tab 的存在性由 `useSessionTerminals`
 * 决定，本组件只负责渲染调用方传进来的活跃列表。
 *
 * T-12：本组件是**表现层**，tab 拖拽的手势状态机由 `TerminalPane` 通过
 * `drag` 绑定注入（它拿得到面板级 context 与布局树）。不传 `drag` 时（如单测
 * 直接渲染 tab 条）只保留原有的点击 / 重命名 / 关闭行为。
 */

import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { SessionTerminalView } from '../../conversation-runtime/terminals/terminals-api.js';
import { CloseIcon } from './TerminalIcons.js';

/**
 * tab 显示标签的优先级：用户自定义名 > agent 描述 > 命令前三个词 > `终端 N`。
 * 抽成导出函数是因为「⋯ → 重命名」需要和 tab 上显示的文案完全一致地预填。
 */
export function terminalTabLabel(term: SessionTerminalView, index: number): string {
  if (term.name && term.name.trim().length > 0) {
    return term.name.trim();
  }
  if (term.description && term.description.trim().length > 0) {
    const desc = term.description.trim();
    return desc.length > 24 ? `${desc.slice(0, 22)}…` : desc;
  }
  if (term.toolName === 'quick_terminal') {
    return `终端 ${index + 1}`;
  }
  if (term.command && term.command.length > 0) {
    const trimmed = term.command.trim().split(/\s+/).slice(0, 3).join(' ');
    return trimmed.length > 24 ? `${trimmed.slice(0, 22)}…` : trimmed;
  }
  return `终端 ${index + 1}`;
}

/**
 * T-12 tab 拖拽绑定（由 `TerminalPane` 注入）。
 *
 * `pointerdown` 在**被按下的 tab** 上起手；后续的 `pointermove` / `pointerup` /
 * `pointercancel` 由持有者 `TerminalPane` 挂到 **window** 上，而不是挂在 tab 条容器
 * 上等 pointer capture 重定向后再冒泡：capture 的重定向语义在部分 WebView / 非
 * Chromium 引擎上并不可靠，一旦不生效就会表现为「按下无跟手、无预览」。挂 window
 * 与引擎无关，且指针拖出面板（detach）时也能持续跟随。
 */
export interface TerminalTabDragBinding {
  /** 当前正在拖拽的终端（跨组共享，用于 tab 的弱化样式与点击抑制）。 */
  draggingTerminalId: string | null;
  /** 本组 tab 条是否为 `tab-strip` 落点（用于落点高亮）。 */
  dropOnStrip: boolean;
  onTabPointerDown(terminalId: string, event: ReactPointerEvent<HTMLDivElement>): void;
  /** Tab 聚焦在 tab 上时的键盘替代：Alt+←/→ 组内重排、Alt+Shift+←/→ 移到相邻组。 */
  onTabKeyDown(terminalId: string, event: ReactKeyboardEvent<HTMLDivElement>): void;
}

export interface TerminalTabStripProps {
  terminals: readonly SessionTerminalView[];
  activeId: string | null;
  /**
   * 所属 pane（分屏时是该组 id；无分屏的单组由调用方传隐式 pane 常量）。
   * 只做 DOM 标注（`data-pane-id`），供命中判定 / 测试定位用。
   */
  paneId?: string;
  /** 正在行内重命名的 terminalId；非空时该 tab 渲染输入框。 */
  renamingId: string | null;
  renameValue: string;
  /** T-12：tab 拖拽绑定；缺省 = 拖拽整体禁用。 */
  drag?: TerminalTabDragBinding;
  /**
   * 右键 / 键盘菜单键某 tab：上报该 terminalId 与该 tab 的视口坐标，
   * 由 `TerminalPane` 打开共享的 `TerminalContextMenu`。
   * 本组件是表现层，只上报事件、不持有菜单状态（与 `drag` 同一纪律）。
   */
  onTabContextMenu?: (terminalId: string, position: { x: number; y: number }) => void;
  onSelect: (terminalId: string) => void;
  onStartRename: (terminalId: string, currentLabel: string) => void;
  onRenameValueChange: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onClose: (terminalId: string) => void;
}

export function TerminalTabStrip({
  terminals,
  activeId,
  paneId,
  renamingId,
  renameValue,
  drag,
  onTabContextMenu,
  onSelect,
  onStartRename,
  onRenameValueChange,
  onCommitRename,
  onCancelRename,
  onClose,
}: TerminalTabStripProps) {
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (renamingId === null) return;
    const input = renameInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [renamingId]);

  return (
    <div
      className="terminal-tab-strip__list"
      data-testid="terminal-tab-strip"
      data-pane-id={paneId}
      data-drop-strip={drag?.dropOnStrip ? 'true' : undefined}
    >
      {terminals.length === 0 ? (
        <span className="terminal-tab-strip__empty">暂无运行中的终端 · 点击 ＋ 新建</span>
      ) : (
        terminals.map((term, index) => {
          const isActive = term.terminalId === activeId;
          const label = terminalTabLabel(term, index);
          const isRenaming = renamingId === term.terminalId;
          return (
            <div
              key={term.terminalId}
              className="terminal-tab"
              data-active={isActive ? 'true' : 'false'}
              data-testid={`terminal-tab-${term.terminalId}`}
              data-terminal-id={term.terminalId}
              data-dragging={drag?.draggingTerminalId === term.terminalId ? 'true' : undefined}
              onKeyDown={
                drag === undefined && onTabContextMenu === undefined
                  ? undefined
                  : (event) => {
                      // Shift+F10 / ContextMenu 键 = 键盘版右键（VS Code 同款）：
                      // 锚点取 tab 自身矩形，菜单贴着该 tab 弹出。
                      // 行内重命名时让位给输入框（与 onContextMenu 同一抑制口径）。
                      if (onTabContextMenu !== undefined && !isRenaming) {
                        const wantsMenu =
                          event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
                        if (wantsMenu) {
                          event.preventDefault();
                          const rect = event.currentTarget.getBoundingClientRect();
                          onTabContextMenu(term.terminalId, { x: rect.left, y: rect.bottom });
                          return;
                        }
                      }
                      drag?.onTabKeyDown(term.terminalId, event);
                    }
              }
              onContextMenu={
                onTabContextMenu === undefined
                  ? undefined
                  : (event) => {
                      // 行内重命名期间保留浏览器原生编辑菜单（剪切 / 复制 / 粘贴 / 全选）：
                      // 输入框有焦点时它的文本语义优先于 tab 菜单。
                      if (isRenaming) return;
                      event.preventDefault();
                      onTabContextMenu(term.terminalId, { x: event.clientX, y: event.clientY });
                    }
              }
              /**
               * 点选 / 双击重命名挂在**容器**上，而不是 label 按钮上：
               * 拖拽的 `pointerdown` 调了 `preventDefault()`（阻断原生拖拽），
               * 且 tab 内还有独立的关闭按钮 —— 容器级处理能让「点空白处」也不落空，
               * 并与拖拽后的 click 抑制（onSelect 内的 takeClickSuppression）串在同一条链上。
               * jsdom 与真实浏览器下都能拿到这条事件。
               */
              onClick={(event) => {
                if (isRenaming) return;
                // 关闭按钮有自己的语义（并且它的 pointerdown 不起拖、不捕获），交给它自己处理。
                if ((event.target as HTMLElement).closest('.terminal-tab__close')) return;
                // 双击的第二下只服务重命名，避免顺带多切一次 active。
                if (event.detail > 1) return;
                onSelect(term.terminalId);
              }}
              onDoubleClick={() => {
                if (isRenaming) return;
                onStartRename(term.terminalId, label);
              }}
              onPointerDown={
                drag === undefined || isRenaming
                  ? undefined
                  : (event) => {
                      // 关闭按钮与重命名输入框有自己的语义，不在它们身上起拖。
                      if ((event.target as HTMLElement).closest('.terminal-tab__close')) return;
                      drag.onTabPointerDown(term.terminalId, event);
                    }
              }
            >
              {isRenaming ? (
                <input
                  ref={renameInputRef}
                  className="terminal-tab__rename"
                  type="text"
                  aria-label="重命名终端"
                  // 重命名期间不接管面板级快捷键（同上）
                  data-terminal-ui-input=""
                  value={renameValue}
                  onChange={(event) => onRenameValueChange(event.target.value)}
                  onBlur={onCommitRename}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') onCommitRename();
                    if (event.key === 'Escape') onCancelRename();
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="terminal-tab__label"
                  aria-current={isActive ? 'true' : undefined}
                  title={`${term.command} · ${term.cwd}\n双击重命名 · 拖拽可移动 / 拆分`}
                >
                  {label}
                </button>
              )}
              <button
                type="button"
                className="terminal-tab__close"
                aria-label={`关闭终端 ${label}`}
                title={`关闭 ${label}`}
                onClick={() => onClose(term.terminalId)}
              >
                <CloseIcon size={12} />
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}
