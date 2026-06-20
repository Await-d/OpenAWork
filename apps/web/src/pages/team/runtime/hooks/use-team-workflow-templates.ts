import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createWorkflowsClient,
  type UpdateWorkflowTemplateInput,
  type WorkflowEdgeRecord,
  type WorkflowNodeRecord,
  type WorkflowTemplateMetadata,
  type WorkflowTemplateRecord,
  type WorkflowTemplateScale,
} from '@openAwork/web-client';
import { useAuthStore } from '../../../../stores/auth/auth.js';
import { useTeamEventsConnectionStore } from '../../../../stores/team/team-events.js';
import {
  computeExponentialRetryDelay,
  formatRecoverableLoadError,
} from '../../hooks/recoverable-read-model.js';
import { useRecoverableRetryController } from '../../hooks/use-recoverable-retry.js';
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
  description?: string;
  /**
   * 模板花名册（按层分组的 visible member slots）。如果提供，则会写入
   * metadata.teamTemplate.memberSlots，作为新建 session 的默认 roster。
   * 不提供时使用 DEFAULT_FIXED_TEAM_MEMBER_SLOTS 的默认花名册。
   */
  memberSlots?: import('@openAwork/web-client').WorkflowTeamTemplateMetadata['memberSlots'];
  /** 候选模型池（智能分配模型功能）。 */
  modelPool?: import('@openAwork/web-client').WorkflowTeamTemplateModelRef[];
  /** 智能分配策略。 */
  modelAssignStrategy?: import('@openAwork/web-client').WorkflowTeamTemplateModelStrategy;
  name: string;
  optionalAgentIds?: string[];
  provider: string;
  /** 额外 metadata 字段（focus / scale / recommendedFor / recommendedDefault）。 */
  templateExtra?: {
    templateScale?: import('@openAwork/web-client').WorkflowTemplateScale | null;
    templateFocus?: string | null;
    recommendedFor?: string | null;
    recommendedDefault?: boolean | null;
  };
}

const REQUIRED_TEMPLATE_ROLES: Array<
  'leader' | 'planner' | 'researcher' | 'executor' | 'reviewer'
> = ['leader', 'planner', 'researcher', 'executor', 'reviewer'];

const TEAM_WORKFLOW_TEMPLATES_RETRY_BASE_MS = 2_000;
const TEAM_WORKFLOW_TEMPLATES_RETRY_MAX_MS = 30_000;

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
  memberSlots?: import('@openAwork/web-client').WorkflowTeamTemplateMetadata['memberSlots'],
  extras?: {
    templateScale?: import('@openAwork/web-client').WorkflowTemplateScale | null;
    templateFocus?: string | null;
    recommendedFor?: string | null;
    recommendedDefault?: boolean | null;
  },
  modelPool?: import('@openAwork/web-client').WorkflowTeamTemplateModelRef[],
  modelAssignStrategy?: import('@openAwork/web-client').WorkflowTeamTemplateModelStrategy,
): WorkflowTemplateMetadata {
  return {
    teamTemplate: {
      ...(defaultBindings ? { defaultBindings } : {}),
      defaultProvider: provider,
      ...(memberSlots && memberSlots.length > 0 ? { memberSlots } : {}),
      ...(modelPool && modelPool.length > 0 ? { modelPool } : {}),
      ...(modelAssignStrategy ? { modelAssignStrategy } : {}),
      optionalAgentIds,
      requiredRoles: REQUIRED_TEMPLATE_ROLES,
      ...(extras ?? {}),
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

export function computeTeamWorkflowTemplatesRetryDelay(attempt: number): number {
  return computeExponentialRetryDelay({
    attempt,
    baseMs: TEAM_WORKFLOW_TEMPLATES_RETRY_BASE_MS,
    maxMs: TEAM_WORKFLOW_TEMPLATES_RETRY_MAX_MS,
  });
}

export function formatTeamWorkflowTemplatesLoadError(input: {
  hasCachedData: boolean;
  nextRetryAtMs?: number | null;
  result: { errorMessage?: string; retryable: boolean };
}): string {
  return formatRecoverableLoadError({
    baseMessage: input.result.errorMessage ?? '加载团队模板失败。',
    hasRetainedData: input.hasCachedData,
    nextRetryAtMs: input.nextRetryAtMs,
    retainedDataLabel: '模板数据',
    retryable: input.result.retryable,
  });
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
    ['团队领导', 'var(--warning)'],
    ['团队负责人', 'var(--warning)'],
    ['研究员', 'var(--accent)'],
    ['执行者', 'var(--aux)'],
    ['批评者', 'var(--danger)'],
  ]);
  const tags = roleLabels.map((label) => ({
    color: roleColorMap.get(label) ?? 'var(--chart-5)',
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
  const [refreshTick, setRefreshTick] = useState(0);
  const templatesRef = useRef<WorkflowTemplateRecord[]>([]);
  const teamEventsRecoveredAt = useTeamEventsConnectionStore((state) => state.lastRecoveredAt);
  const { clearRetry, resetRetry, scheduleRetry } = useRecoverableRetryController();

  const refresh = useCallback(() => {
    setRefreshTick((current) => current + 1);
  }, []);

  const refreshLatest = useCallback(async (): Promise<WorkflowTemplateRecord[]> => {
    if (!accessToken) {
      resetRetry();
      setTemplates([]);
      setLoading(false);
      setError(null);
      return [];
    }

    setLoading(true);
    setError(null);
    const templatesResult = await client.listTemplatesResult(accessToken);
    if (templatesResult.ok) {
      const teamTemplates = templatesResult.templates.filter(
        (template) => template.category === 'team-playbook',
      );
      setTemplates(teamTemplates);
      resetRetry();
      setLoading(false);
      setError(null);
      return teamTemplates;
    }

    setLoading(false);
    setError(
      formatTeamWorkflowTemplatesLoadError({
        hasCachedData: templatesRef.current.length > 0,
        result: templatesResult,
      }),
    );
    return templatesRef.current;
  }, [accessToken, client, resetRetry]);

  useEffect(() => {
    templatesRef.current = templates;
  }, [templates]);

  useEffect(() => {
    let cancelled = false;
    clearRetry();

    if (!accessToken) {
      resetRetry();
      setTemplates([]);
      setLoading(false);
      setError(null);
      return;
    }

    const hasCachedData = templatesRef.current.length > 0;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      resetRetry();
      setLoading(false);
      setError(
        formatTeamWorkflowTemplatesLoadError({
          hasCachedData,
          result: {
            errorMessage: '当前网络离线，团队模板暂时不可用。',
            retryable: true,
          },
        }),
      );
      return;
    }

    setLoading(!hasCachedData);
    setError(null);

    void client.listTemplatesResult(accessToken).then((templatesResult) => {
      if (cancelled) {
        return;
      }

      if (templatesResult.ok) {
        setTemplates(
          templatesResult.templates.filter((template) => template.category === 'team-playbook'),
        );
      } else {
        const nextRetryAtMs = scheduleRetry({
          computeDelay: computeTeamWorkflowTemplatesRetryDelay,
          onRetry: refresh,
          retryable: templatesResult.retryable,
        });
        setLoading(false);
        setError(
          formatTeamWorkflowTemplatesLoadError({
            hasCachedData: templatesRef.current.length > 0,
            nextRetryAtMs,
            result: templatesResult,
          }),
        );
        return;
      }

      resetRetry();
      setLoading(false);
      setError(null);
    });

    return () => {
      cancelled = true;
    };
  }, [accessToken, clearRetry, client, refresh, refreshTick, resetRetry, scheduleRetry]);

  useEffect(() => {
    return () => {
      clearRetry();
    };
  }, [clearRetry]);

  useEffect(() => {
    if (!accessToken || typeof window === 'undefined') {
      return;
    }
    const handleOnline = () => {
      resetRetry();
      refresh();
    };
    const handleOffline = () => {
      resetRetry();
      setLoading(false);
      setError(
        formatTeamWorkflowTemplatesLoadError({
          hasCachedData: templatesRef.current.length > 0,
          result: {
            errorMessage: '当前网络离线，团队模板暂时不可用。',
            retryable: true,
          },
        }),
      );
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [accessToken, refresh, resetRetry]);

  useEffect(() => {
    if (!accessToken || !teamEventsRecoveredAt) {
      return;
    }
    resetRetry();
    refresh();
  }, [accessToken, refresh, resetRetry, teamEventsRecoveredAt]);

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
          description:
            input.description?.trim() ||
            buildTemplateDescription(input.name, providerLabel, roleLabels),
          edges: buildTemplateEdges(roleLabels),
          metadata: buildTeamTemplateMetadata(
            input.provider,
            input.optionalAgentIds,
            input.defaultBindings,
            input.memberSlots,
            input.templateExtra,
            input.modelPool,
            input.modelAssignStrategy,
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
    return [...templates].sort(sortTemplates).map((template) => toTemplateCard(template));
  }, [templates]);
  const sections = useMemo(() => mapTemplatesToSections(templates), [templates]);

  return {
    busy,
    canCreateTemplate: Boolean(accessToken),
    createTemplate,
    duplicateTemplate,
    error,
    loading,
    refresh,
    refreshLatest,
    removeTemplate,
    sections,
    templateCards,
    templateCount: templates.length,
    templates,
    updateTemplate,
  };
}
