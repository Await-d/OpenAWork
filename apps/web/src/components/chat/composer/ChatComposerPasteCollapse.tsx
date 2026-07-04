/**
 * ChatComposerPasteCollapse — 粘贴大文本折叠面板
 */

export interface ChatComposerPasteCollapseProps {
  pasteCollapsed: { text: string; lineCount: number };
  pastePreviewExpanded: boolean;
  onToggleExpand: () => void;
  onInsert: () => void;
  onDiscard: () => void;
}

export function ChatComposerPasteCollapse({
  pasteCollapsed,
  pastePreviewExpanded,
  onToggleExpand,
  onInsert,
  onDiscard,
}: ChatComposerPasteCollapseProps) {
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
          <pre
            style={{
              margin: 0,
              fontSize: 10,
              lineHeight: 1.5,
              color: 'var(--fg-muted)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontFamily: 'inherit',
            }}
          >
            {pasteCollapsed.text.slice(0, 2000)}
            {pasteCollapsed.text.length > 2000 && '\n…（仅显示前 2000 字符）'}
          </pre>
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
          onClick={onInsert}
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
          插入原文
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
