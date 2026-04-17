import { randomUUID } from 'node:crypto';
import { sqliteAll, sqliteRun } from './db.js';
import {
  findMissingTeamTemplateDefaultBindingRoles,
  type TeamTemplateDefaultBindings,
  type TeamTemplateRole,
} from './team-template-metadata.js';

interface UserRow {
  id: string;
}

interface WorkflowTemplateRow {
  id: string;
  metadata_json: string;
}

interface WorkflowNode {
  id: string;
  label: string;
  type: 'start' | 'end' | 'prompt' | 'tool' | 'condition' | 'subagent';
  x?: number;
  y?: number;
}

interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
}

interface DefaultWorkflowTemplateSeed {
  category: 'team-playbook';
  description: string;
  edges: WorkflowEdge[];
  metadata: {
    origin: 'seed';
    seedKey: string;
    teamTemplate: {
      defaultBindings: TeamTemplateDefaultBindings;
      defaultProvider: string | null;
      optionalAgentIds: string[];
      recommendedDefault?: boolean;
      requiredRoles: TeamTemplateRole[];
      recommendedFor?: string;
      templateFocus?: string;
      templatePriority?: number;
      templateScale?: 'full' | 'large' | 'medium' | 'small';
    };
    templateKind: 'default-dev';
  };
  name: string;
  nodes: WorkflowNode[];
  seedKey: string;
}

const ROLE_LABEL_MAP: Record<TeamTemplateRole, string> = {
  leader: '团队领导',
  planner: '团队负责人',
  researcher: '研究员',
  executor: '执行者',
  reviewer: '批评者',
};

const PROVIDER_LABEL_MAP: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
  ollama: 'Ollama',
  openrouter: 'OpenRouter',
  qwen: 'Qwen',
  moonshot: 'Moonshot',
};

function buildSeedTemplateNodes(
  requiredRoles: TeamTemplateRole[],
  defaultBindings: TeamTemplateDefaultBindings,
): WorkflowNode[] {
  const nodes: WorkflowNode[] = [{ id: 'node-start', label: '开始', type: 'start', x: 40, y: 120 }];

  requiredRoles.forEach((role, index) => {
    const roleLabel = ROLE_LABEL_MAP[role] ?? role;
    const binding = defaultBindings[role];
    const providerLabel = binding?.providerId
      ? (PROVIDER_LABEL_MAP[binding.providerId] ?? binding.providerId)
      : null;
    const modelSuffix = providerLabel ? ` · ${providerLabel}` : '';
    nodes.push({
      id: `node-role-${index + 1}`,
      label: `${roleLabel}${modelSuffix}`,
      type: 'subagent',
      x: 220 + index * 180,
      y: 120 + (index % 2 === 0 ? 0 : 96),
    });
  });

  nodes.push({
    id: 'node-end',
    label: '结束',
    type: 'end',
    x: 220 + requiredRoles.length * 180,
    y: 120,
  });

  return nodes;
}

function buildSeedTemplateEdges(requiredRoles: TeamTemplateRole[]): WorkflowEdge[] {
  const nodeIds = [
    'node-start',
    ...requiredRoles.map((_, index) => `node-role-${index + 1}`),
    'node-end',
  ];

  return nodeIds.slice(0, -1).map((source, index) => ({
    id: `edge-${source}-${nodeIds[index + 1]}`,
    source,
    target: nodeIds[index + 1]!,
  }));
}

function assertCompleteDefaultBindings(template: DefaultWorkflowTemplateSeed): void {
  const missingRoles = findMissingTeamTemplateDefaultBindingRoles(
    template.metadata.teamTemplate.defaultBindings,
  );
  if (missingRoles.length > 0) {
    throw new Error(
      `Default workflow template '${template.seedKey}' is missing bindings for ${missingRoles.join(', ')}`,
    );
  }
}

const PURE_OPENAI_BINDINGS: TeamTemplateDefaultBindings = {
  leader: { agentId: 'zeus', providerId: 'openai', modelId: 'gpt-5.4', variant: 'xhigh' },
  planner: { agentId: 'prometheus', providerId: 'openai', modelId: 'gpt-5.4', variant: 'xhigh' },
  researcher: { agentId: 'librarian', providerId: 'openai', modelId: 'gpt-5.4', variant: 'medium' },
  executor: { agentId: 'hephaestus', providerId: 'openai', modelId: 'gpt-5.4', variant: 'high' },
  reviewer: { agentId: 'momus', providerId: 'openai', modelId: 'gpt-5.4', variant: 'medium' },
};

const PURE_ANTHROPIC_BINDINGS: TeamTemplateDefaultBindings = {
  leader: {
    agentId: 'zeus',
    providerId: 'anthropic',
    modelId: 'claude-opus-4-6',
    variant: 'xhigh',
  },
  planner: {
    agentId: 'prometheus',
    providerId: 'anthropic',
    modelId: 'claude-opus-4-6',
    variant: 'xhigh',
  },
  researcher: {
    agentId: 'librarian',
    providerId: 'anthropic',
    modelId: 'claude-haiku-4-5',
    variant: 'medium',
  },
  executor: {
    agentId: 'hephaestus',
    providerId: 'anthropic',
    modelId: 'claude-sonnet-4-6',
    variant: 'high',
  },
  reviewer: {
    agentId: 'momus',
    providerId: 'anthropic',
    modelId: 'claude-opus-4-6',
    variant: 'high',
  },
};

const MIXED_BINDINGS: TeamTemplateDefaultBindings = {
  leader: { agentId: 'zeus', providerId: 'openai', modelId: 'gpt-5.4', variant: 'high' },
  planner: {
    agentId: 'prometheus',
    providerId: 'anthropic',
    modelId: 'claude-opus-4-6',
    variant: 'xhigh',
  },
  researcher: {
    agentId: 'librarian',
    providerId: 'anthropic',
    modelId: 'claude-haiku-4-5',
    variant: 'medium',
  },
  executor: { agentId: 'hephaestus', providerId: 'openai', modelId: 'gpt-5.4', variant: 'high' },
  reviewer: { agentId: 'momus', providerId: 'openai', modelId: 'gpt-5.4', variant: 'medium' },
};

const REQUIRED_ROLES: TeamTemplateRole[] = [
  'leader',
  'planner',
  'researcher',
  'executor',
  'reviewer',
];

export const DEFAULT_WORKFLOW_TEMPLATE_SEEDS: DefaultWorkflowTemplateSeed[] = [
  {
    seedKey: 'dev-team-full',
    name: '完整开发团队（OpenAI + Anthropic 混合）',
    description:
      '适合复杂功能开发、方案设计、实现与严格评审的完整开发闭环。规划与调研用 Claude 深度思考，领导与执行用 GPT 快速推进。',
    category: 'team-playbook',
    metadata: {
      origin: 'seed',
      seedKey: 'dev-team-full',
      templateKind: 'default-dev',
      teamTemplate: {
        defaultProvider: 'openai',
        defaultBindings: MIXED_BINDINGS,
        optionalAgentIds: ['atlas', 'metis', 'sisyphus-junior'],
        recommendedDefault: false,
        requiredRoles: REQUIRED_ROLES,
        recommendedFor: '复杂跨模块需求、需要完整交付闭环的开发任务',
        templateFocus: '全流程交付 · 混合供应商',
        templatePriority: 2,
        templateScale: 'full',
      },
    },
    nodes: buildSeedTemplateNodes(REQUIRED_ROLES, MIXED_BINDINGS),
    edges: buildSeedTemplateEdges(REQUIRED_ROLES),
  },
  {
    seedKey: 'dev-team-large',
    name: '大型开发团队（纯 Anthropic）',
    description:
      '适合复杂需求拆解与多阶段交付，强调分析、执行与质量审阅。全部角色使用 Claude 系列。',
    category: 'team-playbook',
    metadata: {
      origin: 'seed',
      seedKey: 'dev-team-large',
      templateKind: 'default-dev',
      teamTemplate: {
        defaultProvider: 'anthropic',
        defaultBindings: PURE_ANTHROPIC_BINDINGS,
        optionalAgentIds: ['atlas', 'metis'],
        recommendedDefault: false,
        requiredRoles: REQUIRED_ROLES,
        recommendedFor: '复杂功能开发、多阶段交付推进与里程碑管理',
        templateFocus: '复杂交付推进 · 纯 Claude',
        templatePriority: 4,
        templateScale: 'large',
      },
    },
    nodes: buildSeedTemplateNodes(REQUIRED_ROLES, PURE_ANTHROPIC_BINDINGS),
    edges: buildSeedTemplateEdges(REQUIRED_ROLES),
  },
  {
    seedKey: 'dev-team-medium',
    name: '中型开发团队（纯 OpenAI）',
    description: '适合常规功能开发、缺陷修复和中等范围重构。全部角色使用 GPT 系列。',
    category: 'team-playbook',
    metadata: {
      origin: 'seed',
      seedKey: 'dev-team-medium',
      templateKind: 'default-dev',
      teamTemplate: {
        defaultProvider: 'openai',
        defaultBindings: PURE_OPENAI_BINDINGS,
        optionalAgentIds: ['atlas'],
        recommendedDefault: true,
        requiredRoles: REQUIRED_ROLES,
        recommendedFor: '常规功能开发、缺陷修复与中等范围重构',
        templateFocus: '日常功能开发 · 纯 GPT',
        templatePriority: 1,
        templateScale: 'medium',
      },
    },
    nodes: buildSeedTemplateNodes(REQUIRED_ROLES, PURE_OPENAI_BINDINGS),
    edges: buildSeedTemplateEdges(REQUIRED_ROLES),
  },
  {
    seedKey: 'dev-team-small',
    name: '小型开发团队（OpenAI + Anthropic 混合）',
    description: '适合小需求、明确任务和快速交付的轻量开发模板。规划用 Claude，执行用 GPT。',
    category: 'team-playbook',
    metadata: {
      origin: 'seed',
      seedKey: 'dev-team-small',
      templateKind: 'default-dev',
      teamTemplate: {
        defaultProvider: 'anthropic',
        defaultBindings: MIXED_BINDINGS,
        optionalAgentIds: [],
        recommendedDefault: false,
        requiredRoles: REQUIRED_ROLES,
        recommendedFor: '小需求、快速迭代与明确任务的直接落地',
        templateFocus: '快速小步迭代 · 混合供应商',
        templatePriority: 3,
        templateScale: 'small',
      },
    },
    nodes: buildSeedTemplateNodes(REQUIRED_ROLES, MIXED_BINDINGS),
    edges: buildSeedTemplateEdges(REQUIRED_ROLES),
  },
];

for (const template of DEFAULT_WORKFLOW_TEMPLATE_SEEDS) {
  assertCompleteDefaultBindings(template);
}

function parseSeedKey(metadataJson: string): string | null {
  try {
    const parsed = JSON.parse(metadataJson) as { seedKey?: unknown };
    return typeof parsed.seedKey === 'string' ? parsed.seedKey : null;
  } catch {
    return null;
  }
}

export function ensureDefaultWorkflowTemplates(userId: string): void {
  const existingRows = sqliteAll<WorkflowTemplateRow>(
    'SELECT id, metadata_json FROM workflow_templates WHERE user_id = ?',
    [userId],
  );

  const existingBySeedKey = new Map<string, string>();
  for (const row of existingRows) {
    const seedKey = parseSeedKey(row.metadata_json);
    if (seedKey) {
      existingBySeedKey.set(seedKey, row.id);
    }
  }

  for (const template of DEFAULT_WORKFLOW_TEMPLATE_SEEDS) {
    const existingId = existingBySeedKey.get(template.seedKey);
    if (existingId) {
      sqliteRun(
        `UPDATE workflow_templates
         SET name = ?, description = ?, category = ?, metadata_json = ?, nodes_json = ?, edges_json = ?, updated_at = datetime('now')
         WHERE id = ? AND user_id = ?`,
        [
          template.name,
          template.description,
          template.category,
          JSON.stringify(template.metadata),
          JSON.stringify(template.nodes),
          JSON.stringify(template.edges),
          existingId,
          userId,
        ],
      );
      continue;
    }

    sqliteRun(
      `INSERT INTO workflow_templates (id, user_id, name, description, category, metadata_json, nodes_json, edges_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        userId,
        template.name,
        template.description,
        template.category,
        JSON.stringify(template.metadata),
        JSON.stringify(template.nodes),
        JSON.stringify(template.edges),
      ],
    );
  }
}

export function ensureDefaultWorkflowTemplatesForAllUsers(): void {
  const users = sqliteAll<UserRow>('SELECT id FROM users');
  for (const user of users) {
    ensureDefaultWorkflowTemplates(user.id);
  }
}
