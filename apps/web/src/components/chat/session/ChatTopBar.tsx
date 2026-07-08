import { useEffect, useRef, useState, type ReactNode } from 'react';
import DialogueModeToggle from '../../../pages/chat-page/mode/DialogueModeToggle.js';
import type { DialogueMode } from '../../../pages/chat-page/mode/dialogue-mode.js';
import {
  ChatTodoFloatingPanel,
  ChatTopBarTodoSlot,
  type ChatTodoController,
} from '../../conversation-runtime/views/todo-bar.js';
import { useDisplayPreferencesStore } from '../../../stores/settings/display-preferences.js';

interface ChatTopBarProps {
  dialogueMode: DialogueMode;
  onChangeDialogueMode: (mode: DialogueMode) => void;
  yoloMode: boolean;
  onToggleYolo: () => void;
  editorMode: boolean;
  onToggleEditorMode: () => void;
  rightOpen: boolean;
  onToggleRightOpen: () => void;
  /**
   * 编辑器/浏览器工作区是否处于全屏(占据整个内容区)模式。
   */
  editorFullScreen?: boolean;
  /** 切换编辑器全屏模式。提供时在编辑器按钮旁渲染一个全屏切换按钮。 */
  onToggleEditorFullScreen?: () => void;
  /**
   * Editor pane 当前激活的 tab(用于 code/browser 按钮的 active 视觉状态)。
   * 不传时 fallback 到只看 editorMode。
   */
  editorPaneTab?: 'code' | 'browser';
  /** 进入/切到 code tab。默认行为:进入分屏 + 设置 tab='code'。 */
  onActivateCodeTab?: () => void;
  /** 进入/切到 browser tab。默认行为:进入分屏 + 设置 tab='browser'。 */
  onActivateBrowserTab?: () => void;
  /**
   * Optional terminals chip (running terminal indicator + popover trigger).
   * Rendered inside the right-side pill so it sits next to the YOLO toggle
   * without forcing a layout shift when undefined.
   */
  terminalsChip?: ReactNode;
  /**
   * Optional quick terminal toggle button. Rendered alongside the
   * terminals chip; toggles the bottom QuickTerminalPanel.
   */
  quickTerminalToggle?: ReactNode;
  /** Callback to open the command palette (Cmd+K). */
  onOpenCommandPalette?: () => void;
  /** Number of bookmarked messages in the current session. */
  bookmarkCount?: number;
  /** Whether multi-select mode is active. */
  multiSelectActive?: boolean;
  onToggleMultiSelect?: () => void;
  /** Callback to open browser preview in editor pane. */
  onOpenBrowser?: () => void;
  /** Whether browser preview is currently active. */
  browserActive?: boolean;
  /** 是否显示会话列表切换按钮(左侧)。 */
  sidebarOpen?: boolean;
  /** 切换左侧会话列表 sidebar 的回调。 */
  onToggleSidebar?: () => void;
  density?: 'normal' | 'compact';
  /** Todo controller from upstream (shared with ChatTodoFloatingPanel). */
  todoController?: ChatTodoController;
  /** id for aria-controls linking the slot button to the floating panel. */
  todoDetailsId?: string;
  /**
   * 隐藏 DialogueModeToggle（澄清/编程/程序员切换器）。
   * team 页面使用：reception 层的路由决策由后端 b.router 自动判断，
   * 不需要用户手动切换对话模式。
   */
  hideDialogueModeToggle?: boolean;
  /**
   * 隐藏 YOLO 模式切换。team 页面不支持 YOLO（工具权限由 layer capability 控制）。
   */
  hideYoloToggle?: boolean;
  /**
   * 隐藏右面板切换按钮。team 页面暂不接入 ChatRightPanel。
   */
  hideRightPanelToggle?: boolean;
}

// ChatTopBar 总宽度小于此阈值时，todo 入口切到 compact 徽章形态。
const TODO_COMPACT_WIDTH_THRESHOLD = 720;

export function ChatTopBar({
  dialogueMode,
  onChangeDialogueMode,
  yoloMode,
  onToggleYolo,
  editorMode,
  onToggleEditorMode,
  rightOpen,
  onToggleRightOpen,
  editorFullScreen = false,
  onToggleEditorFullScreen,
  editorPaneTab,
  onActivateCodeTab,
  onActivateBrowserTab,
  terminalsChip,
  quickTerminalToggle,
  onOpenCommandPalette,
  bookmarkCount = 0,
  multiSelectActive = false,
  onToggleMultiSelect,
  onOpenBrowser,
  browserActive = false,
  sidebarOpen,
  onToggleSidebar,
  density = 'normal',
  todoController,
  todoDetailsId,
  hideDialogueModeToggle = false,
  hideYoloToggle = false,
  hideRightPanelToggle = false,
}: ChatTopBarProps) {
  const showCommandPaletteButton = useDisplayPreferencesStore((s) => s.showCommandPaletteButton);
  const showTerminalButton = useDisplayPreferencesStore((s) => s.showTerminalButton);
  const compactDensity = density === 'compact';

  // 测量自身宽度，决定 todo slot 是 compact（徽章）还是 full（摘要）。
  const barRef = useRef<HTMLDivElement>(null);
  const todoAnchorRef = useRef<HTMLDivElement>(null);
  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => {
    const node = barRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        setIsCompact(width < TODO_COMPACT_WIDTH_THRESHOLD);
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={barRef}
      data-testid="chat-controls-bar"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        // 一定不换行 — 一旦换行右侧 pill 会跑到下一行,而 SessionTerminalsPanel
        // 等 popover 是相对 pill 定位的,跟随换行就会显示在错乱位置。
        flexWrap: 'nowrap',
        padding: compactDensity ? '4px 8px' : '6px 12px',
        borderBottom: '1px solid var(--border-subtle)',
        flexShrink: 0,
        background: compactDensity ? 'var(--bg-surface)' : 'var(--bg-overlay)',
        minHeight: compactDensity ? 36 : 44,
        // 让中间 group 在窄屏时可被压缩,但本行不换。
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minWidth: 0,
          // 抢占除右侧 pill 与 todo anchor 之外的所有可用宽度;窄屏时
          // 内部子元素自身有 ellipsis / compact 模式(见 isCompact)。
          flex: '1 1 0',
          flexWrap: 'nowrap',
          overflow: 'hidden',
        }}
      >
        {onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            title={sidebarOpen ? '收起会话列表' : '展开会话列表'}
            aria-label={sidebarOpen ? '收起会话列表' : '展开会话列表'}
            aria-pressed={!!sidebarOpen}
            style={{
              width: 26,
              height: 26,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: sidebarOpen
                ? '1px solid color-mix(in oklch, var(--accent) 30%, var(--border-default))'
                : '1px solid var(--border-subtle)',
              borderRadius: 6,
              background: sidebarOpen
                ? 'color-mix(in oklch, var(--accent) 12%, transparent)'
                : 'transparent',
              color: sidebarOpen ? 'var(--accent)' : 'var(--fg-default)',
              cursor: 'pointer',
              flexShrink: 0,
              fontSize: 0,
            }}
          >
            <svg
              aria-hidden="true"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
            </svg>
          </button>
        )}

        {hideDialogueModeToggle ? null : (
          <DialogueModeToggle
            mode={dialogueMode}
            onChange={onChangeDialogueMode}
            style={{ flexShrink: 1, minWidth: 0 }}
          />
        )}

        {/* Command palette trigger */}
        {onOpenCommandPalette && showCommandPaletteButton && (
          <button
            type="button"
            onClick={onOpenCommandPalette}
            title="命令面板 (⌘K)"
            style={{
              height: 24,
              padding: '0 8px',
              borderRadius: 5,
              border: '1px solid var(--border-subtle)',
              background: 'transparent',
              color: 'var(--fg-muted)',
              fontSize: 10,
              fontWeight: 500,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              flexShrink: 0,
            }}
          >
            <svg
              aria-hidden="true"
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            ⌘K
          </button>
        )}

        {/* Bookmark count indicator */}
        {bookmarkCount > 0 && (
          <span
            title={`当前会话有 ${bookmarkCount} 条收藏消息`}
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: 'var(--fg-muted)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              flexShrink: 0,
            }}
          >
            ⭐ {bookmarkCount}
          </span>
        )}

        {/* Multi-select toggle */}
        {onToggleMultiSelect && (
          <button
            type="button"
            onClick={onToggleMultiSelect}
            aria-pressed={multiSelectActive}
            title={multiSelectActive ? '退出多选模式 (⌘⇧M)' : '多选消息 (⌘⇧M)'}
            style={{
              height: 24,
              padding: '0 7px',
              borderRadius: 5,
              border: multiSelectActive
                ? '1px solid var(--accent)'
                : '1px solid var(--border-subtle)',
              background: multiSelectActive
                ? 'color-mix(in oklch, var(--accent) 12%, transparent)'
                : 'transparent',
              color: multiSelectActive ? 'var(--accent)' : 'var(--fg-muted)',
              fontSize: 10,
              fontWeight: 500,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              flexShrink: 0,
            }}
          >
            ☑ 多选
          </button>
        )}
      </div>

      {todoController && todoDetailsId ? (
        <div ref={todoAnchorRef} className="chat-todo-topbar-anchor">
          <ChatTopBarTodoSlot
            controller={todoController}
            detailsId={todoDetailsId}
            compact={isCompact}
          />
          <ChatTodoFloatingPanel
            controller={todoController}
            detailsId={todoDetailsId}
            anchorRef={todoAnchorRef}
          />
        </div>
      ) : null}

      {/* Right group: YOLO + editor + panel — unified pill container */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          // todo anchor 存在时由其 margin-left:auto 把右 pill 一起推到右侧；
          // anchor 不存在时右 pill 自己负责对齐。
          marginLeft: todoController && todoDetailsId ? undefined : 'auto',
          flexShrink: 0,
          padding: '2px 3px',
          borderRadius: 8,
          background: 'var(--bg-overlay)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        {showTerminalButton && terminalsChip}
        {showTerminalButton && quickTerminalToggle}
        {hideYoloToggle ? null : (
          <button
            type="button"
            aria-pressed={yoloMode}
            onClick={onToggleYolo}
            title="YOLO 模式：更少确认、直达结果"
            style={{
              height: 26,
              padding: '0 7px',
              borderRadius: 5,
              border: 'none',
              background: yoloMode
                ? 'color-mix(in srgb, var(--warning) 22%, var(--bg-overlay))'
                : 'transparent',
              color: yoloMode ? 'var(--warning)' : 'var(--fg-muted)',
              boxShadow: yoloMode
                ? 'inset 0 0 0 1px color-mix(in srgb, var(--warning) 50%, var(--border-default))'
                : 'none',
              fontSize: 10,
              fontWeight: 600,
              cursor: 'pointer',
              flexShrink: 0,
              letterSpacing: '0.04em',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
            }}
          >
            <svg
              aria-hidden="true"
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="currentColor"
              stroke="none"
            >
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
            YOLO
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            if (onActivateCodeTab) {
              onActivateCodeTab();
              return;
            }
            onToggleEditorMode();
          }}
          title={
            editorMode && editorPaneTab === 'code'
              ? '关闭代码编辑器'
              : editorMode
                ? '切换到代码编辑器'
                : '打开代码编辑器'
          }
          className={`icon-btn${editorMode && (editorPaneTab === undefined || editorPaneTab === 'code') ? ' active' : ''}`}
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg
            aria-hidden="true"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
        </button>
        {onOpenBrowser && (
          <button
            type="button"
            onClick={() => {
              if (onActivateBrowserTab) {
                onActivateBrowserTab();
                return;
              }
              onOpenBrowser();
            }}
            title={
              editorMode && editorPaneTab === 'browser'
                ? '关闭浏览器预览'
                : editorMode
                  ? '切换到浏览器预览'
                  : '打开浏览器预览'
            }
            className={`icon-btn${editorMode && editorPaneTab === 'browser' ? ' active' : ''}`}
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg
              aria-hidden="true"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
          </button>
        )}
        {onToggleEditorFullScreen && (
          <button
            type="button"
            onClick={onToggleEditorFullScreen}
            aria-pressed={editorFullScreen}
            title={
              editorFullScreen ? '退出全屏 · 恢复分屏对话' : '全屏编辑器/浏览器 · 占据整个内容区'
            }
            className={`icon-btn${editorFullScreen ? ' active' : ''}`}
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {editorFullScreen ? (
              <svg
                aria-hidden="true"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="4 14 10 14 10 20" />
                <polyline points="20 10 14 10 14 4" />
                <line x1="14" y1="10" x2="21" y2="3" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            ) : (
              <svg
                aria-hidden="true"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="15 3 21 3 21 9" />
                <polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            )}
          </button>
        )}
        {hideRightPanelToggle ? null : (
          <button
            type="button"
            onClick={onToggleRightOpen}
            title={rightOpen ? '收起面板' : '展开面板'}
            className={`icon-btn${rightOpen ? ' active' : ''}`}
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg
              aria-hidden="true"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="15" y1="3" x2="15" y2="21" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
