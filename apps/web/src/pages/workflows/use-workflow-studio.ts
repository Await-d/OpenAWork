import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createWorkflowsClient,
  type WorkflowEdgeRecord,
  type WorkflowNodeRecord,
  type WorkflowTemplateRecord,
} from '@openAwork/web-client';
import { useAuthStore } from '../../stores/auth/auth.js';

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

/**
 * 工作流模板动作的统一包装：置 busy / 清 error（可选清反馈）→ try → catch 归一文案
 * → finally 清 busy。
 *
 * 必须留在模块级：React Compiler 1.0.0 不支持 `try/catch` 的 finally 子句、也不支持
 * try 内的值块（catch 里的 `reason instanceof Error ? … : …` 同样触发），本 hook 3 处
 * 这类 try 会让整个 hook 脱靶（实测）。语义逐字照搬。
 */
async function runWorkflowActionOnce(ctx: {
  setBusy: (busy: boolean) => void;
  setError: (message: string | null) => void;
  /** catch 的兜底文案（`reason.message` 优先）。 */
  failureMessage: string;
  /** 可选：同时清空并回填反馈条（保存 / 删除模板会用到）。 */
  setFeedback?: (feedback: { message: string; tone: 'error' } | null) => void;
  run: () => Promise<void>;
}): Promise<void> {
  ctx.setBusy(true);
  ctx.setFeedback?.(null);
  ctx.setError(null);
  try {
    await ctx.run();
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : ctx.failureMessage;
    ctx.setError(message);
    ctx.setFeedback?.({ message, tone: 'error' });
  } finally {
    ctx.setBusy(false);
  }
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

    // 置 loading / 清 error 与 try/catch/finally 一起下沉到模块级
    // `runWorkflowActionOnce`（见其注释）。
    await runWorkflowActionOnce({
      setBusy: setLoading,
      setError,
      failureMessage: '加载工作流模板失败',
      run: async () => {
        const nextTemplates = await client.listTemplates(accessToken);
        setTemplates(nextTemplates);
        if (!selectedTemplateId && nextTemplates[0]) {
          setSelectedTemplateId(nextTemplates[0].id);
        }
      },
    });
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
      // 置 busy / 清 error / 清反馈 与 try/catch/finally 一起下沉到模块级
      // `runWorkflowActionOnce`（见其注释）。
      await runWorkflowActionOnce({
        setBusy,
        setError,
        setFeedback,
        failureMessage: '保存工作流模板失败',
        run: async () => {
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
        },
      });
    },
    [accessToken, client, draftEdges, draftNodes, templates],
  );

  const removeSelectedTemplate = useCallback(async () => {
    if (!accessToken || !selectedTemplateId) {
      return;
    }
    // 同 saveTemplate：整段下沉到 `runWorkflowActionOnce`（见其注释）。
    await runWorkflowActionOnce({
      setBusy,
      setError,
      setFeedback,
      failureMessage: '删除工作流模板失败',
      run: async () => {
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
      },
    });
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
