import type { CSSProperties } from 'react';

const BAR_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 26,
  padding: '0 10px',
  borderRadius: 0,
  borderBottom: '1px solid color-mix(in srgb, var(--warning) 35%, var(--border-default))',
  background: 'color-mix(in srgb, var(--warning) 8%, var(--bg-raised, var(--bg-overlay)))',
  color: 'var(--fg-muted)',
  fontSize: 11,
};

const BADGE_STYLE: CSSProperties = {
  color: 'var(--warning)',
  fontWeight: 750,
  fontSize: 10,
  whiteSpace: 'nowrap',
  flexShrink: 0,
};

const TITLE_STYLE: CSSProperties = {
  color: 'var(--fg-strong)',
  fontWeight: 650,
  fontSize: 11,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  flex: '1 1 auto',
  minWidth: 0,
};

const HINT_STYLE: CSSProperties = {
  fontSize: 10.5,
  color: 'var(--fg-muted)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: 240,
  // flex:1（basis 0）会让标题独占收缩预算把提示压成 0 宽；basis auto + minWidth 兜底保证提示恒可见。
  flex: '0 1 auto',
  minWidth: 120,
};

/**
 * 「待你处理」标签的可见字符上限。
 *
 * 失败态的标签来自 handoff `summary`，实测可达 2784px 宽。若整个摘要都交给
 * 省略号裁剪，用户看到的是一段任意长度的摘要切片，指针语义很弱；这里按字符数
 * 截断成一个可读标签，完整原文仍由 `title` 属性承载（悬停可见）。
 */
export const ATTENTION_TITLE_MAX_LENGTH = 80;

export function truncateAttentionTitle(title: string): string {
  if (title.length <= ATTENTION_TITLE_MAX_LENGTH) {
    return title;
  }
  return `${title.slice(0, ATTENTION_TITLE_MAX_LENGTH)}…`;
}

const JUMP_BTN_STYLE: CSSProperties = {
  appearance: 'none',
  border: '1px solid color-mix(in srgb, var(--warning) 35%, var(--border-default))',
  color: 'var(--warning)',
  minHeight: 20,
  padding: '0 8px',
  fontSize: 10.5,
  fontWeight: 700,
  cursor: 'pointer',
  flexShrink: 0,
};

const COUNT_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 16,
  height: 16,
  padding: '0 5px',
  borderRadius: 999,
  border: '1px solid color-mix(in srgb, var(--warning) 42%, transparent)',
  background: 'color-mix(in srgb, var(--warning) 18%, transparent)',
  color: 'var(--warning)',
  fontSize: 10,
  fontWeight: 750,
  fontVariantNumeric: 'tabular-nums',
  flexShrink: 0,
};

export interface TeamAttentionBarProps {
  show: boolean;
  title: string;
  hint?: string;
  /** 待处理条数（与澄清面板同一 store 口径）：>0 时在标签后显示计数徽标。 */
  count?: number;
  onJump?: () => void;
}

export function TeamAttentionBar({ show, title, hint, count, onJump }: TeamAttentionBarProps) {
  if (!show) return null;

  return (
    <div style={BAR_STYLE}>
      <span style={BADGE_STYLE}>待你处理</span>
      {count !== undefined && count > 0 ? <span style={COUNT_STYLE}>{count}</span> : null}
      <strong style={TITLE_STYLE} title={title}>
        {truncateAttentionTitle(title)}
      </strong>
      {hint != null && hint !== '' ? (
        <span style={HINT_STYLE} title={hint}>
          {hint}
        </span>
      ) : (
        <span style={{ flex: 1 }} />
      )}
      {onJump != null ? (
        <button
          type="button"
          className="team-v2-control team-v2-control--transparent"
          style={JUMP_BTN_STYLE}
          onClick={onJump}
        >
          查看
        </button>
      ) : null}
    </div>
  );
}
