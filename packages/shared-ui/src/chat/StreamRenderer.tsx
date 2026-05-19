import type { CSSProperties } from 'react';

export interface StreamRendererProps {
  content: string;
  done?: boolean;
  style?: CSSProperties;
}

export function StreamRenderer({ content, done = false, style }: StreamRendererProps) {
  return (
    <div
      style={{
        maxWidth: '75%',
        alignSelf: 'flex-start',
        background: 'var(--bg-overlay, #121721)',
        border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
        borderRadius: 10,
        padding: '0.6rem 0.9rem',
        fontSize: 12,
        lineHeight: 1.6,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        opacity: done ? 1 : 0.85,
        ...style,
      }}
    >
      {content}
      {!done && (
        <span
          style={{
            display: 'inline-block',
            width: 8,
            height: 14,
            background: 'var(--fg-muted, #7b8a9e)',
            borderRadius: 2,
            marginLeft: 2,
            verticalAlign: 'middle',
          }}
        />
      )}
    </div>
  );
}
