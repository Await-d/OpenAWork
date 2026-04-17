import DialogueModeToggle from '../../pages/DialogueModeToggle.js';
import type { DialogueMode } from '../../pages/dialogue-mode.js';
import { ContextUsageMeter } from './context-usage-meter.js';

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
}

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
}: ChatTopBarProps) {
  const showContextMeter =
    contextUsedTokens != null && contextMaxTokens != null && contextMaxTokens > 0;
  return (
    <div
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
      </div>

      {/* Right group: YOLO + editor + panel — unified pill container */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          marginLeft: 'auto',
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
