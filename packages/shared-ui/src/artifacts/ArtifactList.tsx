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
        background: 'var(--bg-overlay)',
        border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
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
          color: 'var(--fg-muted)',
          textTransform: 'uppercase',
          letterSpacing: 0.8,
          marginBottom: 4,
        }}
      >
        产物
      </div>

      {artifacts.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--fg-muted)', padding: '0.25rem 0' }}>
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
                background: isSelected ? 'var(--bg-raised)' : 'var(--bg-base)',
                border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
                boxShadow: isSelected ? 'var(--shadow-md)' : 'none',
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
                  color: 'var(--fg-default)',
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
                    color: 'var(--fg-muted)',
                    flex: '0 0 auto',
                  }}
                >
                  {formatSize(item.size)}
                </span>
              )}
              <span
                style={{
                  fontSize: 10,
                  color: 'var(--fg-muted)',
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
