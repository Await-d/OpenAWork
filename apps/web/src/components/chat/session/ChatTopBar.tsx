import { useEffect, useRef, useState, type ReactNode } from 'react';
import DialogueModeToggle from '../../../pages/chat-page/mode/DialogueModeToggle.js';
import DialogueModeSwitchButton from '../../../pages/chat-page/mode/DialogueModeSwitchButton.js';
import type { DialogueMode } from '../../../pages/chat-page/mode/dialogue-mode.js';
import type { ComposerPermissionMode } from '../composer/ComposerPermissionModeSelect.js';
import {
  ChatTodoFloatingPanel,
  ChatTopBarTodoSlot,
  type ChatTodoController,
} from '../../conversation-runtime/views/todo-bar.js';
import { useDisplayPreferencesStore } from '../../../stores/settings/display-preferences.js';
import './ChatTopBar.css';

/**
 * 工作区绑定 chip 的可控状态。
 *
 * - 提供 `onSelect`：会话尚未产生消息（新建态），chip 可点击直接调整绑定。
 * - 省略 `onSelect`：会话已开始对话，绑定锁定，chip 只读展示。
 */
export interface WorkspaceBindingChipState {
  /** 展示名：工作区路径末段，或「未指定工作区」。 */
  label: string;
  /** 完整路径，用于 tooltip；未绑定时为 null。 */
  fullPath?: string | null;
  /** 可调整时的点击回调（打开工作区选择器）。 */
  onSelect?: () => void;
}

export interface ChatTopBarProps {
  dialogueMode: DialogueMode;
  onChangeDialogueMode: (mode: DialogueMode) => void;
  /**
   * 「确认转换」CTA（仅澄清模式渲染）：确认方案完成并切到编程模式。
   * 省略该回调时不渲染按钮（team 等场景）。
   */
  onConfirmClarifySwitch?: () => void;
  clarifySwitchPending?: boolean;
  /**
   * 审批方式档位只读标识：`auto-edit` 渲染中性（aux）chip，`ask` / `yolo`
   * 不渲染任何内容（YOLO 已在输入框内可调，顶栏不再重复提示）。
   */
  permissionMode?: ComposerPermissionMode;
  /**
   * 经典（非 Fusion）布局的分屏编辑器开关。Fusion 统一面板已接管编辑器入口，
   * 不传则顶栏不渲染该按钮。
   */
  editorMode?: boolean;
  onToggleEditorMode?: () => void;
  rightOpen: boolean;
  onToggleRightOpen: () => void;
  /**
   * 经典布局的编辑器全屏开关。Fusion 的「放大」动作位于统一面板内，不传则
   * 顶栏不渲染该按钮。
   */
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
  /**
   * 经典布局的浏览器预览入口。Fusion 的预览统一从会话面板进入，不传则顶栏
   * 不渲染该按钮。
   */
  onOpenBrowser?: () => void;
  browserActive?: boolean;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  density?: 'normal' | 'compact';
  todoController?: ChatTodoController;
  todoDetailsId?: string;
  hideDialogueModeToggle?: boolean;
  hideRightPanelToggle?: boolean;
  /** 会话信息 slot：标题 + 模型 + 模式，合并展示在左侧 */
  sessionInfo?: {
    title: string;
    modelLabel?: string | null;
    modeLabel?: string | null;
  };
  /**
   * 工作区绑定 chip：新建（尚未产生消息）的会话可点击快速调整绑定，
   * 一旦产生消息则只读展示、不再允许调整。
   */
  workspaceBinding?: WorkspaceBindingChipState;
  /** 会话面板切换（Fusion 统一面板 / classic 审查面板共用同一入口） */
  reviewPanelOpened?: boolean;
  onToggleReviewPanel?: () => void;
  /** 终端面板切换（从 SessionHeaderBar 迁移） */
  terminalPanelOpened?: boolean;
  onToggleTerminalPanel?: () => void;
}

// ChatTopBar 总宽度小于此阈值时，todo 入口切到 compact 徽章形态。
const TODO_COMPACT_WIDTH_THRESHOLD = 720;

/** 「编辑自动」铅笔图标：与输入框档位控件的中档字形保持一致。 */
function AutoEditPencilGlyph() {
  return (
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
      <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  );
}

/**
 * 只读的「编辑自动」标识：文件编辑 / 写入自动执行，其余工具仍需确认。
 * 使用 aux（info）中性语义——琥珀警示色只属于免审批档，避免中档被误读为危险。
 */
function ReadonlyAutoEditChip() {
  return (
    <span
      data-testid="chat-top-bar-auto-edit-chip"
      data-readonly="true"
      data-tone="info"
      title="编辑自动（在输入框中切换）"
      style={{
        height: 26,
        padding: '0 7px',
        borderRadius: 5,
        border: 'none',
        background: 'color-mix(in srgb, var(--aux) 18%, var(--bg-overlay))',
        color: 'var(--aux)',
        boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--aux) 42%, var(--border-default))',
        fontSize: 10,
        fontWeight: 600,
        flexShrink: 0,
        letterSpacing: '0.04em',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        userSelect: 'none',
      }}
    >
      <AutoEditPencilGlyph />
      编辑自动
    </span>
  );
}

export function ChatTopBar({
  dialogueMode,
  onChangeDialogueMode,
  onConfirmClarifySwitch,
  clarifySwitchPending = false,
  permissionMode,
  editorMode = false,
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
  hideRightPanelToggle = false,
  sessionInfo,
  workspaceBinding,
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

        {/* 会话信息：标题 + 模型/模式（来自 SessionHeaderBar 合并）；工作区由绑定 chip 单独渲染 */}
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
            </span>
          </>
        )}

        {workspaceBinding && <WorkspaceBindingChip binding={workspaceBinding} />}

        {(sessionInfo || workspaceBinding) && (
          <>
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

        {onConfirmClarifySwitch ? (
          <DialogueModeSwitchButton
            mode={dialogueMode}
            onConfirm={onConfirmClarifySwitch}
            pending={clarifySwitchPending}
            style={{ marginLeft: 4 }}
          />
        ) : null}

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

      {/* Right group: terminal + panel — unified pill container */}
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
        {permissionMode === 'auto-edit' && <ReadonlyAutoEditChip />}
        {onToggleEditorMode && (
          <button
            type="button"
            data-testid="chat-top-bar-editor-toggle"
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
        )}
        {onOpenBrowser && (
          <button
            type="button"
            data-testid="chat-top-bar-browser-toggle"
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
            data-testid="chat-top-bar-fullscreen-toggle"
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

/**
 * 工作区绑定 chip。
 *
 * 新建（未产生消息）的会话渲染为可点击按钮，一键调整绑定的工作区；
 * 已开始对话后渲染为只读态（无 `onSelect`），并把锁定原因放进 tooltip。
 */
function WorkspaceBindingChip({ binding }: { binding: WorkspaceBindingChipState }) {
  const fullPath = binding.fullPath ?? null;
  const content = (
    <>
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
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: 160,
        }}
      >
        {binding.label}
      </span>
      {binding.onSelect ? (
        <svg
          aria-hidden="true"
          width="9"
          height="9"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      ) : null}
    </>
  );

  if (!binding.onSelect) {
    return (
      <span
        className="chat-top-bar__workspace-chip"
        data-interactive="false"
        data-testid="chat-top-bar-workspace-binding"
        title={
          fullPath
            ? `工作区：${fullPath}（已开始对话，绑定已锁定）`
            : '未指定工作区（已开始对话，绑定已锁定）'
        }
      >
        {content}
      </span>
    );
  }

  const actionLabel = fullPath ? `调整绑定工作区：${fullPath}` : '选择要绑定的工作区';
  return (
    <button
      type="button"
      className="chat-top-bar__workspace-chip"
      data-interactive="true"
      data-testid="chat-top-bar-workspace-binding"
      onClick={binding.onSelect}
      title={actionLabel}
      aria-label={actionLabel}
    >
      {content}
    </button>
  );
}
