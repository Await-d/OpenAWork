import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createTeamWorkflowsClient,
  createWorkflowsClient,
  type TeamWorkflowWithDbId,
  type UpdateWorkflowTemplateInput,
  type WorkflowEdgeRecord,
  type WorkflowNodeRecord,
  type WorkflowTemplateMetadata,
  type WorkflowTemplateRecord,
  type WorkflowTemplateScale,
} from '@openAwork/web-client';
import { useAuthStore } from '../../../../stores/auth/auth.js';
import { agentTeamsNewTemplateProviders } from '../data/team-runtime-ui-config.js';
import type {
  AgentTeamsSidebarSection,
  AgentTeamsSidebarTemplateBadge,
  AgentTeamsWorkflowTemplateCard,
} from '../data/team-runtime-types.js';

interface CreateTeamWorkflowTemplateInput {
  defaultBindings?: Record<
    string,
    { agentId: string; providerId?: string; modelId?: string; variant?: string }
  >;
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
  defaultBindings?: Record<
    string,
    { agentId: string; providerId?: string; modelId?: string; variant?: string }
  >,
): WorkflowTemplateMetadata {
  return {
    teamTemplate: {
      ...(defaultBindings ? { defaultBindings } : {}),
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
  workflows: { id: 'team-workflows', title: '团队工作流', priority: 0 },
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

/**
 * 把后端 GET /team/workflows 返回的 workflow 包转换成前端模板卡片，
 * 让 NewTeamSessionModal 的同一个模板选择器同时显示「内置 workflow」+
 * 「自定义模板」两组。
 *
 * 转换约定：
 *   - id 直接使用 workflow._dbId（自定义） 或 'workflow:' + workflow.id（内置）；
 *     这样选中后 NewTeamSessionModal 调 createTeamWorkspaceSession 时，
 *     templateId 一律可以走 saved-template 路径（内置包同样持久化在
 *     workflow_templates 表，由后端在 BUILTIN_WORKFLOWS 兜底）。
 *   - 'team-playbook' category 与现有模板一致，复用 metadata.teamTemplate
 *     字段表达 default provider / optionalAgentIds / requiredRoles。
 *   - 自定义 workflow 没有 _dbId 时仍可作为预览使用（templateId 留空，
 *     NewTeamSessionModal 会显示「无法创建」灰态，引导用户先保存）。
 */
function toWorkflowCard(workflow: TeamWorkflowWithDbId): AgentTeamsWorkflowTemplateCard {
  const group = TEMPLATE_GROUPS.workflows;
  const id = workflow._dbId ?? `workflow:${workflow.id}`;
  const stepLabels = workflow.steps.slice(0, 5).map((step) => step.label);
  const metaLine = `共 ${workflow.steps.length} 步：${stepLabels.join(' → ')}${
    workflow.steps.length > stepLabels.length ? ' …' : ''
  }`;
  const badges: AgentTeamsSidebarTemplateBadge[] = [];
  if (workflow.source === 'builtin') {
    badges.push({ label: '内置', tone: 'accent' });
  } else if (workflow.source === 'forked') {
    badges.push({ label: 'Fork', tone: 'warning' });
  } else {
    badges.push({ label: '自定义', tone: 'success' });
  }
  badges.push({ label: `v${workflow.version}`, tone: 'default' });

  return {
    id,
    name: workflow.name,
    category: 'team-playbook',
    description: workflow.description,
    metadata: {
      teamTemplate: {
        defaultProvider: '',
        optionalAgentIds: [],
        requiredRoles: [],
        templateFocus: workflow.tags.join(' · '),
      },
    },
    nodes: [],
    edges: [],
    createdAt: '',
    updatedAt: '',
    badges,
    groupId: group.id,
    groupPriority: group.priority,
    groupTitle: group.title,
    metaLine,
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
    ['团队领导', 'var(--warning))'],
    ['团队负责人', 'var(--warning))'],
    ['研究员', 'var(--accent))'],
    ['执行者', 'var(--aux))'],
    ['批评者', 'var(--danger))'],
  ]);
  const tags = roleLabels.map((label) => ({
    color: roleColorMap.get(label) ?? 'var(--chart-5))',
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
  const workflowsClient = useMemo(() => createTeamWorkflowsClient(gatewayUrl), [gatewayUrl]);
  const [templates, setTemplates] = useState<WorkflowTemplateRecord[]>([]);
  const [workflows, setWorkflows] = useState<TeamWorkflowWithDbId[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!accessToken) {
      setTemplates([]);
      setWorkflows([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [nextTemplates, nextWorkflows] = await Promise.all([
        client.listTemplates(accessToken),
        workflowsClient.list(accessToken),
      ]);
      setTemplates(nextTemplates.filter((template) => template.category === 'team-playbook'));
      setWorkflows(nextWorkflows);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '加载团队模板失败');
    } finally {
      setLoading(false);
    }
  }, [accessToken, client, workflowsClient]);

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
          metadata: buildTeamTemplateMetadata(
            input.provider,
            input.optionalAgentIds,
            input.defaultBindings,
          ),
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

  const removeTemplate = useCallback(
    async (templateId: string) => {
      if (!accessToken) return false;
      setBusy(true);
      setError(null);
      try {
        await client.removeTemplate(accessToken, templateId);
        setTemplates((current) => current.filter((t) => t.id !== templateId));
        return true;
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '删除模板失败');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [accessToken, client],
  );

  const duplicateTemplate = useCallback(
    async (source: WorkflowTemplateRecord) => {
      if (!accessToken) return false;
      setBusy(true);
      setError(null);
      try {
        const created = await client.createTemplate(accessToken, {
          name: `${source.name} (副本)`,
          description: source.description ?? undefined,
          category: source.category,
          metadata: source.metadata,
          nodes: source.nodes,
          edges: source.edges,
        });
        setTemplates((current) => [created, ...current]);
        return true;
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '复制模板失败');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [accessToken, client],
  );

  const updateTemplate = useCallback(
    async (templateId: string, input: UpdateWorkflowTemplateInput) => {
      if (!accessToken) return false;
      setBusy(true);
      setError(null);
      try {
        const updated = await client.updateTemplate(accessToken, templateId, input);
        setTemplates((current) => current.map((t) => (t.id === templateId ? updated : t)));
        return true;
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '更新模板失败');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [accessToken, client],
  );

  const templateCards = useMemo(() => {
    const baseCards = [...templates]
      .sort(sortTemplates)
      .map((template) => toTemplateCard(template));
    const workflowCards: AgentTeamsWorkflowTemplateCard[] = workflows.map((workflow) =>
      toWorkflowCard(workflow),
    );
    return [...workflowCards, ...baseCards];
  }, [templates, workflows]);
  const sections = useMemo(() => mapTemplatesToSections(templates), [templates]);

  return {
    busy,
    canCreateTemplate: Boolean(accessToken),
    createTemplate,
    duplicateTemplate,
    error,
    loading,
    refresh,
    removeTemplate,
    sections,
    templateCards,
    templateCount: templates.length,
    templates,
    updateTemplate,
  };
}
