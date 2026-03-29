import { useState, useCallback } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import { tokens } from './tokens.js';

export interface WFNode {
  id: string;
  label: string;
  type: 'start' | 'end' | 'prompt' | 'tool' | 'condition' | 'subagent';
  x?: number;
  y?: number;
}

export interface WFEdge {
  id: string;
  source: string;
  target: string;
}

export interface WorkflowCanvasProps {
  nodes: WFNode[];
  edges: WFEdge[];
  onAddNode?: () => void;
  onSelectNode?: (id: string) => void;
  selectedNodeId?: string;
  style?: CSSProperties;
}

const NODE_W = 130;
const NODE_H = 44;
const GRID_COL = 200;
const GRID_ROW = 80;
const PAD = 40;

const TYPE_COLOR: Record<WFNode['type'], string> = {
  start: tokens.color.success,
  end: tokens.color.danger,
  prompt: tokens.color.accentHover,
  tool: tokens.color.success,
  condition: tokens.color.accent,
  subagent: tokens.color.info,
};

function getPos(node: WFNode, index: number): { x: number; y: number } {
  if (node.x !== undefined && node.y !== undefined) return { x: node.x, y: node.y };
  const col = index % 4;
  const row = Math.floor(index / 4);
  return { x: PAD + col * GRID_COL, y: PAD + row * GRID_ROW };
}

export function WorkflowCanvas({
  nodes,
  edges,
  onAddNode,
  onSelectNode,
  selectedNodeId,
  style,
}: WorkflowCanvasProps) {
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>(() => {
    const m: Record<string, { x: number; y: number }> = {};
    nodes.forEach((n, i) => {
      m[n.id] = getPos(n, i);
    });
    return m;
  });
  const [dragging, setDragging] = useState<{ id: string; ox: number; oy: number } | null>(null);

  const onMouseDown = useCallback(
    (e: MouseEvent, id: string) => {
      e.stopPropagation();
      const pos = positions[id];
      if (!pos) return;
      setDragging({ id, ox: e.clientX - pos.x, oy: e.clientY - pos.y });
    },
    [positions],
  );

  const onMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!dragging) return;
      setPositions((prev) => ({
        ...prev,
        [dragging.id]: { x: e.clientX - dragging.ox, y: e.clientY - dragging.oy },
      }));
    },
    [dragging],
  );

  const onMouseUp = useCallback(() => setDragging(null), []);

  const posFor = (id: string, idx: number) =>
    positions[id] ??
    getPos(nodes.find((n) => n.id === id) ?? { id, label: '', type: 'prompt' }, idx);

  const canvasW = Math.max(
    ...nodes.map((_, i) => posFor(nodes[i]?.id ?? '', i).x + NODE_W + PAD),
    400,
  );
  const canvasH = Math.max(
    ...nodes.map((_, i) => posFor(nodes[i]?.id ?? '', i).y + NODE_H + PAD),
    200,
  );

  return (
    <div
      style={{
        position: 'relative',
        background: 'var(--color-surface, #1e293b)',
        border: '1px solid var(--color-border, #334155)',
        borderRadius: 10,
        overflow: 'auto',
        userSelect: 'none',
        ...style,
      }}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      role="application"
      aria-label="工作流画布"
    >
      <svg
        width={canvasW}
        height={canvasH}
        style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
      >
        <title>工作流画布</title>
        <defs>
          <marker id="wf-arrow" markerWidth="8" markerHeight="8" refX="8" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="var(--color-muted, #94a3b8)" />
          </marker>
        </defs>
        {edges.map((e, ei) => {
          const si = nodes.findIndex((n) => n.id === e.source);
          const ti = nodes.findIndex((n) => n.id === e.target);
          const sp = posFor(e.source, si);
          const tp = posFor(e.target, ti);
          const x1 = sp.x + NODE_W;
          const y1 = sp.y + NODE_H / 2;
          const x2 = tp.x;
          const y2 = tp.y + NODE_H / 2;
          const mx = (x1 + x2) / 2;
          return (
            <path
              key={e.id ?? ei}
              d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
              fill="none"
              stroke="var(--color-muted, #94a3b8)"
              strokeWidth={1.5}
              markerEnd="url(#wf-arrow)"
            />
          );
        })}
      </svg>
      <div style={{ position: 'relative', width: canvasW, height: canvasH }}>
        {nodes.map((n, i) => {
          const pos = posFor(n.id, i);
          const selected = n.id === selectedNodeId;
          return (
            <button
              key={n.id}
              type="button"
              onMouseDown={(e) => onMouseDown(e, n.id)}
              onClick={() => onSelectNode?.(n.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onSelectNode?.(n.id);
              }}
              aria-label={n.label}
              aria-pressed={selected}
              style={{
                position: 'absolute',
                left: pos.x,
                top: pos.y,
                width: NODE_W,
                height: NODE_H,
                borderRadius: 8,
                background: 'var(--color-bg, #0f172a)',
                border: selected
                  ? `2px solid ${TYPE_COLOR[n.type]}`
                  : '1px solid var(--color-border, #334155)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '0 12px',
                cursor: 'grab',
                boxShadow: selected ? `0 0 0 3px ${TYPE_COLOR[n.type]}33` : 'none',
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: TYPE_COLOR[n.type],
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: 'var(--color-text, #f1f5f9)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {n.label}
              </span>
            </button>
          );
        })}
      </div>
      {onAddNode && (
        <button
          type="button"
          onClick={onAddNode}
          style={{
            position: 'absolute',
            bottom: 12,
            right: 12,
            padding: '6px 14px',
            background: tokens.color.accent,
            border: 'none',
            borderRadius: 6,
            color: '#fff',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          + 节点
        </button>
      )}
    </div>
  );
}
