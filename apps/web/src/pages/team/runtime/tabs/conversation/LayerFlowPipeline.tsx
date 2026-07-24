import type {
  HandoffEntry,
  HandoffState,
  TeamRoleLayer,
} from '../../../../../stores/team/team-events.js';
import { LayerFlowEdge } from './LayerFlowEdge.js';
import { LayerFlowNode } from './LayerFlowNode.js';
import { FLOW_LAYERS } from './layer-flow-state.js';

export interface LayerNodeView {
  active: boolean;
  inboundCount: number;
  layer: TeamRoleLayer;
  roleInstances: Array<{
    sessionId: string;
    displayName: string | null;
    personaKey: string | null;
    state: HandoffState | 'idle';
  }>;
  sessionId: string | null;
  state: HandoffState | 'idle';
}

export interface EdgeView {
  active: boolean;
  fromIndex: number;
  latest: HandoffEntry | null;
  state: HandoffState | 'idle';
  toIndex: number;
}

export interface LayerFlowPipelineProps {
  edges: EdgeView[];
  layerViews: LayerNodeView[];
  selectedSessionId: string | null;
  onSelectHandoff: (entry: HandoffEntry) => void;
  onSelectLayer: (view: LayerNodeView) => void;
}

type PipelineItem =
  | { kind: 'node'; view: LayerNodeView; idx: number }
  | { kind: 'edge'; edge: EdgeView; idx: number };

export function LayerFlowPipeline({
  edges,
  layerViews,
  onSelectHandoff,
  onSelectLayer,
  selectedSessionId,
}: LayerFlowPipelineProps) {
  const items = buildPipelineItems(layerViews, edges);

  return (
    <div className="team-conv-pipeline">
      {items.map((item) => {
        if (item.kind === 'node') {
          return (
            <LayerFlowNode
              key={`node-${item.view.layer}`}
              view={item.view}
              selected={Boolean(item.view.sessionId && selectedSessionId === item.view.sessionId)}
              onSelect={() => onSelectLayer(item.view)}
            />
          );
        }

        const latest = item.edge.latest;
        return (
          <LayerFlowEdge
            key={`edge-${item.idx}`}
            edge={item.edge}
            onSelect={latest ? () => onSelectHandoff(latest) : undefined}
          />
        );
      })}
    </div>
  );
}

function buildPipelineItems(layerViews: readonly LayerNodeView[], edges: readonly EdgeView[]) {
  const items: PipelineItem[] = [];
  for (const [idx, view] of layerViews.entries()) {
    items.push({ kind: 'node', view, idx });
    const nextView = layerViews[idx + 1] ?? null;
    if (nextView) {
      const edge = resolveVisibleEdge(view.layer, nextView.layer, edges);
      items.push({ kind: 'edge', edge, idx });
    }
  }
  return items;
}

function resolveVisibleEdge(
  fromLayer: TeamRoleLayer,
  toLayer: TeamRoleLayer,
  edges: readonly EdgeView[],
): EdgeView {
  const fromIndex = FLOW_LAYERS.indexOf(fromLayer);
  const toIndex = FLOW_LAYERS.indexOf(toLayer);
  const matchingEdge = edges.find(
    (edge) => edge.fromIndex === fromIndex && edge.toIndex === toIndex,
  );

  return (
    matchingEdge ?? {
      active: false,
      fromIndex,
      latest: null,
      state: 'idle',
      toIndex,
    }
  );
}
