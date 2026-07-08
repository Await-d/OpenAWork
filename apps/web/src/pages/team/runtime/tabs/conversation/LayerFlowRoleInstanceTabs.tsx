import type { LayerNodeView } from './LayerFlowPipeline.js';

interface LayerFlowRoleInstanceTabsProps {
  selectedSessionId: string;
  view: LayerNodeView;
  onSelectSessionId: (sessionId: string) => void;
}

export function LayerFlowRoleInstanceTabs({
  selectedSessionId,
  view,
  onSelectSessionId,
}: LayerFlowRoleInstanceTabsProps) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 4,
        padding: '6px 10px',
        borderBottom: '1px solid color-mix(in srgb, var(--border-default) 30%, transparent)',
        overflowX: 'auto',
        flexShrink: 0,
      }}
    >
      {view.roleInstances.map((roleInstance) => {
        const isActive = roleInstance.sessionId === selectedSessionId;
        return (
          <button
            key={roleInstance.sessionId}
            type="button"
            onClick={() => onSelectSessionId(roleInstance.sessionId)}
            className="team-sub-tab"
            data-active={isActive}
            style={{
              padding: '3px 10px',
              borderRadius: 'var(--radius-sm, 6px)',
              border: isActive
                ? '1px solid color-mix(in srgb, var(--accent) 45%, transparent)'
                : '1px solid color-mix(in srgb, var(--border-default) 30%, transparent)',
              background: isActive
                ? 'color-mix(in srgb, var(--accent) 10%, transparent)'
                : 'transparent',
              color: isActive ? 'var(--fg-strong)' : 'var(--fg-muted)',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
            title={roleInstance.displayName ?? roleInstance.personaKey ?? roleInstance.sessionId}
          >
            {roleInstance.displayName ??
              roleInstance.personaKey ??
              roleInstance.sessionId.slice(-8)}
          </button>
        );
      })}
    </div>
  );
}
