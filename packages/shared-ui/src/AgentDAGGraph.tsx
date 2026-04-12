import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { tokens } from './tokens.js';

export interface DAGNodeInfo {
  id: string;
  label: string;
  type: 'orchestrator' | 'subagent' | 'tool' | 'human_input';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
}

export interface DAGEdgeInfo {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface AgentDAGGraphProps {
  nodes: DAGNodeInfo[];
  edges: DAGEdgeInfo[];
  onNodeClick?: (nodeId: string) => void;
  style?: CSSProperties;
}

const NODE_COLOR: Record<DAGNodeInfo['type'], string> = {
  orchestrator: tokens.color.accent,
  subagent: tokens.color.info,
  tool: tokens.color.success,
  human_input: tokens.color.accent,
};

const STATUS_BORDER: Record<DAGNodeInfo['status'], string> = {
  pending: 'var(--color-border, #334155)',
  running: tokens.color.accent,
  completed: tokens.color.success,
  failed: tokens.color.danger,
  skipped: 'var(--color-muted, #94a3b8)',
};

const NODE_W = 140;
const NODE_H = 52;
const COL_GAP = 80;
const ROW_GAP = 24;
const PAD = 24;

function buildLayout(nodes: DAGNodeInfo[], edges: DAGEdgeInfo[]) {
  const inDegree: Record<string, number> = {};
  const adj: Record<string, string[]> = {};
  for (const n of nodes) {
    inDegree[n.id] = 0;
    adj[n.id] = [];
  }
  for (const e of edges) {
    const srcAdj = adj[e.source];
    if (srcAdj) srcAdj.push(e.target);
    inDegree[e.target] = (inDegree[e.target] ?? 0) + 1;
  }
  const cols: string[][] = [];
  const visited = new Set<string>();
  let queue = nodes.filter((n) => inDegree[n.id] === 0).map((n) => n.id);
  while (queue.length) {
    cols.push(queue);
    for (const id of queue) visited.add(id);
    const next: string[] = [];
    for (const id of queue) {
      for (const t of adj[id] ?? []) {
        if (!visited.has(t) && !next.includes(t)) next.push(t);
      }
    }
    queue = next;
  }
  const unvisited = nodes.filter((n) => !visited.has(n.id)).map((n) => n.id);
  if (unvisited.length) cols.push(unvisited);
  const pos: Record<string, { x: number; y: number }> = {};
  cols.forEach((col, ci) => {
    const x = PAD + ci * (NODE_W + COL_GAP);
    col.forEach((id, ri) => {
      pos[id] = { x, y: PAD + ri * (NODE_H + ROW_GAP) };
    });
  });
  const maxCol = cols.length;
  const maxRow = cols.length > 0 ? Math.max(...cols.map((c) => c.length), 0) : 0;
  const svgW = Math.max(PAD * 2 + maxCol * NODE_W + Math.max(0, maxCol - 1) * COL_GAP, PAD * 2);
  const svgH = Math.max(PAD * 2 + maxRow * NODE_H + Math.max(0, maxRow - 1) * ROW_GAP, PAD * 2);
  return { pos, svgW, svgH };
}

function NodeShape({
  n,
  p,
  isRunning,
}: {
  n: DAGNodeInfo;
  p: { x: number; y: number };
  isRunning: boolean;
}) {
  return (
    <>
      <rect
        x={p.x}
        y={p.y}
        width={NODE_W}
        height={NODE_H}
        rx={8}
        fill="var(--color-bg, #0f172a)"
        stroke={STATUS_BORDER[n.status]}
        strokeWidth={isRunning ? 2 : 1}
        style={isRunning ? { animation: 'dag-pulse 1.2s ease-in-out infinite' } : undefined}
      />
      <rect x={p.x} y={p.y} width={4} height={NODE_H} rx={2} fill={NODE_COLOR[n.type]} />
      <text
        x={p.x + 14}
        y={p.y + 20}
        fontSize={10}
        fontWeight={600}
        fill="var(--color-muted, #94a3b8)"
      >
        {n.type}
      </text>
      <text
        x={p.x + 14}
        y={p.y + 36}
        fontSize={12}
        fontWeight={500}
        fill="var(--color-text, #f1f5f9)"
      >
        {n.label.length > 14 ? n.label.slice(0, 13) + '\u2026' : n.label}
      </text>
    </>
  );
}

export function AgentDAGGraph({ nodes, edges, onNodeClick, style }: AgentDAGGraphProps) {
  const styleRef = useRef<HTMLStyleElement | null>(null);
  useEffect(() => {
    if (!styleRef.current) {
      const el = document.createElement('style');
      el.textContent = `@keyframes dag-pulse{0%,100%{opacity:1}50%{opacity:0.4}}`;
      document.head.appendChild(el);
      styleRef.current = el;
    }
    return () => {
      if (styleRef.current) {
        styleRef.current.remove();
        styleRef.current = null;
      }
    };
  }, []);
  const { pos, svgW, svgH } = buildLayout(nodes, edges);
  return (
    <div
      style={{
        background: 'var(--color-surface, #1e293b)',
        border: '1px solid var(--color-border, #334155)',
        borderRadius: 10,
        overflow: 'auto',
        ...style,
      }}
    >
      <svg width={svgW} height={svgH} style={{ display: 'block' }}>
        <title>Agent DAG 图</title>
        <defs>
          <marker id="dag-arrow" markerWidth="8" markerHeight="8" refX="8" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="var(--color-muted, #94a3b8)" />
          </marker>
        </defs>
        {edges.map((e) => {
          const s = pos[e.source];
          const t = pos[e.target];
          if (!s || !t) return null;
          const x1 = s.x + NODE_W;
          const y1 = s.y + NODE_H / 2;
          const x2 = t.x;
          const y2 = t.y + NODE_H / 2;
          const mx = (x1 + x2) / 2;
          return (
            <g key={e.id}>
              <path
                d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
                fill="none"
                stroke="var(--color-muted, #94a3b8)"
                strokeWidth={1.5}
                markerEnd="url(#dag-arrow)"
              />
              {e.label && (
                <text
                  x={mx}
                  y={(y1 + y2) / 2 - 4}
                  textAnchor="middle"
                  fontSize={9}
                  fill="var(--color-muted, #94a3b8)"
                >
                  {e.label}
                </text>
              )}
            </g>
          );
        })}
        {nodes.map((n) => {
          const p = pos[n.id];
          if (!p) return null;
          const isRunning = n.status === 'running';
          if (onNodeClick) {
            return (
              <g key={n.id}>
                <NodeShape n={n} p={p} isRunning={isRunning} />
                <foreignObject x={p.x} y={p.y} width={NODE_W} height={NODE_H}>
                  <button
                    type="button"
                    style={{
                      width: '100%',
                      height: '100%',
                      opacity: 0,
                      cursor: 'pointer',
                      border: 'none',
                      background: 'none',
                      padding: 0,
                    }}
                    aria-label={n.label}
                    onClick={() => onNodeClick(n.id)}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter') onNodeClick(n.id);
                    }}
                  />
                </foreignObject>
              </g>
            );
          }
          return (
            <g key={n.id}>
              <NodeShape n={n} p={p} isRunning={isRunning} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
