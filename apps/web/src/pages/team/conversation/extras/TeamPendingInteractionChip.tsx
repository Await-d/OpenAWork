import type { CSSProperties } from 'react';

export interface TeamPendingInteractionChipProps {
  pendingPermissionCount: number;
  /** 待回答的 team 澄清数（来自 useClarificationStore，不再计 question_requests）。 */
  pendingClarificationCount: number;
  onClick: () => void;
}

const BUTTON_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 10px',
  borderRadius: 8,
  color: 'var(--warning)',
  fontSize: 11,
  fontWeight: 700,
  lineHeight: 1,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
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
  pendingClarificationCount,
  onClick,
}: TeamPendingInteractionChipProps) {
  const totalCount = pendingPermissionCount + pendingClarificationCount;
  if (totalCount <= 0) {
    return null;
  }

  const labelParts = [];
  if (pendingPermissionCount > 0) {
    labelParts.push(`审批 ${pendingPermissionCount}`);
  }
  if (pendingClarificationCount > 0) {
    labelParts.push(`澄清 ${pendingClarificationCount}`);
  }

  return (
    <button
      type="button"
      className="team-v2-control team-v2-control--warning-soft"
      onClick={onClick}
      style={BUTTON_STYLE}
      title="查看当前会话里尚未处理的权限或澄清"
      aria-label="查看待处理交互"
    >
      <span aria-hidden>⚠</span>
      <span>待处理</span>
      <span style={BADGE_STYLE}>{totalCount > 99 ? '99+' : totalCount}</span>
      <span style={{ color: 'var(--fg-default)', fontWeight: 600 }}>{labelParts.join(' · ')}</span>
    </button>
  );
}
