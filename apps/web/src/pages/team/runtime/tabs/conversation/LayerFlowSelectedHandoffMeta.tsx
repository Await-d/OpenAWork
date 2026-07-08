import type { HandoffEntry } from '../../../../../stores/team/team-events.js';
import { getRoleLayerIdentity } from '../../data/role-layer-identity.js';
import { STATE_COLOR, STATE_LABELS } from './layer-flow-state.js';

interface LayerFlowSelectedHandoffMetaProps {
  entry: HandoffEntry;
}

export function LayerFlowSelectedHandoffMeta({ entry }: LayerFlowSelectedHandoffMetaProps) {
  return (
    <span
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 11,
        color: 'var(--fg-muted)',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          padding: '2px 6px',
          borderRadius: 'var(--radius-sm, 6px)',
          background: 'color-mix(in srgb, var(--bg-hover) 60%, transparent)',
          fontSize: 10,
          fontWeight: 600,
        }}
      >
        <span>{getRoleLayerIdentity(entry.fromRoleLayer).short}</span>
        <span aria-hidden style={{ color: 'var(--fg-subtle)' }}>
          →
        </span>
        <span>{getRoleLayerIdentity(entry.toRoleLayer).short}</span>
      </span>
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          padding: '1px 7px',
          borderRadius: 'var(--radius-pill, 9999px)',
          background: `color-mix(in srgb, ${STATE_COLOR[entry.state]} 14%, transparent)`,
          border: `1px solid color-mix(in srgb, ${STATE_COLOR[entry.state]} 28%, transparent)`,
          color: STATE_COLOR[entry.state],
        }}
      >
        {STATE_LABELS[entry.state] ?? entry.state}
      </span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
        {new Date(entry.updatedAt).toLocaleTimeString('zh-CN')}
      </span>
    </span>
  );
}
