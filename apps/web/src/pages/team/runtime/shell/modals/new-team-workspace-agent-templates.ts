import type {
  ResourceCatalog,
  ResourceTextCatalogEntry,
  UpsertTeamWorkspaceKnowledgeInput,
} from '@openAwork/web-client';

const WORKSPACE_TEMPLATE_KNOWLEDGE_LIMIT = 4000;
const WORKSPACE_TEMPLATE_PREFIX = 'resource-agent-template';

export function listWorkspaceAgentTemplates(
  resources: ResourceCatalog,
): readonly ResourceTextCatalogEntry[] {
  return resources.agentTemplates.filter(
    (template) =>
      template.visibility === 'feature' &&
      template.feature === 'team' &&
      template.usageKind === 'agent-template',
  );
}

export function buildWorkspaceTemplateKnowledgeInput(
  template: ResourceTextCatalogEntry,
): UpsertTeamWorkspaceKnowledgeInput {
  return {
    confidence: 1,
    key: `${WORKSPACE_TEMPLATE_PREFIX}:${template.name.trim().toLowerCase()}`,
    priority: 70,
    roleLayers: null,
    source: 'api',
    type: workspaceTemplateKnowledgeType(template),
    value: truncateWorkspaceTemplateValue(formatWorkspaceTemplateValue(template)),
  };
}

export function describeWorkspaceTemplateSource(template: ResourceTextCatalogEntry): string {
  if (template.source === 'user' || template.integration === 'user') {
    return '用户上传';
  }
  if (template.integration === 'builtin') {
    return '系统内置';
  }
  return '参考模板';
}

function workspaceTemplateKnowledgeType(
  template: ResourceTextCatalogEntry,
): UpsertTeamWorkspaceKnowledgeInput['type'] {
  const normalizedName = template.name.trim().toUpperCase();
  return normalizedName === 'SOUL' || normalizedName === 'USER' ? 'instruction' : 'project_context';
}

function formatWorkspaceTemplateValue(template: ResourceTextCatalogEntry): string {
  const header = [`# ${template.title}`, '', template.description.trim()]
    .filter((line) => line.length > 0)
    .join('\n');
  return [header, template.content.trim()].filter((part) => part.length > 0).join('\n\n');
}

function truncateWorkspaceTemplateValue(value: string): string {
  if (value.length <= WORKSPACE_TEMPLATE_KNOWLEDGE_LIMIT) {
    return value;
  }
  return value.slice(0, WORKSPACE_TEMPLATE_KNOWLEDGE_LIMIT - 20).trimEnd() + '\n\n[内容已截断]';
}
