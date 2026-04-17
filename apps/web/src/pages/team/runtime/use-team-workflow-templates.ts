import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createWorkflowsClient,
  type WorkflowEdgeRecord,
  type WorkflowNodeRecord,
  type WorkflowTemplateMetadata,
  type WorkflowTemplateRecord,
  type WorkflowTemplateScale,
} from '@openAwork/web-client';
import { useAuthStore } from '../../../stores/auth.js';
import { agentTeamsNewTemplateProviders } from './team-runtime-ui-config.js';
import type {
  AgentTeamsSidebarSection,
  AgentTeamsSidebarTemplateBadge,
  AgentTeamsWorkflowTemplateCard,
} from './team-runtime-types.js';

interface CreateTeamWorkflowTemplateInput {
  name: string;
  optionalAgentIds?: string[];
  provider: string;
}

const REQUIRED_TEMPLATE_ROLES: Array<
  'leader' | 'planner' | 'researcher' | 'executor' | 'reviewer'
> = ['leader', 'planner', 'researcher', 'executor', 'reviewer'];

function mapCanonicalRoleToTemplateLabel(
  role: 'leader' | 'planner' | 'researcher' | 'executor' | 'reviewer',
) {
  switch (role) {
    case 'leader':
      return '团队领导';
    case 'planner':
      return '团队负责人';
    case 'researcher':
      return '研究员';
    case 'executor':
      return '执行者';
    case 'reviewer':
      return '批评者';
  }
}

function buildTeamTemplateMetadata(
  provider: string,
  optionalAgentIds: string[] = [],
): WorkflowTemplateMetadata {
  return {
    teamTemplate: {
      defaultProvider: provider,
      optionalAgentIds,
      requiredRoles: REQUIRED_TEMPLATE_ROLES,
    },
  };
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

const TEMPLATE_SCALE_LABELS: Record<WorkflowTemplateScale, string> = {
  full: '完整',
  large: '大型',
  medium: '中型',
  small: '小型',
};

const BUILTIN_AGENT_LABELS: Record<string, string> = {
  atlas: 'Atlas',
  metis: 'Metis',
  'sisyphus-junior': 'Sisyphus-Junior',
};

const TEMPLATE_GROUPS = {
  recommended: { id: 'recommended-templates', title: '推荐模板', priority: 1 },
  system: { id: 'system-default-templates', title: '系统默认模板', priority: 2 },
  user: { id: 'user-templates', title: '我的模板', priority: 3 },
} as const;

function isSeedDevTemplate(template: WorkflowTemplateRecord): boolean {
  return (
    template.category === 'team-playbook' &&
    template.metadata?.origin === 'seed' &&
    template.metadata?.templateKind === 'default-dev'
  );
}

function getTemplateGroup(template: WorkflowTemplateRecord) {
  if (template.metadata?.teamTemplate?.recommendedDefault) {
    return TEMPLATE_GROUPS.recommended;
  }

  if (isSeedDevTemplate(template)) {
    return TEMPLATE_GROUPS.system;
  }

  return TEMPLATE_GROUPS.user;
}

function buildTemplateBadges(template: WorkflowTemplateRecord): AgentTeamsSidebarTemplateBadge[] {
  const badges: AgentTeamsSidebarTemplateBadge[] = [];
  const teamTemplate = template.metadata?.teamTemplate;

  if (isSeedDevTemplate(template)) {
    badges.push({ label: '系统默认', tone: 'accent' });
  }

  if (teamTemplate?.recommendedDefault) {
    badges.push({ label: '推荐起步', tone: 'accent' });
  }

  if (teamTemplate?.templateScale) {
    badges.push({ label: TEMPLATE_SCALE_LABELS[teamTemplate.templateScale], tone: 'success' });
  }

  if ((teamTemplate?.optionalAgentIds?.length ?? 0) > 0) {
    badges.push({ label: `+${teamTemplate?.optionalAgentIds?.length} 增援`, tone: 'warning' });
  } else {
    badges.push({ label: '无额外增援', tone: 'default' });
  }

  return badges;
}

function buildTemplateMetaLine(template: WorkflowTemplateRecord): string | undefined {
  const teamTemplate = template.metadata?.teamTemplate;
  if (!teamTemplate) {
    return undefined;
  }

  const focus = teamTemplate.templateFocus?.trim();
  const recommendedFor = teamTemplate.recommendedFor?.trim();
  const optionalAgents = (teamTemplate.optionalAgentIds ?? []).map(
    (agentId) => BUILTIN_AGENT_LABELS[agentId] ?? agentId,
  );
  const optionalLabel = optionalAgents.length > 0 ? optionalAgents.join(' / ') : '无';

  return [
    focus ? `重点：${focus}` : undefined,
    recommendedFor ? `适用：${recommendedFor}` : undefined,
    `增援：${optionalLabel}`,
  ]
    .filter((value) => typeof value === 'string' && value.length > 0)
    .join(' · ');
}

function toTemplateCard(template: WorkflowTemplateRecord): AgentTeamsWorkflowTemplateCard {
  const group = getTemplateGroup(template);
  return {
    ...template,
    badges: buildTemplateBadges(template),
    groupId: group.id,
    groupPriority: group.priority,
    groupTitle: group.title,
    metaLine: buildTemplateMetaLine(template),
  };
}

function getTemplatePriority(template: WorkflowTemplateRecord): number {
  return template.metadata?.teamTemplate?.templatePriority ?? Number.MAX_SAFE_INTEGER;
}

function sortTemplates(left: WorkflowTemplateRecord, right: WorkflowTemplateRecord): number {
  const leftGroup = getTemplateGroup(left);
  const rightGroup = getTemplateGroup(right);
  if (leftGroup.priority !== rightGroup.priority) {
    return leftGroup.priority - rightGroup.priority;
  }

  const priorityDelta = getTemplatePriority(left) - getTemplatePriority(right);
  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  return left.name.localeCompare(right.name, 'zh-CN');
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
  const roleColorMap = new Map([
    ['团队领导', '#b45309'],
    ['团队负责人', '#d59b11'],
    ['研究员', '#5b5bd8'],
    ['执行者', '#378dff'],
    ['批评者', '#d04e4e'],
  ]);
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
  const requiredRoles = template.metadata?.teamTemplate?.requiredRoles ?? [];
  if (requiredRoles.length > 0) {
    return requiredRoles
      .map((roleValue) => mapCanonicalRoleToTemplateLabel(roleValue))
      .filter((label) => label.length > 0);
  }

  return template.nodes
    .filter((node) => node.type === 'subagent')
    .map((node) => node.label.split(' · ')[0]?.trim() ?? '')
    .filter((label) => label.length > 0);
}

function mapTemplatesToSections(templates: WorkflowTemplateRecord[]): AgentTeamsSidebarSection[] {
  const groups = new Map<string, AgentTeamsSidebarSection>();

  for (const template of [...templates].sort(sortTemplates)) {
    const group = getTemplateGroup(template);
    const sectionId = group.id;
    const section = groups.get(sectionId) ?? {
      id: sectionId,
      items: [],
      title: group.title,
    };

    const roleLabels = extractRoleLabels(template);
    section.items.push({
      badges: buildTemplateBadges(template),
      description:
        template.description ??
        `包含 ${roleLabels.length} 个角色节点的团队模板，可直接在 Team 页面复用。`,
      id: template.id,
      metaLine: buildTemplateMetaLine(template),
      roleTagRows: buildRoleRows(roleLabels),
      title: template.name,
    });
    groups.set(sectionId, section);
  }

  return Array.from(groups.values()).map((section) => ({
    ...section,
    items: [...section.items],
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

      const roleLabels = REQUIRED_TEMPLATE_ROLES.map((role) =>
        mapCanonicalRoleToTemplateLabel(role),
      );
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
          metadata: buildTeamTemplateMetadata(input.provider, input.optionalAgentIds),
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

  const templateCards = useMemo(
    () => [...templates].sort(sortTemplates).map((template) => toTemplateCard(template)),
    [templates],
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
    templateCards,
    templateCount: templates.length,
    templates,
  };
}
