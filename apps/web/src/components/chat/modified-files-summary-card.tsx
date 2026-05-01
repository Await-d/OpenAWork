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
    <div
      data-chat-modified-summary="true"
      style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 12,
          color: 'var(--text-2)',
        }}
      >
        <span>{summary.title}</span>
        <span style={{ color: 'var(--text-3)', fontSize: 11 }}>
          {summary.files.length} 个文件 · +{totalAdditions} / -{totalDeletions}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {visibleFiles.map((file) => {
          const sourceLabel = formatSourceLabel(file.sourceKind);
          return (
            <div
              key={`${file.file}:${file.status ?? 'modified'}`}
              data-chat-modified-summary-file="true"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '3px 0',
                fontSize: 12,
              }}
            >
              <span
                style={{
                  color: 'var(--text-3)',
                  fontSize: 11,
                  fontWeight: 600,
                  minWidth: 28,
                }}
              >
                {formatStatusLabel(file.status)}
              </span>
              <span
                style={{
                  color: 'var(--text)',
                  fontSize: 12,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  flex: 1,
                  minWidth: 0,
                }}
                title={file.file}
              >
                {file.file}
              </span>
              {(sourceLabel || file.guaranteeLevel) && (
                <span style={{ fontSize: 10, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                  {[sourceLabel, file.guaranteeLevel].filter(Boolean).join(' · ')}
                </span>
              )}
              <span
                style={{
                  color: 'var(--text-3)',
                  fontSize: 11,
                  whiteSpace: 'nowrap',
                }}
              >
                +{file.additions} / -{file.deletions}
              </span>
            </div>
          );
        })}
        {hiddenCount > 0 && (
          <div style={{ fontSize: 11, color: 'var(--text-3)', padding: '2px 0' }}>
            另外还有 {hiddenCount} 个文件变更未展开。
          </div>
        )}
      </div>
    </div>
  );
}
