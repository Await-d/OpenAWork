import type { ArtifactVersionRecord } from '@openAwork/artifacts';
import { tokens } from '@openAwork/shared-ui';
import { formatArtifactTimestamp } from './artifact-workbench-utils.js';

interface ArtifactVersionTimelineProps {
  currentVersion: number;
  revertingVersionId: string | null;
  versions: ArtifactVersionRecord[];
  onRevert: (versionId: string) => void;
}

export function ArtifactVersionTimeline({
  currentVersion,
  revertingVersionId,
  versions,
  onRevert,
}: ArtifactVersionTimelineProps) {
  return (
    <section
      aria-label="版本时间线"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacing.sm,
        minWidth: 0,
      }}
    >
      <div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-3)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          Version Trail
        </div>
        <h3 style={{ margin: '6px 0 0', fontSize: 16, color: 'var(--text)' }}>版本历史</h3>
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: tokens.spacing.xs,
          padding: tokens.spacing.sm,
          borderRadius: tokens.radius.lg,
          border: `1px solid ${tokens.color.borderSubtle}`,
          background: 'color-mix(in oklch, var(--surface) 78%, transparent)',
          minHeight: 160,
        }}
      >
        {versions.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>还没有版本记录。</div>
        ) : (
          versions.map((version) => {
            const isCurrent = version.versionNumber === currentVersion;
            const disabled = isCurrent || revertingVersionId === version.id;
            return (
              <div
                key={version.id}
                style={{
                  display: 'flex',
                  gap: 10,
                  padding: '10px 0',
                  borderTop:
                    version === versions[0] ? 'none' : `1px solid ${tokens.color.borderSubtle}`,
                }}
              >
                <div
                  aria-hidden="true"
                  style={{
                    width: 10,
                    flexShrink: 0,
                    display: 'flex',
                    justifyContent: 'center',
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      marginTop: 5,
                      borderRadius: 999,
                      background: isCurrent ? 'var(--accent)' : 'var(--text-3)',
                    }}
                  />
                </div>
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0, flex: 1 }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      flexWrap: 'wrap',
                    }}
                  >
                    <div
                      style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
                    >
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
                        v{version.versionNumber}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-2)' }}>
                        {version.createdBy}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                        {formatArtifactTimestamp(version.createdAt)}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRevert(version.id)}
                      disabled={disabled}
                      style={{
                        height: 28,
                        padding: '0 10px',
                        borderRadius: tokens.radius.sm,
                        border: `1px solid ${tokens.color.borderSubtle}`,
                        background: disabled
                          ? 'color-mix(in oklch, var(--surface) 66%, transparent)'
                          : 'color-mix(in oklch, var(--surface) 86%, var(--bg) 14%)',
                        color: disabled ? 'var(--text-3)' : 'var(--text)',
                        fontSize: 11,
                        cursor: disabled ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {isCurrent
                        ? '当前版本'
                        : revertingVersionId === version.id
                          ? '恢复中…'
                          : '恢复'}
                    </button>
                  </div>
                  {version.createdByNote && (
                    <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5 }}>
                      {version.createdByNote}
                    </div>
                  )}
                  <pre
                    style={{
                      margin: 0,
                      padding: '8px 10px',
                      borderRadius: tokens.radius.sm,
                      background: 'color-mix(in oklch, var(--surface) 64%, transparent)',
                      color: 'var(--text-2)',
                      fontSize: 11,
                      lineHeight: 1.5,
                      whiteSpace: 'pre-wrap',
                      overflowWrap: 'anywhere',
                      maxHeight: 96,
                      overflow: 'hidden',
                    }}
                  >
                    {version.content.slice(0, 180)}
                    {version.content.length > 180 ? '…' : ''}
                  </pre>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
