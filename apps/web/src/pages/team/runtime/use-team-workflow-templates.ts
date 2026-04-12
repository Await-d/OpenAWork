import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createWorkflowsClient,
  type WorkflowEdgeRecord,
  type WorkflowNodeRecord,
  type WorkflowTemplateRecord,
} from '@openAwork/web-client';
import { useAuthStore } from '../../../stores/auth.js';
import {
  agentTeamsNewTemplateProviders,
  agentTeamsNewTemplateRoles,
  type AgentTeamsSidebarSection,
} from './team-runtime-reference-mock.js';

interface CreateTeamWorkflowTemplateInput {
  name: string;
  provider: string;
  roleValues: string[];
}

function buildTemplateCategoryLabel(category: string): string {
  if (category === 'team-playbook') {
    return '团队模板';
  }
  return category.replace(/[-_]/g, ' ');
}

function buildTemplateDescription(
  name: string,
  providerLabel: string,
  roleLabels: string[],
): string {
  if (roleLabels.length === 0) {
    return `${name} 的团队模板，默认 Provider 为 ${providerLabel}。`;
  }
  return `默认 Provider：${providerLabel}，包含 ${roleLabels.join('、')} 等 ${roleLabels.length} 个角色。`;
}

function buildTemplateNodes(roleLabels: string[], providerLabel: string): WorkflowNodeRecord[] {
  const nodes: WorkflowNodeRecord[] = [
    { id: 'node-start', label: '开始', type: 'start', x: 40, y: 120 },
  ];

  roleLabels.forEach((roleLabel, index) => {
    nodes.push({
      id: `node-role-${index + 1}`,
      label: `${roleLabel} · ${providerLabel}`,
      type: 'subagent',
      x: 220 + index * 180,
      y: 120 + (index % 2 === 0 ? 0 : 96),
    });
  });

  nodes.push({
    id: 'node-end',
    label: '结束',
    type: 'end',
    x: 220 + roleLabels.length * 180,
    y: 120,
  });

  return nodes;
}

function buildTemplateEdges(roleLabels: string[]): WorkflowEdgeRecord[] {
  const nodeIds = [
    'node-start',
    ...roleLabels.map((_, index) => `node-role-${index + 1}`),
    'node-end',
  ];

  return nodeIds.slice(0, -1).map((source, index) => ({
    id: `edge-${source}-${nodeIds[index + 1]}`,
    source,
    target: nodeIds[index + 1]!,
  }));
}

function buildRoleRows(roleLabels: string[]): Array<Array<{ color: string; label: string }>> {
  const roleColorMap = new Map(agentTeamsNewTemplateRoles.map((role) => [role.label, role.color]));
  const tags = roleLabels.map((label) => ({
    color: roleColorMap.get(label) ?? '#7c52ff',
    label,
  }));

  const rows: Array<Array<{ color: string; label: string }>> = [];
  for (let index = 0; index < tags.length; index += 3) {
    rows.push(tags.slice(index, index + 3));
  }
  return rows;
}

function extractRoleLabels(template: WorkflowTemplateRecord): string[] {
  return template.nodes
    .filter((node) => node.type === 'subagent')
    .map((node) => node.label.split(' · ')[0]?.trim() ?? '')
    .filter((label) => label.length > 0);
}

function mapTemplatesToSections(templates: WorkflowTemplateRecord[]): AgentTeamsSidebarSection[] {
  const groups = new Map<string, AgentTeamsSidebarSection>();

  for (const template of templates) {
    const sectionId = template.category || 'team-playbook';
    const section = groups.get(sectionId) ?? {
      id: sectionId,
      items: [],
      title: buildTemplateCategoryLabel(sectionId),
    };

    const roleLabels = extractRoleLabels(template);
    section.items.push({
      description:
        template.description ??
        `包含 ${roleLabels.length} 个角色节点的团队模板，可直接在 Team 页面复用。`,
      id: template.id,
      roleTagRows: buildRoleRows(roleLabels),
      title: template.name,
    });
    groups.set(sectionId, section);
  }

  return Array.from(groups.values()).map((section) => ({
    ...section,
    items: [...section.items].sort((left, right) => left.title.localeCompare(right.title, 'zh-CN')),
  }));
}

export function useTeamWorkflowTemplates() {
  const accessToken = useAuthStore((state) => state.accessToken);
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  const client = useMemo(() => createWorkflowsClient(gatewayUrl), [gatewayUrl]);
  const [templates, setTemplates] = useState<WorkflowTemplateRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setTemplates(nextTemplates.filter((template) => template.category === 'team-playbook'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '加载团队模板失败');
    } finally {
      setLoading(false);
    }
  }, [accessToken, client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createTemplate = useCallback(
    async (input: CreateTeamWorkflowTemplateInput) => {
      if (!accessToken) {
        return false;
      }

      const roleLabels = input.roleValues
        .map(
          (roleValue) => agentTeamsNewTemplateRoles.find((role) => role.value === roleValue)?.label,
        )
        .filter((label): label is string => Boolean(label));
      const providerLabel =
        agentTeamsNewTemplateProviders.find((provider) => provider.value === input.provider)
          ?.label ?? input.provider;

      setBusy(true);
      setError(null);
      try {
        const created = await client.createTemplate(accessToken, {
          category: 'team-playbook',
          description: buildTemplateDescription(input.name, providerLabel, roleLabels),
          edges: buildTemplateEdges(roleLabels),
          name: input.name,
          nodes: buildTemplateNodes(roleLabels, providerLabel),
        });
        setTemplates((current) => [created, ...current]);
        return true;
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '创建团队模板失败');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [accessToken, client],
  );

  const sections = useMemo(() => mapTemplatesToSections(templates), [templates]);

  return {
    busy,
    canCreateTemplate: Boolean(accessToken),
    createTemplate,
    error,
    loading,
    refresh,
    sections,
    templateCount: templates.length,
    templates,
  };
}
