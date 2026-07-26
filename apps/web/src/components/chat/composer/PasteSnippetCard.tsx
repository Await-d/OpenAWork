import { useEffect, useState } from 'react';

/**
 * PasteSnippetCard — 粘贴大文本时在输入框内部显示的紧凑小标签。
 *
 * 外观是一个 inline-flex 的胶囊形 badge，只占自身内容宽度，
 * 不占据整行。粘贴的完整文本存储在外部 state 中，不进入
 * textarea value。点击 badge 可展开编辑面板。
 */

export interface PasteSnippetCardProps {
  /** 粘贴的原始文本 */
  text: string;
  /** 行数 */
  lineCount: number;
  /** 是否展开编辑面板 */
  expanded: boolean;
  /** 展开/收起切换 */
  onToggleExpand: () => void;
  /** 更新文本内容 */
  onUpdateText: (text: string) => void;
  /** 丢弃粘贴内容 */
  onDiscard: () => void;
}

export function PasteSnippetCard({
  text,
  lineCount,
  expanded,
  onToggleExpand,
  onUpdateText,
  onDiscard,
}: PasteSnippetCardProps) {
  const [draft, setDraft] = useState(text);

  useEffect(() => {
    setDraft(text);
  }, [text]);

  const charCount = text.length > 999 ? `${Math.round(text.length / 100) / 10}k` : `${text.length}`;

  return (
    <div
      style={{ marginBottom: 4, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4 }}
    >
      {/* 紧凑胶囊标签 */}
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          padding: '1px 6px 1px 4px',
          borderRadius: 'var(--radius-pill)',
          background: 'color-mix(in oklch, var(--aux) 10%, transparent)',
          border: '1px solid color-mix(in oklch, var(--aux) 25%, var(--border-subtle))',
          fontSize: 9.5,
          lineHeight: 1.6,
          whiteSpace: 'nowrap',
          width: 'fit-content',
          maxWidth: '100%',
          transition: 'border-color 150ms ease, background 150ms ease',
        }}
      >
        {/* 粘贴图标 */}
        <svg
          width="9"
          height="9"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--aux)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
          aria-hidden="true"
        >
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
          <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
        </svg>

        {/* 点击展开 */}
        <button
          type="button"
          onClick={onToggleExpand}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 2,
            border: 'none',
            background: 'transparent',
            color: 'var(--aux)',
            cursor: 'pointer',
            fontSize: 9.5,
            fontWeight: 600,
            padding: 0,
            appearance: 'none',
            flexShrink: 0,
            transition: 'color 150ms ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--accent)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--aux)';
          }}
        >
          {lineCount}行 / {charCount}字符
        </button>

        {/* 丢弃 */}
        <button
          type="button"
          onClick={onDiscard}
          aria-label="移除粘贴内容"
          title="移除"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 12,
            height: 12,
            border: 'none',
            background: 'transparent',
            color: 'var(--fg-subtle)',
            cursor: 'pointer',
            flexShrink: 0,
            padding: 0,
            appearance: 'none',
            borderRadius: 'var(--radius-pill)',
            transition: 'color 150ms ease, background 150ms ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--complement)';
            e.currentTarget.style.background =
              'color-mix(in oklch, var(--complement) 14%, transparent)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--fg-subtle)';
            e.currentTarget.style.background = 'transparent';
          }}
        >
          <svg
            width="8"
            height="8"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* 展开后的编辑面板 */}
      {expanded && (
        <textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            onUpdateText(e.target.value);
          }}
          aria-label="编辑粘贴文本"
          style={{
            width: '100%',
            minHeight: 80,
            maxHeight: 160,
            fontSize: 10,
            lineHeight: 1.5,
            color: 'var(--fg-default)',
            background: 'var(--bg-overlay)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-xs)',
            padding: '4px 6px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: 'var(--font-mono, monospace)',
            resize: 'vertical',
            outline: 'none',
          }}
        />
      )}
    </div>
  );
}
