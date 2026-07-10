type LegendTone =
  'architecture' | 'governance' | 'memory' | 'knowledge' | 'contains' | 'derives' | 'persisted';

export function GraphLegend() {
  const items: Array<{ label: string; kind: 'edge' | 'node' | 'badge'; tone: LegendTone }> = [
    { label: '架构', kind: 'node', tone: 'architecture' },
    { label: '规则', kind: 'node', tone: 'governance' },
    { label: '记忆', kind: 'node', tone: 'memory' },
    { label: '产物', kind: 'node', tone: 'knowledge' },
    { label: '包含', kind: 'edge', tone: 'contains' },
    { label: '派生', kind: 'edge', tone: 'derives' },
    { label: '已入库', kind: 'badge', tone: 'persisted' },
  ];
  return (
    <div className="workspace-knowledge-graph-legend" aria-label="知识图谱图例">
      {items.map((item) => (
        <span key={item.label} className="workspace-knowledge-graph-legend-item">
          <span
            className={`workspace-knowledge-graph-legend-mark is-${item.kind} is-${item.tone}`}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}
