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

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!clickable}
      aria-label={edge.latest ? '查看该层间消息详情' : '该相邻层暂无消息传递'}
      title={edge.latest ? '查看层间消息详情' : '暂无传递'}
      className="team-conv-flow-edge"
      data-active={edge.active ? 'true' : 'false'}
      data-clickable={clickable ? 'true' : 'false'}
      style={{
        '--edge-color': color,
      }}
    >
      <span aria-hidden className="team-conv-flow-edge__arrow">
        ▸
      </span>
      <span className="team-conv-flow-edge__track" aria-hidden />
      {edge.latest ? (
        <span style={{ fontSize: 8.5, fontWeight: 600, color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
          {STATE_LABELS[edge.state] ?? edge.state}
        </span>
      ) : (
        <span style={{ fontSize: 8.5, color: 'var(--fg-subtle)' }}>—</span>
      )}
    </button>
  );
}
