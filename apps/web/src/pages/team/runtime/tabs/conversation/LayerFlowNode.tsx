import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { getRoleLayerIdentity } from '../../data/role-layer-identity.js';
import type { LayerNodeView } from './LayerFlowPipeline.js';
import { STATE_COLOR, STATE_LABELS } from './layer-flow-state.js';

interface LayerFlowNodeProps {
  onSelect: () => void;
  selected: boolean;
  view: LayerNodeView;
}

type FlowNodeStyle = CSSProperties & {
  '--team-flow-glow': string;
  '--team-flow-glow-mid': string;
};

export function LayerFlowNode({ onSelect, selected, view }: LayerFlowNodeProps) {
  const id = getRoleLayerIdentity(view.layer);
  const color = view.state === 'idle' ? id.color : (STATE_COLOR[view.state] ?? id.color);
  const clickable = Boolean(view.sessionId);
  const arriveKey = view.active ? 'on' : 'off';
  const prevActiveRef = useRef(arriveKey);
  const [arrive, setArrive] = useState(false);
  const onlyRoleInstance = view.roleInstances.length === 1 ? (view.roleInstances[0] ?? null) : null;

  useEffect(() => {
    if (prevActiveRef.current !== arriveKey && arriveKey === 'on') {
      setArrive(true);
      const timer = setTimeout(() => setArrive(false), 460);
      prevActiveRef.current = arriveKey;
      return () => clearTimeout(timer);
    }
    prevActiveRef.current = arriveKey;
    return undefined;
  }, [arriveKey]);

  const nodeStyle: FlowNodeStyle = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    width: '100%',
    minWidth: 0,
    padding: '12px 4px',
    borderRadius: 'var(--radius-md, 8px)',
    border: selected
      ? `1.5px solid ${color}`
      : `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
    background: selected
      ? `color-mix(in srgb, ${color} 14%, var(--bg-overlay))`
      : `color-mix(in srgb, ${color} 5%, var(--bg-overlay))`,
    cursor: clickable ? 'pointer' : 'default',
    opacity: clickable || view.active ? 1 : 0.65,
    transition: 'background 160ms ease, border-color 160ms ease, box-shadow 160ms ease',
    '--team-flow-glow': `color-mix(in srgb, ${color} 45%, transparent)`,
    '--team-flow-glow-mid': color,
    boxShadow: selected
      ? `0 0 0 1px color-mix(in srgb, ${color} 18%, transparent), 0 8px 20px -14px color-mix(in srgb, ${color} 40%, transparent)`
      : view.active
        ? `0 6px 16px -14px color-mix(in srgb, ${color} 30%, transparent)`
        : 'none',
  };

  const circleStyle: CSSProperties = {
    display: 'grid',
    placeItems: 'center',
    width: 28,
    height: 28,
    borderRadius: '50%',
    fontSize: 15,
    background: `color-mix(in srgb, ${color} 16%, var(--bg-overlay))`,
    border: `1.5px solid ${color}`,
    flexShrink: 0,
    animation: [
      view.active ? 'team-flow-node-pulse 1.8s ease-in-out infinite' : null,
      arrive ? 'team-flow-node-arrive 0.46s ease-out' : null,
    ]
      .filter((value): value is string => Boolean(value))
      .join(', '),
  };

  const roleTooltip =
    view.roleInstances.length > 0
      ? view.roleInstances
          .map((role) => role.displayName ?? role.personaKey ?? role.sessionId.slice(-8))
          .join(', ')
      : undefined;

  return (
    <button
      type="button"
      onClick={clickable ? onSelect : undefined}
      disabled={!clickable}
      aria-pressed={selected}
      title={clickable ? `查看${id.label}对话` : `${id.label}（暂无会话）`}
      style={nodeStyle}
    >
      <span aria-hidden style={circleStyle}>
        {id.icon}
      </span>

      <span
        data-team-flow-layer-label={id.short}
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--fg-strong)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          minWidth: '2.5em',
          maxWidth: '100%',
        }}
      >
        {id.short}
      </span>

      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          padding: '1px 6px',
          borderRadius: 'var(--radius-pill, 9999px)',
          background: `color-mix(in srgb, ${color} 14%, transparent)`,
          border: `1px solid color-mix(in srgb, ${color} 28%, transparent)`,
          color,
          whiteSpace: 'nowrap',
        }}
      >
        {view.active ? '● ' : ''}
        {STATE_LABELS[view.state] ?? view.state}
      </span>

      {(view.roleInstances.length > 1 || view.inboundCount > 0) && (
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 9,
            color: 'var(--fg-muted)',
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
          }}
        >
          {view.roleInstances.length > 1 ? (
            <span style={{ color: 'var(--accent)', fontWeight: 700 }}>
              {view.roleInstances.length}角色
            </span>
          ) : null}
          {view.roleInstances.length > 1 && view.inboundCount > 0 ? (
            <span aria-hidden style={{ color: 'var(--border-default)' }}>
              ·
            </span>
          ) : null}
          {view.inboundCount > 0 ? <span>{view.inboundCount}次</span> : null}
        </span>
      )}

      {onlyRoleInstance?.displayName ? (
        <span
          style={{
            fontSize: 8.5,
            color: 'var(--fg-subtle)',
            maxWidth: 90,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={roleTooltip}
        >
          {onlyRoleInstance.displayName}
        </span>
      ) : null}
    </button>
  );
}
