import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createWorkflowsClient,
  type WorkflowEdgeRecord,
  type WorkflowNodeRecord,
  type WorkflowTemplateRecord,
} from '@openAwork/web-client';
import { useAuthStore } from '../../stores/auth.js';

function createDefaultDraft() {
  const nodes: WorkflowNodeRecord[] = [
    { id: 'node-start', label: '开始', type: 'start', x: 40, y: 40 },
    { id: 'node-end', label: '结束', type: 'end', x: 440, y: 40 },
  ];
  const edges: WorkflowEdgeRecord[] = [
    { id: 'edge-start-end', source: 'node-start', target: 'node-end' },
  ];
  return { edges, nodes, selectedNodeId: 'node-start' };
}

export interface WorkflowStudioFeedback {
  message: string;
  tone: 'error' | 'success';
}

export function useWorkflowStudio() {
  const accessToken = useAuthStore((state) => state.accessToken);
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  const client = useMemo(() => createWorkflowsClient(gatewayUrl), [gatewayUrl]);
  const [templates, setTemplates] = useState<WorkflowTemplateRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<WorkflowStudioFeedback | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [draftNodes, setDraftNodes] = useState<WorkflowNodeRecord[]>(createDefaultDraft().nodes);
  const [draftEdges, setDraftEdges] = useState<WorkflowEdgeRecord[]>(createDefaultDraft().edges);
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(
    createDefaultDraft().selectedNodeId,
  );

  const refresh = useCallback(async () => {
    if (!accessToken) {
      setTemplates([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const nextTemplates = await client.listTemplates(accessToken);
      setTemplates(nextTemplates);
      if (!selectedTemplateId && nextTemplates[0]) {
        setSelectedTemplateId(nextTemplates[0].id);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '加载工作流模板失败');
    } finally {
      setLoading(false);
    }
  }, [accessToken, client, selectedTemplateId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? null,
    [selectedTemplateId, templates],
  );

  useEffect(() => {
    if (!selectedTemplate) {
      return;
    }

    setDraftNodes(selectedTemplate.nodes);
    setDraftEdges(selectedTemplate.edges);
    setSelectedNodeId(selectedTemplate.nodes[0]?.id);
  }, [selectedTemplate]);

  const selectedNode = useMemo(
    () => draftNodes.find((node) => node.id === selectedNodeId) ?? null,
    [draftNodes, selectedNodeId],
  );

  const addNode = useCallback(() => {
    const endNode = draftNodes.find((node) => node.type === 'end');
    const lastExecutableNode = [...draftNodes].reverse().find((node) => node.type !== 'end');
    const nextNodeIndex = draftNodes.filter((node) => node.id.startsWith('node-')).length + 1;
    const nextNodeId = `node-${nextNodeIndex}`;
    const nextNode: WorkflowNodeRecord = {
      id: nextNodeId,
      label: `步骤 ${Math.max(1, draftNodes.length - 1)}`,
      type: 'prompt',
      x: endNode?.x ? endNode.x - 180 : 240,
      y: (endNode?.y ?? 40) + 90,
    };
    const nextNodes = endNode
      ? [...draftNodes.filter((node) => node.id !== endNode.id), nextNode, endNode]
      : [...draftNodes, nextNode];
    const filteredEdges = endNode
      ? draftEdges.filter(
          (edge) => !(edge.target === endNode.id && edge.source === lastExecutableNode?.id),
        )
      : draftEdges;
    const nextEdges = [
      ...filteredEdges,
      ...(lastExecutableNode
        ? [
            {
              id: `edge-${lastExecutableNode.id}-${nextNodeId}`,
              source: lastExecutableNode.id,
              target: nextNodeId,
            },
          ]
        : []),
      ...(endNode
        ? [{ id: `edge-${nextNodeId}-${endNode.id}`, source: nextNodeId, target: endNode.id }]
        : []),
    ];

    setDraftNodes(nextNodes);
    setDraftEdges(nextEdges);
    setSelectedNodeId(nextNodeId);
    setSelectedTemplateId(null);
  }, [draftEdges, draftNodes]);

  const updateSelectedNode = useCallback(
    (patch: Partial<WorkflowNodeRecord>) => {
      if (!selectedNodeId) {
        return;
      }
      setDraftNodes((current) =>
        current.map((node) => (node.id === selectedNodeId ? { ...node, ...patch } : node)),
      );
      setSelectedTemplateId(null);
    },
    [selectedNodeId],
  );

  const saveTemplate = useCallback(
    async (name: string, description: string) => {
      if (!accessToken) {
        return;
      }
      setBusy(true);
      setFeedback(null);
      setError(null);
      try {
        const created = await client.createTemplate(accessToken, {
          name,
          description,
          category: 'team-playbook',
          nodes: draftNodes,
          edges: draftEdges,
        });
        const nextTemplates = [created, ...templates];
        setTemplates(nextTemplates);
        setSelectedTemplateId(created.id);
        setFeedback({ message: '已保存工作流模板', tone: 'success' });
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : '保存工作流模板失败';
        setError(message);
        setFeedback({ message, tone: 'error' });
      } finally {
        setBusy(false);
      }
    },
    [accessToken, client, draftEdges, draftNodes, templates],
  );

  const removeSelectedTemplate = useCallback(async () => {
    if (!accessToken || !selectedTemplateId) {
      return;
    }
    setBusy(true);
    setFeedback(null);
    setError(null);
    try {
      await client.removeTemplate(accessToken, selectedTemplateId);
      const nextTemplates = templates.filter((template) => template.id !== selectedTemplateId);
      setTemplates(nextTemplates);
      setSelectedTemplateId(nextTemplates[0]?.id ?? null);
      if (nextTemplates.length === 0) {
        const fallback = createDefaultDraft();
        setDraftNodes(fallback.nodes);
        setDraftEdges(fallback.edges);
        setSelectedNodeId(fallback.selectedNodeId);
      }
      setFeedback({ message: '已删除工作流模板', tone: 'success' });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '删除工作流模板失败';
      setError(message);
      setFeedback({ message, tone: 'error' });
    } finally {
      setBusy(false);
    }
  }, [accessToken, client, selectedTemplateId, templates]);

  return {
    addNode,
    busy,
    draftEdges,
    draftNodes,
    error,
    feedback,
    loading,
    refresh,
    removeSelectedTemplate,
    saveTemplate,
    selectedNode,
    selectedNodeId,
    selectedTemplate,
    setSelectedNodeId,
    setSelectedTemplateId,
    templates,
    updateSelectedNode,
  };
}
