import { getRoleLayerIdentity } from '../../data/role-layer-identity.js';
import type { HandoffEntry, TeamRoleLayer } from '../../../../../stores/team/team-events.js';
import { LayerFlowHandoffEntryRow } from './LayerFlowHandoffEntryRow.js';
import {
  COMPACT_CJK_LABEL_STYLE,
  HANDOFF_ROUTE_CHIP_STYLE,
  ROLE_SHORT_LABEL_STYLE,
  STATE_COLOR,
  STATE_LABELS,
} from './layer-flow-timeline-row-styles.js';

export interface SessionHandoffGroup {
  sessionId: string;
  entries: HandoffEntry[];
  toRoleLayer: TeamRoleLayer;
  fromRoleLayer: TeamRoleLayer;
  state: HandoffEntry['state'];
  summary: string | undefined;
  updatedAt: number;
}

interface SessionGroupRowProps {
  group: SessionHandoffGroup;
  expanded: boolean;
  onToggle: () => void;
  onSelectHandoff: (entry: HandoffEntry) => void;
  selectedHandoffId: string | null;
  toDisplayName?: string | null;
}

export function SessionGroupRow({
  group,
  expanded,
  onToggle,
  onSelectHandoff,
  selectedHandoffId,
  toDisplayName,
}: SessionGroupRowProps) {
  const toId = getRoleLayerIdentity(group.toRoleLayer);
  const fromId = getRoleLayerIdentity(group.fromRoleLayer);
  const color = STATE_COLOR[group.state] ?? 'var(--fg-muted)';
  const isSelected = group.entries.some((entry) => entry.id === selectedHandoffId);
  const targetDisplayName =
    typeof toDisplayName === 'string' && toDisplayName !== toId.short ? toDisplayName : undefined;

  const borderStyle = isSelected
    ? `1px solid color-mix(in srgb, ${color} 55%, transparent)`
    : '1px solid color-mix(in srgb, var(--border-default) 35%, transparent)';

  const backgroundStyle = isSelected
    ? `color-mix(in srgb, ${color} 8%, var(--bg-overlay))`
    : 'color-mix(in srgb, var(--bg-overlay) 75%, var(--bg-base))';

  return (
    <div style={{ display: 'grid', gap: 2 }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="team-card-soft"
        style={{
          textAlign: 'left',
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
          padding: '10px 10px 10px 12px',
          borderRadius: 'var(--radius-md, 8px)',
          border: borderStyle,
          background: backgroundStyle,
          cursor: 'pointer',
          width: '100%',
          minWidth: 0,
          position: 'relative',
          transition: 'border-color 0.15s, background 0.15s',
        }}
      >
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: 0,
            top: 8,
            bottom: 8,
            width: 3,
            borderRadius: 'var(--radius-pill, 9999px)',
            background: toId.color,
            opacity: isSelected ? 1 : 0.5,
          }}
        />
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            width: '100%',
            minWidth: 0,
            flexWrap: 'nowrap',
          }}
        >
          <span
            aria-hidden
            style={{
              fontSize: 9,
              color: 'var(--fg-subtle)',
              transition: 'transform 0.2s ease',
              transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 12,
              flexShrink: 0,
            }}
          >
            ▶
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--fg-strong)',
              ...HANDOFF_ROUTE_CHIP_STYLE,
            }}
            title={`${fromId.label} → ${toId.label}`}
          >
            <span aria-hidden style={{ fontSize: 12, flexShrink: 0 }}>
              {fromId.icon}
            </span>
            <span style={ROLE_SHORT_LABEL_STYLE}>{fromId.short}</span>
            <span aria-hidden style={{ color: 'var(--fg-muted)', fontSize: 11, flexShrink: 0 }}>
              →
            </span>
            <span aria-hidden style={{ fontSize: 12, flexShrink: 0 }}>
              {toId.icon}
            </span>
            <span style={ROLE_SHORT_LABEL_STYLE}>{toId.short}</span>
          </span>
        </span>
        {targetDisplayName ? (
          <span
            style={{
              fontSize: 9,
              fontWeight: 600,
              paddingLeft: 17,
              color: 'var(--fg-subtle)',
              maxWidth: '100%',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              wordBreak: 'keep-all',
              overflowWrap: 'normal',
            }}
            title={targetDisplayName}
          >
            {targetDisplayName}
          </span>
        ) : null}
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 4,
            paddingLeft: 17,
            minWidth: 0,
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              padding: '1px 7px',
              borderRadius: 'var(--radius-pill, 9999px)',
              background: `color-mix(in srgb, ${color} 14%, transparent)`,
              border: `1px solid color-mix(in srgb, ${color} 28%, transparent)`,
              color,
              ...COMPACT_CJK_LABEL_STYLE,
              minWidth: '3.6em',
            }}
          >
            {STATE_LABELS[group.state] ?? group.state}
          </span>
          <span
            style={{
              fontSize: 9,
              fontWeight: 600,
              color: 'var(--fg-subtle)',
              padding: '0 4px',
              borderRadius: 'var(--radius-sm, 4px)',
              background: 'color-mix(in srgb, var(--fg-subtle) 8%, transparent)',
              ...COMPACT_CJK_LABEL_STYLE,
              minWidth: '4.6em',
            }}
          >
            {group.entries.length} 条消息
          </span>
        </span>
        {!expanded && group.summary ? (
          <span
            style={{
              fontSize: 10,
              color: 'var(--fg-muted)',
              lineHeight: 1.45,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              paddingLeft: 17,
            }}
          >
            {group.summary}
          </span>
        ) : null}
        <span
          style={{
            fontSize: 9,
            color: 'var(--fg-subtle)',
            fontVariantNumeric: 'tabular-nums',
            paddingLeft: 17,
          }}
        >
          {new Date(group.updatedAt).toLocaleTimeString('zh-CN')}
        </span>
      </button>

      {expanded ? (
        <div
          style={{
            display: 'grid',
            gap: 3,
            paddingLeft: 16,
            paddingTop: 4,
            paddingBottom: 4,
            borderLeft: '2px solid color-mix(in srgb, var(--border-subtle) 50%, transparent)',
            marginLeft: 10,
          }}
        >
          {group.entries.map((entry) => (
            <LayerFlowHandoffEntryRow
              key={entry.id}
              entry={entry}
              onSelectHandoff={onSelectHandoff}
              selected={selectedHandoffId === entry.id}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
