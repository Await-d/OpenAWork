import type { CSSProperties } from 'react';
import type { EdgeView } from './LayerFlowPipeline.js';
import { STATE_COLOR, STATE_LABELS } from './layer-flow-state.js';

interface LayerFlowEdgeProps {
  edge: EdgeView;
  onSelect?: () => void;
}

export function LayerFlowEdge({ edge, onSelect }: LayerFlowEdgeProps) {
  const color =
    edge.state === 'idle'
      ? 'var(--border-default)'
      : (STATE_COLOR[edge.state] ?? 'var(--fg-muted)');
  const clickable = Boolean(onSelect);
  const trackStyle: CSSProperties = edge.active
    ? {
        height: 3,
        width: '100%',
        borderRadius: 'var(--radius-pill, 9999px)',
        backgroundImage: `linear-gradient(90deg, color-mix(in srgb, ${color} 20%, transparent) 0%, ${color} 50%, color-mix(in srgb, ${color} 20%, transparent) 100%)`,
        backgroundSize: '200% 100%',
        animation: 'team-flow-dash 1.1s linear infinite',
      }
    : {
        height: 2,
        width: '100%',
        borderRadius: 'var(--radius-pill, 9999px)',
        background:
          edge.latest && edge.state !== 'idle'
            ? `color-mix(in srgb, ${color} 50%, transparent)`
            : 'color-mix(in srgb, var(--border-default) 45%, transparent)',
      };

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!clickable}
      aria-label={edge.latest ? '查看该层间消息详情' : '该相邻层暂无消息传递'}
      title={edge.latest ? '查看层间消息详情' : '暂无传递'}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        padding: '8px 1px',
        background: 'transparent',
        border: 'none',
        cursor: clickable ? 'pointer' : 'default',
        transition: 'opacity 160ms ease',
        opacity: edge.state === 'idle' && !edge.latest ? 0.5 : 1,
      }}
    >
      <span
        aria-hidden
        style={{
          fontSize: 12,
          color,
          lineHeight: 1,
          fontWeight: 700,
        }}
      >
        ▸
      </span>
      <span style={trackStyle} aria-hidden />
      {edge.latest ? (
        <span
          style={{
            fontSize: 8.5,
            fontWeight: 600,
            color: 'var(--fg-muted)',
            whiteSpace: 'nowrap',
          }}
        >
          {STATE_LABELS[edge.state] ?? edge.state}
        </span>
      ) : (
        <span style={{ fontSize: 8.5, color: 'var(--fg-subtle)' }}>—</span>
      )}
    </button>
  );
}
