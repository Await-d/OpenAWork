import type { ArtifactRecord } from '@openAwork/artifacts';
import { tokens } from '@openAwork/shared-ui';
import {
  formatArtifactTimestamp,
  formatArtifactTypeLabel,
} from '../workspace/artifact-workbench-utils.js';

interface ArtifactRecordListProps {
  artifacts: ArtifactRecord[];
  loading: boolean;
  selectedArtifactId: string | null;
  onCreateHtml: () => void;
  onCreateMarkdown: () => void;
  onSelect: (artifactId: string) => void;
}

export function ArtifactRecordList({
  artifacts,
  loading,
  selectedArtifactId,
  onCreateHtml,
  onCreateMarkdown,
  onSelect,
}: ArtifactRecordListProps) {
  return (
    <section
      aria-label="产物列表"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacing.sm,
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: tokens.spacing.sm,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--fg-muted)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            Artifact Stack
          </div>
          <h2
            style={{
              margin: '6px 0 0',
              fontSize: 18,
              color: 'var(--fg-strong)',
              textWrap: 'balance',
            }}
          >
            当前会话产物
          </h2>
        </div>
        <div style={{ display: 'flex', gap: tokens.spacing.xs, flexWrap: 'wrap' }}>
          <button type="button" onClick={onCreateMarkdown} style={ghostButtonStyle}>
            新建 Markdown
          </button>
          <button type="button" onClick={onCreateHtml} style={primaryButtonStyle}>
            新建 HTML
          </button>
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: tokens.spacing.xs,
          padding: tokens.spacing.sm,
          borderRadius: tokens.radius.lg,
          border: `1px solid ${tokens.color.borderSubtle}`,
          background: 'var(--bg-overlay)',
          boxShadow: tokens.shadow.sm,
          minHeight: 260,
        }}
      >
        {loading ? (
          <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>加载产物…</div>
        ) : artifacts.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.6 }}>
            这个会话还没有内容型 artifact。可以在这里新建，也可以稍后把聊天流中的产物提取接进来。
          </div>
        ) : (
          artifacts.map((artifact) => {
            const selected = artifact.id === selectedArtifactId;
            return (
              <button
                key={artifact.id}
                type="button"
                onClick={() => onSelect(artifact.id)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 11px',
                  borderRadius: tokens.radius.md,
                  border: selected
                    ? '1px solid color-mix(in oklch, var(--accent) 40%, var(--border-default)'
                    : `1px solid ${tokens.color.borderSubtle}`,
                  background: selected
                    ? 'color-mix(in oklch, var(--accent) 14%, var(--bg-overlay) 86%)'
                    : 'var(--bg-overlay)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span
                    style={{
                      fontSize: 10,
                      lineHeight: 1,
                      padding: '3px 6px',
                      borderRadius: 999,
                      background: 'color-mix(in oklch, var(--accent) 14%, transparent)',
                      color: 'var(--accent)',
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {formatArtifactTypeLabel(artifact.type)}
                  </span>
                  <span
                    style={{
                      fontSize: 13,
                      color: 'var(--fg-strong)',
                      fontWeight: 700,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={artifact.title}
                  >
                    {artifact.title}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: 'var(--fg-default)' }}>
                    v{artifact.version}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                    {formatArtifactTimestamp(artifact.updatedAt)}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}

const primaryButtonStyle: React.CSSProperties = {
  height: 34,
  padding: '0 12px',
  borderRadius: tokens.radius.md,
  border: 'none',
  background: 'var(--accent)',
  color: 'var(--fg-on-accent)',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
};

const ghostButtonStyle: React.CSSProperties = {
  height: 34,
  padding: '0 12px',
  borderRadius: tokens.radius.md,
  border: `1px solid ${tokens.color.borderSubtle}`,
  background: 'var(--bg-overlay)',
  color: 'var(--fg-strong)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};
