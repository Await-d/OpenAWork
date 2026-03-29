import type { CSSProperties } from 'react';

export interface ImagePreviewProps {
  src: string;
  alt?: string;
  caption?: string;
  onRemove?: () => void;
  maxWidth?: number;
  style?: CSSProperties;
}

export function ImagePreview({
  src,
  alt,
  caption,
  onRemove,
  maxWidth = 320,
  style,
}: ImagePreviewProps) {
  return (
    <div
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        gap: 4,
        position: 'relative',
        maxWidth,
        ...style,
      }}
    >
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: 'rgba(0,0,0,0.6)',
            border: 'none',
            color: '#fff',
            fontSize: 12,
            lineHeight: 1,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1,
          }}
        >
          ×
        </button>
      )}
      <img
        src={src}
        alt={alt ?? ''}
        style={{
          maxWidth: '100%',
          borderRadius: 8,
          border: '1px solid var(--color-border, #334155)',
          display: 'block',
        }}
      />
      {caption && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--color-muted, #94a3b8)',
            textAlign: 'center',
          }}
        >
          {caption}
        </div>
      )}
    </div>
  );
}
