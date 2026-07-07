import type { CSSProperties } from 'react';
import type { AgentTeamsSidebarTeam } from '../../data/team-runtime-types.js';
import {
  formatSidebarTeamStatus,
  resolveSidebarTeamSubtitle,
} from '../../data/team-runtime-status.js';

const STRIP_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'center',
  gap: 12,
  padding: '8px 10px',
  borderRadius: 10,
  border: '1px solid color-mix(in srgb, var(--accent) 20%, var(--border-default))',
  background: 'color-mix(in srgb, var(--accent) 7%, var(--bg-overlay))',
};

const COPY_STYLE: CSSProperties = {
  display: 'grid',
  gap: 3,
  minWidth: 0,
};

const LABEL_STYLE: CSSProperties = {
  color: 'var(--fg-muted)',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

const TITLE_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
};

const TITLE_STYLE: CSSProperties = {
  color: 'var(--fg-strong)',
  fontSize: 13,
  fontWeight: 800,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const SUBTITLE_STYLE: CSSProperties = {
  color: 'var(--fg-muted)',
  fontSize: 11,
  lineHeight: 1.35,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const STATUS_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 9px',
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 700,
  flexShrink: 0,
  whiteSpace: 'nowrap',
};

function resolveStatusColor(status: AgentTeamsSidebarTeam['status']): string {
  switch (status) {
    case 'idle':
      return 'var(--fg-subtle)';
    case 'running':
      return 'var(--success)';
    case 'paused':
      return 'var(--warning)';
    case 'failed':
      return 'var(--danger)';
    case 'completed':
      return 'var(--accent)';
    default:
      return 'var(--fg-muted)';
  }
}

export interface TeamSessionContextStripProps {
  readonly selectedTeam?: AgentTeamsSidebarTeam | null;
}

export function TeamSessionContextStrip({ selectedTeam }: TeamSessionContextStripProps) {
  const statusColor = selectedTeam ? resolveStatusColor(selectedTeam.status) : 'var(--aux)';
  const statusLabel = selectedTeam ? formatSidebarTeamStatus(selectedTeam.status) : '概览';
  const subtitle = selectedTeam
    ? resolveSidebarTeamSubtitle(selectedTeam.status, selectedTeam.subtitle)
    : '全局指标 · 活动时间线';
  const title = selectedTeam?.title ?? '团队工作区概览';
  const label = selectedTeam ? '当前会话' : '工作区';

  return (
    <section
      aria-label={selectedTeam ? '当前团队会话' : '团队工作区概览'}
      className="team-v2-session-context-strip"
      style={STRIP_STYLE}
    >
      <div style={COPY_STYLE}>
        <span style={LABEL_STYLE}>{label}</span>
        <div style={TITLE_ROW_STYLE}>
          <span title={title} style={TITLE_STYLE}>
            {title}
          </span>
        </div>
        {subtitle ? (
          <span
            className="team-v2-session-context-subtitle"
            title={subtitle}
            style={SUBTITLE_STYLE}
          >
            {subtitle}
          </span>
        ) : null}
      </div>
      <span
        className="team-v2-session-context-status"
        style={{
          ...STATUS_STYLE,
          background: `color-mix(in srgb, ${statusColor} 12%, transparent)`,
          border: `1px solid color-mix(in srgb, ${statusColor} 34%, transparent)`,
          color: statusColor,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: statusColor,
          }}
        />
        {statusLabel}
      </span>
    </section>
  );
}
