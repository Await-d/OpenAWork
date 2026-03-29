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
        background: 'var(--color-surface, #1e293b)',
        border: '1px solid var(--color-border, #334155)',
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
            color: 'var(--color-text, #e2e8f0)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {artifact.name}
        </span>
        <div style={{ display: 'flex', gap: 6, flex: '0 0 auto' }}>
          {onShare && (
            <button type="button" onClick={onShare} style={btnStyle('var(--color-muted, #94a3b8)')}>
              分享
            </button>
          )}
          <button type="button" onClick={onDownload} style={btnStyle('#6366f1')}>
            下载
          </button>
        </div>
      </div>

      {isImage && artifact.url ? (
        <div
          style={{
            background: 'var(--color-bg, #0f172a)',
            borderRadius: 6,
            border: '1px solid var(--color-border, #334155)',
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
            background: 'var(--color-bg, #0f172a)',
            border: '1px solid var(--color-border, #334155)',
            borderRadius: 6,
            fontSize: 12,
            fontFamily: 'monospace',
            color: 'var(--color-text, #e2e8f0)',
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
            color: 'var(--color-muted, #94a3b8)',
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
    border: `1px solid var(--color-border, #334155)`,
    borderRadius: 6,
    padding: '0.3rem 0.65rem',
    fontSize: 12,
    cursor: 'pointer',
    fontWeight: 600,
  };
}
