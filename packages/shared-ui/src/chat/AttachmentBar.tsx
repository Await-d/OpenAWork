import type { CSSProperties } from 'react';

export interface AttachmentItem {
  id: string;
  name: string;
  type: 'image' | 'audio' | 'file';
  sizeBytes: number;
}

export interface AttachmentBarProps {
  attachments: AttachmentItem[];
  onRemove?: (id: string) => void;
  onAdd?: () => void;
  style?: CSSProperties;
}

const TYPE_ICON: Record<AttachmentItem['type'], string> = {
  image: '🖼',
  audio: '🎵',
  file: '📎',
};

function fmtSize(b: number): string {
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)}KB`;
  return `${(b / (1024 * 1024)).toFixed(1)}MB`;
}

export function AttachmentBar({ attachments, onRemove, onAdd, style }: AttachmentBarProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flexWrap: 'wrap',
        padding: '0.4rem 0.6rem',
        background: 'var(--bg-overlay, #121721)',
        border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
        borderRadius: 8,
        ...style,
      }}
    >
      {attachments.map((a) => (
        <span
          key={a.id}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 8px',
            background: 'var(--bg-base, #080b12)',
            border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
            borderRadius: 20,
            fontSize: 11,
            color: 'var(--fg-strong, #f1f4f8)',
          }}
        >
          <span>{TYPE_ICON[a.type]}</span>
          <span
            style={{
              maxWidth: 100,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {a.name}
          </span>
          <span style={{ color: 'var(--fg-muted, #7b8a9e)' }}>{fmtSize(a.sizeBytes)}</span>
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(a.id)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--fg-muted, #7b8a9e)',
                fontSize: 12,
                lineHeight: 1,
                padding: 0,
                marginLeft: 2,
              }}
            >
              ×
            </button>
          )}
        </span>
      ))}
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 10px',
            background: 'none',
            border: '1px dashed var(--border-default, hsla(215, 18%, 50%, 0.12))',
            borderRadius: 20,
            fontSize: 11,
            color: 'var(--fg-muted, #7b8a9e)',
            cursor: 'pointer',
          }}
        >
          + 添加
        </button>
      )}
    </div>
  );
}
