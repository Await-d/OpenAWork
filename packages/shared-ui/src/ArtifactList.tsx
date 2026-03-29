import type { CSSProperties } from 'react';

export type ArtifactType = 'text' | 'code' | 'image' | 'file';

export interface ArtifactItem {
  id: string;
  name: string;
  type: ArtifactType;
  size?: number;
  createdAt: number;
  sessionId: string;
}

export interface ArtifactListProps {
  artifacts: ArtifactItem[];
  onSelect: (id: string) => void;
  selectedId?: string;
  style?: CSSProperties;
}

const TYPE_ICON: Record<ArtifactType, string> = {
  text: '📄',
  code: '💻',
  image: '🖼️',
  file: '📦',
};

function formatSize(bytes?: number): string {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ArtifactList({ artifacts, onSelect, selectedId, style }: ArtifactListProps) {
  return (
    <div
      style={{
        background: 'var(--color-surface, #1e293b)',
        border: '1px solid var(--color-border, #334155)',
        borderRadius: 10,
        padding: '0.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        ...style,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--color-muted, #94a3b8)',
          textTransform: 'uppercase',
          letterSpacing: 0.8,
          marginBottom: 4,
        }}
      >
        产物
      </div>

      {artifacts.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--color-muted, #94a3b8)', padding: '0.25rem 0' }}>
          暂无产物。
        </div>
      ) : (
        artifacts.map((item) => {
          const isSelected = item.id === selectedId;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '0.4rem 0.6rem',
                background: isSelected ? 'rgba(99,102,241,0.15)' : 'var(--color-bg, #0f172a)',
                border: isSelected
                  ? '1px solid rgba(99,102,241,0.4)'
                  : '1px solid var(--color-border, #334155)',
                borderRadius: 6,
                cursor: 'pointer',
                textAlign: 'left',
                width: '100%',
              }}
            >
              <span style={{ fontSize: 14, flex: '0 0 auto' }}>{TYPE_ICON[item.type]}</span>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: 'var(--color-text, #e2e8f0)',
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {item.name}
              </span>
              {item.size !== undefined && (
                <span
                  style={{
                    fontSize: 10,
                    color: 'var(--color-muted, #94a3b8)',
                    flex: '0 0 auto',
                  }}
                >
                  {formatSize(item.size)}
                </span>
              )}
              <span
                style={{
                  fontSize: 10,
                  color: 'var(--color-muted, #94a3b8)',
                  flex: '0 0 auto',
                }}
              >
                {new Date(item.createdAt).toLocaleDateString()}
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}
