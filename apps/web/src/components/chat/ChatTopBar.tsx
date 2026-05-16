import { useEffect, useRef, useState, type ReactNode } from 'react';
import DialogueModeToggle from '../../pages/DialogueModeToggle.js';
import type { DialogueMode } from '../../pages/dialogue-mode.js';
import { ContextUsageMeter } from './context-usage-meter.js';
import {
  ChatTodoFloatingPanel,
  ChatTopBarTodoSlot,
  type ChatTodoController,
} from '../session-conversation/runtime/todo-bar.js';

interface ChatTopBarProps {
  dialogueMode: DialogueMode;
  onChangeDialogueMode: (mode: DialogueMode) => void;
  yoloMode: boolean;
  onToggleYolo: () => void;
  editorMode: boolean;
  onToggleEditorMode: () => void;
  rightOpen: boolean;
  onToggleRightOpen: () => void;
  contextUsedTokens?: number;
  contextMaxTokens?: number;
  contextIsEstimated?: boolean;
  /**
   * Optional terminals chip (running terminal indicator + popover trigger).
   * Rendered inside the right-side pill so it sits next to the YOLO toggle
   * without forcing a layout shift when undefined.
   */
  terminalsChip?: ReactNode;
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
  /** Todo controller from upstream (shared with ChatTodoFloatingPanel). */
  todoController?: ChatTodoController;
  /** id for aria-controls linking the slot button to the floating panel. */
  todoDetailsId?: string;
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
  contextUsedTokens,
  contextMaxTokens,
  contextIsEstimated,
  terminalsChip,
  onOpenCommandPalette,
  bookmarkCount = 0,
  multiSelectActive = false,
  onToggleMultiSelect,
  onOpenBrowser,
  browserActive = false,
  todoController,
  todoDetailsId,
}: ChatTopBarProps) {
  const showContextMeter =
    contextUsedTokens != null && contextMaxTokens != null && contextMaxTokens > 0;

  // 测量自身宽度，决定 todo slot 是 compact（徽章）还是 full（摘要）。
  const barRef = useRef<HTMLDivElement>(null);
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
        flexWrap: 'wrap',
        padding: '6px 12px',
        borderBottom: '1px solid var(--border-subtle)',
        flexShrink: 0,
        background: 'var(--header-bg)',
        minHeight: 44,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minWidth: 0,
          flex: '1 1 420px',
          flexWrap: 'wrap',
        }}
      >
        <DialogueModeToggle
          mode={dialogueMode}
          onChange={onChangeDialogueMode}
          style={{ flexShrink: 0 }}
        />

        {/* Command palette trigger */}
        {onOpenCommandPalette && (
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
              color: 'var(--text-3)',
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
              color: 'var(--text-3)',
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
              color: multiSelectActive ? 'var(--accent)' : 'var(--text-3)',
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
        <div className="chat-todo-topbar-anchor">
          <ChatTopBarTodoSlot
            controller={todoController}
            detailsId={todoDetailsId}
            compact={isCompact}
          />
          <ChatTodoFloatingPanel controller={todoController} detailsId={todoDetailsId} />
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
          background: 'color-mix(in oklch, var(--surface) 80%, transparent)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        {showContextMeter ? (
          <>
            <ContextUsageMeter
              usedTokens={contextUsedTokens}
              maxTokens={contextMaxTokens}
              estimated={contextIsEstimated}
            />
            <div
              aria-hidden="true"
              style={{
                width: 1,
                height: 14,
                background: 'var(--border-subtle)',
                flexShrink: 0,
              }}
            />
          </>
        ) : null}
        {terminalsChip}
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
              ? 'color-mix(in srgb, #f59e0b 22%, var(--surface))'
              : 'transparent',
            color: yoloMode ? '#fbbf24' : 'var(--text-3)',
            boxShadow: yoloMode
              ? 'inset 0 0 0 1px color-mix(in srgb, #f59e0b 50%, var(--border))'
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
        <button
          type="button"
          onClick={onToggleEditorMode}
          title={editorMode ? '关闭编辑器' : '打开文件编辑器'}
          className={`icon-btn${editorMode ? ' active' : ''}`}
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
            onClick={onOpenBrowser}
            title="打开浏览器预览"
            className={`icon-btn${browserActive ? ' active' : ''}`}
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
      </div>
    </div>
  );
}
