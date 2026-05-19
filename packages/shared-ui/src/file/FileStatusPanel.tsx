import { color } from '../tokens.js';
import type { CSSProperties } from 'react';

export type FileChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface FileChange {
  path: string;
  status: FileChangeStatus;
  oldPath?: string;
  linesAdded?: number;
  linesDeleted?: number;
  diffSnippet?: string;
}

export interface FileStatusPanelProps {
  changes: FileChange[];
  onFileClick?: (filePath: string) => void;
  style?: CSSProperties;
}

const STATUS_COLOR: Record<FileChangeStatus, string> = {
  added: color.success,
  modified: 'var(--aux))',
  deleted: color.danger,
  renamed: color.contrast,
};

const STATUS_LABEL: Record<FileChangeStatus, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
};

export function FileStatusPanel({ changes, onFileClick, style }: FileStatusPanelProps) {
  if (changes.length === 0) {
    return (
      <div
        style={{
          padding: '0.75rem 1rem',
          color: 'var(--fg-muted))',
          fontSize: 12,
          ...style,
        }}
      >
        暂无文件变更
      </div>
    );
  }

  return (
    <div
      style={{
        border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
        borderRadius: 8,
        overflow: 'hidden',
        ...style,
      }}
    >
      <div
        style={{
          padding: '0.4rem 0.75rem',
          background: 'var(--bg-overlay))',
          borderBottom: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--fg-muted))',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
      >
        {changes.length} 个文件已变更
      </div>
      {changes.map((c, i) => (
        <button
          key={c.path}
          type="button"
          onClick={() => onFileClick?.(c.path)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0.45rem 0.75rem',
            background: 'transparent',
            border: 'none',
            borderTop:
              i > 0 ? '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))' : 'none',
            cursor: onFileClick ? 'pointer' : 'default',
            width: '100%',
            textAlign: 'left',
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: STATUS_COLOR[c.status],
              width: 12,
              flexShrink: 0,
            }}
          >
            {STATUS_LABEL[c.status]}
          </span>
          <span
            style={{
              fontSize: 12,
              fontFamily: 'monospace',
              color: 'var(--fg-strong))',
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {c.status === 'renamed' && c.oldPath ? `${c.oldPath} → ${c.path}` : c.path}
          </span>
          {(c.linesAdded !== undefined || c.linesDeleted !== undefined) && (
            <span style={{ fontSize: 10, flexShrink: 0 }}>
              {c.linesAdded !== undefined && (
                <span style={{ color: color.success }}>+{c.linesAdded}</span>
              )}
              {c.linesDeleted !== undefined && (
                <span style={{ color: color.danger, marginLeft: 4 }}>-{c.linesDeleted}</span>
              )}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
