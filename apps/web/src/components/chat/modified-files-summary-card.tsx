import type { FileDiffContent, ModifiedFilesSummaryContent } from '@openAwork/shared';

const MAX_VISIBLE_FILES = 6;

function formatStatusLabel(status: FileDiffContent['status']): string {
  if (status === 'added') return '新增';
  if (status === 'deleted') return '删除';
  return '修改';
}

function formatSourceLabel(sourceKind: FileDiffContent['sourceKind']): string | null {
  if (sourceKind === 'structured_tool_diff') return '工具';
  if (sourceKind === 'workspace_reconcile') return '工作区';
  if (sourceKind === 'restore_replay') return '恢复';
  if (sourceKind === 'manual_revert') return '回退';
  if (sourceKind === 'session_snapshot') return '快照';
  return null;
}

export function ModifiedFilesSummaryCard({ summary }: { summary: ModifiedFilesSummaryContent }) {
  if (summary.files.length === 0) {
    return null;
  }

  const totalAdditions = summary.files.reduce((sum, file) => sum + file.additions, 0);
  const totalDeletions = summary.files.reduce((sum, file) => sum + file.deletions, 0);
  const visibleFiles = summary.files.slice(0, MAX_VISIBLE_FILES);
  const hiddenCount = summary.files.length - visibleFiles.length;

  return (
    <section
      data-chat-modified-summary="true"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '12px 14px',
        borderRadius: 14,
        border: '1px solid color-mix(in oklch, var(--accent) 16%, var(--border) 84%)',
        background:
          'linear-gradient(180deg, color-mix(in oklch, var(--accent) 8%, var(--surface) 92%), color-mix(in oklch, var(--surface) 92%, var(--bg-2) 8%))',
        boxShadow: '0 10px 24px rgba(15, 23, 42, 0.08)',
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'color-mix(in oklch, var(--accent) 74%, var(--text) 26%)',
            }}
          >
            变更记录
          </span>
          <strong style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.4 }}>
            {summary.title}
          </strong>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>
            {summary.summary}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[`${summary.files.length} 个文件`, `+${totalAdditions}`, `-${totalDeletions}`].map(
            (label) => (
              <span
                key={label}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  height: 22,
                  padding: '0 9px',
                  borderRadius: 999,
                  background: 'color-mix(in oklch, var(--surface) 84%, var(--accent) 16%)',
                  border: '1px solid color-mix(in oklch, var(--accent) 12%, var(--border) 88%)',
                  color: 'var(--text)',
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {label}
              </span>
            ),
          )}
        </div>
      </header>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {visibleFiles.map((file) => {
          const sourceLabel = formatSourceLabel(file.sourceKind);
          return (
            <div
              key={`${file.file}:${file.status ?? 'modified'}`}
              data-chat-modified-summary-file="true"
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto minmax(0, 1fr) auto',
                gap: 8,
                alignItems: 'center',
                padding: '8px 10px',
                borderRadius: 10,
                background: 'color-mix(in oklch, var(--surface) 90%, transparent)',
                border: '1px solid color-mix(in oklch, var(--border) 72%, transparent)',
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: 42,
                  height: 22,
                  padding: '0 8px',
                  borderRadius: 999,
                  background: 'color-mix(in oklch, var(--accent) 12%, transparent)',
                  color: 'color-mix(in oklch, var(--accent) 70%, var(--text) 30%)',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                }}
              >
                {formatStatusLabel(file.status)}
              </span>
              <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span
                  style={{
                    color: 'var(--text)',
                    fontSize: 12,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  title={file.file}
                >
                  {file.file}
                </span>
                {(sourceLabel || file.guaranteeLevel) && (
                  <span style={{ fontSize: 10, color: 'var(--text-3)' }}>
                    {[sourceLabel, file.guaranteeLevel].filter(Boolean).join(' · ')}
                  </span>
                )}
              </div>
              <span
                style={{
                  color: 'var(--text-2)',
                  fontSize: 11,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
              >
                +{file.additions} / -{file.deletions}
              </span>
            </div>
          );
        })}
        {hiddenCount > 0 && (
          <div
            style={{
              fontSize: 11,
              color: 'var(--text-3)',
              paddingLeft: 4,
            }}
          >
            另外还有 {hiddenCount} 个文件变更未展开。
          </div>
        )}
      </div>
    </section>
  );
}
