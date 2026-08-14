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
  editorFullScreen?: boolean;
  onToggleEditorFullScreen?: () => void;
  editorPaneTab?: 'code' | 'browser';
  onActivateCodeTab?: () => void;
  onActivateBrowserTab?: () => void;
  terminalsChip?: ReactNode;
  quickTerminalToggle?: ReactNode;
  onOpenCommandPalette?: () => void;
  bookmarkCount?: number;
  multiSelectActive?: boolean;
  onToggleMultiSelect?: () => void;
  onOpenBrowser?: () => void;
  browserActive?: boolean;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  density?: 'normal' | 'compact';
  todoController?: ChatTodoController;
  todoDetailsId?: string;
  hideDialogueModeToggle?: boolean;
  hideYoloToggle?: boolean;
  hideRightPanelToggle?: boolean;
  /** 会话信息 slot：标题 + 模型 + 模式 + 工作区，合并展示在左侧 */
  sessionInfo?: {
    title: string;
    modelLabel?: string | null;
    modeLabel?: string | null;
    workspacePath?: string | null;
  };
  /** 审查面板切换（从 SessionHeaderBar 迁移） */
  reviewPanelOpened?: boolean;
  onToggleReviewPanel?: () => void;
  /** 终端面板切换（从 SessionHeaderBar 迁移） */
  terminalPanelOpened?: boolean;
  onToggleTerminalPanel?: () => void;
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
  sessionInfo,
  reviewPanelOpened = false,
  onToggleReviewPanel,
  terminalPanelOpened = false,
  onToggleTerminalPanel,
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
        padding: sessionInfo ? '4px 8px' : compactDensity ? '4px 8px' : '6px 12px',
        borderBottom: '1px solid var(--border-subtle)',
        flexShrink: 0,
        background: 'var(--bg-overlay)',
        minHeight: sessionInfo ? 36 : compactDensity ? 36 : 44,
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

        {/* 会话信息：标题 + 模型/模式/工作区（来自 SessionHeaderBar 合并） */}
        {sessionInfo && (
          <>
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--fg-strong)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                flexShrink: 1,
                minWidth: 0,
                maxWidth: 160,
              }}
              title={sessionInfo.title}
            >
              {sessionInfo.title}
            </span>
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 11,
                color: 'var(--fg-muted)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                flexShrink: 1,
                minWidth: 0,
              }}
            >
              {sessionInfo.modelLabel && (
                <span
                  style={{
                    color: 'var(--aux)',
                    fontWeight: 600,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {sessionInfo.modelLabel}
                </span>
              )}
              {sessionInfo.modeLabel && (
                <>
                  <span>·</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {sessionInfo.modeLabel}
                  </span>
                </>
              )}
              {sessionInfo.workspacePath && (
                <>
                  <span>·</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {sessionInfo.workspacePath.split(/[\\/]/).pop()}
                  </span>
                </>
              )}
            </span>
            {/* 分隔线 */}
            <span
              style={{
                width: 1,
                height: 14,
                background: 'var(--border-subtle)',
                flexShrink: 0,
              }}
            />
          </>
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
        {/* 审查面板切换 */}
        {onToggleReviewPanel && (
          <button
            type="button"
            onClick={onToggleReviewPanel}
            title={reviewPanelOpened ? '收起审查面板' : '展开审查面板'}
            className={`icon-btn${reviewPanelOpened ? ' active' : ''}`}
            style={{
              height: 26,
              padding: '0 7px',
              borderRadius: 5,
              border: 'none',
              background: reviewPanelOpened
                ? 'color-mix(in oklch, var(--accent) 12%, transparent)'
                : 'transparent',
              color: reviewPanelOpened ? 'var(--accent)' : 'var(--fg-muted)',
              fontSize: 10,
              fontWeight: 600,
              cursor: 'pointer',
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
            }}
          >
            <svg
              aria-hidden="true"
              width="11"
              height="11"
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
            审查
          </button>
        )}
        {/* 终端面板切换 */}
        {onToggleTerminalPanel && (
          <button
            type="button"
            onClick={onToggleTerminalPanel}
            title={terminalPanelOpened ? '收起终端面板' : '展开终端面板'}
            className={`icon-btn${terminalPanelOpened ? ' active' : ''}`}
            style={{
              height: 26,
              padding: '0 7px',
              borderRadius: 5,
              border: 'none',
              background: terminalPanelOpened
                ? 'color-mix(in oklch, var(--accent) 12%, transparent)'
                : 'transparent',
              color: terminalPanelOpened ? 'var(--accent)' : 'var(--fg-muted)',
              fontSize: 10,
              fontWeight: 600,
              cursor: 'pointer',
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
            }}
          >
            <svg
              aria-hidden="true"
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
            终端
          </button>
        )}
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
