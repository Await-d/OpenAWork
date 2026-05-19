import type { CSSProperties } from 'react';
import type { ArtifactItem } from './ArtifactList.js';

export interface ArtifactPreviewProps {
  artifact: ArtifactItem & { content?: string; url?: string };
  onDownload: () => void;
  onShare?: () => void;
  style?: CSSProperties;
}

export function ArtifactPreview({ artifact, onDownload, onShare, style }: ArtifactPreviewProps) {
  const isCode = artifact.type === 'code';
  const isImage = artifact.type === 'image';
  const isText = artifact.type === 'text';

  return (
    <div
      style={{
        background: 'var(--bg-overlay))',
        border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
        borderRadius: 10,
        padding: '1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        ...style,
      }}
    >
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--fg-default))',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {artifact.name}
        </span>
        <div style={{ display: 'flex', gap: 6, flex: '0 0 auto' }}>
          {onShare && (
            <button type="button" onClick={onShare} style={btnStyle('var(--fg-muted))')}>
              分享
            </button>
          )}
          <button type="button" onClick={onDownload} style={btnStyle('var(--accent))')}>
            下载
          </button>
        </div>
      </div>

      {isImage && artifact.url ? (
        <div
          style={{
            background: 'var(--bg-base))',
            borderRadius: 6,
            border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0.5rem',
            overflow: 'hidden',
          }}
        >
          <img
            src={artifact.url}
            alt={artifact.name}
            style={{ maxWidth: '100%', maxHeight: 320, borderRadius: 4, display: 'block' }}
          />
        </div>
      ) : (isText || isCode) && artifact.content !== undefined ? (
        <pre
          style={{
            margin: 0,
            padding: '0.75rem',
            background: 'var(--bg-base))',
            border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
            borderRadius: 6,
            fontSize: 12,
            fontFamily: 'monospace',
            color: 'var(--fg-default))',
            overflowX: 'auto',
            overflowY: 'auto',
            maxHeight: 320,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {artifact.content}
        </pre>
      ) : (
        <div
          style={{
            fontSize: 12,
            color: 'var(--fg-muted))',
            padding: '0.5rem 0',
            fontStyle: 'italic',
          }}
        >
          暂无预览。
        </div>
      )}
    </div>
  );
}

function btnStyle(color: string): CSSProperties {
  return {
    background: `rgba(99,102,241,0.1)`,
    color,
    border: `1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))`,
    borderRadius: 6,
    padding: '0.3rem 0.65rem',
    fontSize: 12,
    cursor: 'pointer',
    fontWeight: 600,
  };
}
