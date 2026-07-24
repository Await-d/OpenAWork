import { useEffect, useRef, useState } from 'react';
import { getRoleLayerIdentity } from '../../data/role-layer-identity.js';
import type { LayerNodeView } from './LayerFlowPipeline.js';
import { STATE_COLOR, STATE_LABELS } from './layer-flow-state.js';

interface LayerFlowNodeProps {
  onSelect: () => void;
  selected: boolean;
  view: LayerNodeView;
}

export function LayerFlowNode({ onSelect, selected, view }: LayerFlowNodeProps) {
  const id = getRoleLayerIdentity(view.layer);
  const color = view.state === 'idle' ? id.color : (STATE_COLOR[view.state] ?? id.color);
  const clickable = Boolean(view.sessionId);
  const arriveKey = view.active ? 'on' : 'off';
  const prevActiveRef = useRef(arriveKey);
  const [arrive, setArrive] = useState(false);
  const onlyRoleInstance =
    view.roleInstances.length === 1 ? (view.roleInstances[0] ?? null) : null;

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

  const roleTooltip =
    view.roleInstances.length > 0
      ? view.roleInstances
          .map((role) => role.displayName ?? role.personaKey ?? role.sessionId.slice(-8))
          .join(', ')
      : undefined;

  const stateLabel = STATE_LABELS[view.state] ?? view.state;

  return (
    <button
      type="button"
      onClick={clickable ? onSelect : undefined}
      disabled={!clickable}
      aria-pressed={selected}
      title={clickable ? `查看${id.label}对话` : `${id.label}（暂无会话）`}
      className="team-conv-flow-node"
      data-layer={view.layer}
      data-active={view.active ? 'true' : 'false'}
      data-selected={selected ? 'true' : 'false'}
      data-clickable={clickable ? 'true' : 'false'}
      style={{
        '--node-color': color,
      }}
    >
      <span aria-hidden className="team-conv-flow-node__circle">
        {id.icon}
      </span>

      <span className="team-conv-flow-node__label">{id.short}</span>

      <span
        className="team-conv-badge team-conv-state"
        data-state={view.state}
        style={{
          '--state-color': color,
          '--state-bg': `color-mix(in srgb, ${color} 10%, transparent)`,
          '--state-border': `color-mix(in srgb, ${color} 28%, transparent)`,
        }}
      >
        {view.active && <span className="team-conv-badge--dot team-conv-badge--pulse" />}
        {stateLabel}
      </span>

      {(view.roleInstances.length > 1 || view.inboundCount > 0) && (
        <span className="team-conv-flow-node__meta">
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
