import React, { useEffect, useState } from 'react';
import { WorkflowCanvas, WorkflowTemplateLibrary, WorkflowModeToggle } from '@openAwork/shared-ui';
import { logger } from '../utils/logger.js';
import { useAuthStore } from '../stores/auth.js';

const sharedUiThemeVars = {
  '--color-surface': 'var(--surface)',
  '--color-border': 'var(--border)',
  '--color-text': 'var(--text)',
  '--color-muted': 'var(--text-3)',
  '--color-accent': 'var(--accent)',
  '--color-bg': 'var(--bg)',
  '--color-background': 'var(--bg)',
  '--color-foreground': 'var(--text)',
  '--color-primary': 'var(--accent)',
  '--color-primary-foreground': 'var(--accent-text)',
} as React.CSSProperties;
import type { WFNode, WFEdge, WorkflowTemplateSummary, WorkflowMode } from '@openAwork/shared-ui';

const INIT_NODES: WFNode[] = [
  { id: 'start', label: '开始', type: 'start', x: 80, y: 120 },
  { id: 'prompt1', label: '生成', type: 'prompt', x: 280, y: 120 },
  { id: 'end', label: '结束', type: 'end', x: 480, y: 120 },
];

const INIT_EDGES: WFEdge[] = [
  { id: 'e1', source: 'start', target: 'prompt1' },
  { id: 'e2', source: 'prompt1', target: 'end' },
];

export default function WorkflowsPage() {
  const token = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const [nodes, setNodes] = useState<WFNode[]>(INIT_NODES);
  const [edges] = useState<WFEdge[]>(INIT_EDGES);
  const [mode, setMode] = useState<WorkflowMode>('interactive');
  const [selectedNode, setSelectedNode] = useState<string | undefined>();
  const [templates, setTemplates] = useState<WorkflowTemplateSummary[]>([]);

  useEffect(() => {
    if (!token) return;
    fetch(`${gatewayUrl}/workflows/templates`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json() as Promise<WorkflowTemplateSummary[]>)
      .then(setTemplates);
  }, [token, gatewayUrl]);

  let nodeCounter = nodes.length;
  function handleAddNode() {
    nodeCounter += 1;
    const col = nodeCounter % 4;
    const row = Math.floor(nodeCounter / 4);
    const newNode: WFNode = {
      id: `n${Date.now()}`,
      label: '新步骤',
      type: 'prompt',
      x: 80 + col * 200,
      y: 120 + row * 120,
    };
    setNodes((prev) => [...prev, newNode]);
  }

  return (
    <div className="page-root">
      <div className="page-header">
        <span className="page-title" style={{ flex: 1 }}>
          工作流
        </span>
        <WorkflowModeToggle mode={mode} onChange={setMode} />
      </div>
      <div
        className="page-content"
        style={{ display: 'flex', flexDirection: 'row', padding: 0, overflow: 'hidden' }}
      >
        <div style={{ ...sharedUiThemeVars, flex: 1, display: 'flex' }}>
          <WorkflowCanvas
            nodes={nodes}
            edges={edges}
            selectedNodeId={selectedNode}
            onSelectNode={setSelectedNode}
            onAddNode={handleAddNode}
            style={{ flex: 1 }}
          />
        </div>
        <div
          style={{
            ...sharedUiThemeVars,
            width: 260,
            borderLeft: '1px solid var(--border)',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ padding: '6px 12px 4px', borderBottom: '1px solid var(--border-subtle)' }}>
            <span className="section-label" style={{ marginBottom: 0 }}>
              模板库
            </span>
          </div>
          <WorkflowTemplateLibrary
            templates={templates}
            onSelect={(id) => logger.info('template selected', id)}
            onSave={(name, desc) => logger.info('template saved', { name, desc })}
          />
        </div>
      </div>
    </div>
  );
}
