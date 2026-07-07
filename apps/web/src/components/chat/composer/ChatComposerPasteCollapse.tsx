import { useEffect, useState } from 'react';

/**
 * ChatComposerPasteCollapse — 粘贴大文本折叠面板
 */

export interface ChatComposerPasteCollapseProps {
  pasteCollapsed: { text: string; lineCount: number };
  pastePreviewExpanded: boolean;
  onToggleExpand: () => void;
  onInsert: (text: string) => void;
  onDiscard: () => void;
}

export function ChatComposerPasteCollapse({
  pasteCollapsed,
  pastePreviewExpanded,
  onToggleExpand,
  onInsert,
  onDiscard,
}: ChatComposerPasteCollapseProps) {
  const [draft, setDraft] = useState(pasteCollapsed.text);

  useEffect(() => {
    setDraft(pasteCollapsed.text);
  }, [pasteCollapsed.text]);

  return (
    <div
      style={{
        border: '1px solid color-mix(in oklch, var(--aux) 25%, var(--border-subtle))',
        borderRadius: 8,
        background: 'color-mix(in oklch, var(--aux) 5%, transparent)',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      <button
        type="button"
        onClick={onToggleExpand}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 8px',
          border: 'none',
          background: 'transparent',
          color: 'var(--fg-default)',
          cursor: 'pointer',
          fontSize: 10,
          fontWeight: 500,
          textAlign: 'left',
        }}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            transform: pastePreviewExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 200ms ease',
            flexShrink: 0,
          }}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span style={{ color: 'var(--aux)', fontWeight: 600 }}>粘贴的文本</span>
        <span style={{ color: 'var(--fg-muted)' }}>
          · {pasteCollapsed.lineCount} 行 · {pasteCollapsed.text.length.toLocaleString()} 字符
        </span>
      </button>
      {pastePreviewExpanded && (
        <div
          style={{
            padding: '6px 8px',
            borderTop: '1px solid var(--border-subtle)',
            maxHeight: 160,
            overflowY: 'auto',
          }}
        >
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-label="编辑粘贴文本"
            style={{
              width: '100%',
              minHeight: 120,
              fontSize: 10,
              lineHeight: 1.5,
              color: 'var(--fg-default)',
              background: 'var(--bg-overlay)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 6,
              padding: '6px 8px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontFamily: 'inherit',
              resize: 'vertical',
            }}
          />
        </div>
      )}
      <div
        style={{
          display: 'flex',
          gap: 6,
          padding: '4px 8px',
          borderTop: '1px solid var(--border-subtle)',
        }}
      >
        <button
          type="button"
          onClick={() => onInsert(draft)}
          style={{
            border: '1px solid color-mix(in oklch, var(--accent) 25%, var(--border-subtle))',
            borderRadius: 6,
            background: 'color-mix(in oklch, var(--accent) 8%, transparent)',
            color: 'var(--accent)',
            cursor: 'pointer',
            padding: '2px 8px',
            fontSize: 10,
            fontWeight: 600,
          }}
        >
          {draft === pasteCollapsed.text ? '插入原文' : '插入编辑后文本'}
        </button>
        <button
          type="button"
          onClick={onDiscard}
          style={{
            border: '1px solid var(--border-subtle)',
            borderRadius: 6,
            background: 'transparent',
            color: 'var(--fg-muted)',
            cursor: 'pointer',
            padding: '2px 8px',
            fontSize: 10,
          }}
        >
          丢弃
        </button>
      </div>
    </div>
  );
}
