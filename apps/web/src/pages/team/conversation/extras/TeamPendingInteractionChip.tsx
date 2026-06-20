import type { CSSProperties } from 'react';

export interface TeamPendingInteractionChipProps {
  pendingPermissionCount: number;
  pendingQuestionCount: number;
  onClick: () => void;
}

const BUTTON_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--warning) 42%, transparent)',
  background: 'color-mix(in srgb, var(--warning) 8%, var(--bg-overlay))',
  color: 'var(--warning)',
  fontSize: 11,
  fontWeight: 700,
  lineHeight: 1,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  boxShadow: '0 0 0 0 transparent',
};

const BADGE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 18,
  height: 18,
  padding: '0 5px',
  borderRadius: 999,
  background: 'var(--warning)',
  color: 'var(--fg-on-accent)',
  fontVariantNumeric: 'tabular-nums',
};

export function TeamPendingInteractionChip({
  pendingPermissionCount,
  pendingQuestionCount,
  onClick,
}: TeamPendingInteractionChipProps) {
  const totalCount = pendingPermissionCount + pendingQuestionCount;
  if (totalCount <= 0) {
    return null;
  }

  const labelParts = [];
  if (pendingPermissionCount > 0) {
    labelParts.push(`审批 ${pendingPermissionCount}`);
  }
  if (pendingQuestionCount > 0) {
    labelParts.push(`提问 ${pendingQuestionCount}`);
  }

  return (
    <button
      type="button"
      onClick={onClick}
      style={BUTTON_STYLE}
      title="查看当前会话里尚未处理的权限或提问"
      aria-label="查看待处理交互"
    >
      <span aria-hidden>⚠</span>
      <span>待处理</span>
      <span style={BADGE_STYLE}>{totalCount > 99 ? '99+' : totalCount}</span>
      <span style={{ color: 'var(--fg-default)', fontWeight: 600 }}>{labelParts.join(' · ')}</span>
    </button>
  );
}
