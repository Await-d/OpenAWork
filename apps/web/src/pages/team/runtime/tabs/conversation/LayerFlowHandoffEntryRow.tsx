import type { HandoffEntry } from '../../../../../stores/team/team-events.js';
import {
  COMPACT_CJK_LABEL_STYLE,
  STATE_COLOR,
  STATE_LABELS,
} from './layer-flow-timeline-row-styles.js';

interface LayerFlowHandoffEntryRowProps {
  entry: HandoffEntry;
  onSelectHandoff: (entry: HandoffEntry) => void;
  selected: boolean;
}

export function LayerFlowHandoffEntryRow({
  entry,
  onSelectHandoff,
  selected,
}: LayerFlowHandoffEntryRowProps) {
  const color = STATE_COLOR[entry.state] ?? 'var(--fg-muted)';

  const borderStyle = selected
    ? `1px solid color-mix(in srgb, ${color} 45%, var(--border-default) 55%)`
    : '1px solid color-mix(in srgb, var(--border-default) 25%, transparent)';

  const backgroundStyle = selected
    ? 'white'
    : 'color-mix(in srgb, var(--bg-overlay) 50%, var(--bg-base))';

  return (
    <button
      type="button"
      onClick={(ev) => {
        ev.stopPropagation();
        onSelectHandoff(entry);
      }}
      className="team-card-soft"
      style={{
        textAlign: 'left',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        padding: '6px 8px 6px 10px',
        borderRadius: 'var(--radius-sm, 6px)',
        border: borderStyle,
        background: backgroundStyle,
        boxShadow: selected ? 'var(--shadow-md)' : 'none',
        cursor: 'pointer',
        width: '100%',
        minWidth: 0,
        transition: 'border-color 0.12s, background 0.12s, box-shadow 0.12s',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            padding: '0 5px',
            borderRadius: 'var(--radius-pill, 9999px)',
            background: `color-mix(in srgb, ${color} 12%, transparent)`,
            border: `1px solid color-mix(in srgb, ${color} 22%, transparent)`,
            color,
            ...COMPACT_CJK_LABEL_STYLE,
            minWidth: '3.6em',
          }}
        >
          {STATE_LABELS[entry.state] ?? entry.state}
        </span>
        {entry.summary ? (
          <span
            style={{
              fontSize: 10,
              color: 'var(--fg-default)',
              lineHeight: 1.35,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              minWidth: 0,
            }}
            title={entry.summary}
          >
            {entry.summary}
          </span>
        ) : (
          <span style={{ flex: 1, fontSize: 10, color: 'var(--fg-subtle)' }}>（无摘要）</span>
        )}
      </span>
      <span
        style={{
          fontSize: 8,
          color: 'var(--fg-subtle)',
          fontVariantNumeric: 'tabular-nums',
          paddingLeft: 2,
        }}
      >
        {new Date(entry.updatedAt).toLocaleTimeString('zh-CN')}
      </span>
    </button>
  );
}
