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
        background: 'var(--color-surface, #1e293b)',
        border: '1px solid var(--color-border, #334155)',
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
            background: 'var(--color-bg, #0f172a)',
            border: '1px solid var(--color-border, #334155)',
            borderRadius: 20,
            fontSize: 11,
            color: 'var(--color-text, #f1f5f9)',
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
          <span style={{ color: 'var(--color-muted, #94a3b8)' }}>{fmtSize(a.sizeBytes)}</span>
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(a.id)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-muted, #94a3b8)',
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
            border: '1px dashed var(--color-border, #334155)',
            borderRadius: 20,
            fontSize: 11,
            color: 'var(--color-muted, #94a3b8)',
            cursor: 'pointer',
          }}
        >
          + 添加
        </button>
      )}
    </div>
  );
}
