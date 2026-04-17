import { randomUUID } from 'node:crypto';
import { sqliteAll, sqliteRun } from './db.js';
import {
  buildFixedTeamTemplateDefaultBindings,
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

interface DefaultWorkflowTemplateSeed {
  category: 'team-playbook';
  description: string;
  edges: unknown[];
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
  nodes: unknown[];
  seedKey: string;
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

export const DEFAULT_WORKFLOW_TEMPLATE_SEEDS: DefaultWorkflowTemplateSeed[] = [
  {
    seedKey: 'dev-team-full',
    name: '完整开发团队',
    description: '适合复杂功能开发、方案设计、实现与严格评审的完整开发闭环。',
    category: 'team-playbook',
    metadata: {
      origin: 'seed',
      seedKey: 'dev-team-full',
      templateKind: 'default-dev',
      teamTemplate: {
        defaultProvider: 'claude-code',
        defaultBindings: buildFixedTeamTemplateDefaultBindings(),
        optionalAgentIds: ['atlas', 'metis', 'sisyphus-junior'],
        recommendedDefault: false,
        requiredRoles: ['planner', 'researcher', 'executor', 'reviewer'],
        recommendedFor: '复杂跨模块需求、需要完整交付闭环的开发任务',
        templateFocus: '全流程交付',
        templatePriority: 2,
        templateScale: 'full',
      },
    },
    nodes: [],
    edges: [],
  },
  {
    seedKey: 'dev-team-large',
    name: '大型开发团队',
    description: '适合复杂需求拆解与多阶段交付，强调分析、执行与质量审阅。',
    category: 'team-playbook',
    metadata: {
      origin: 'seed',
      seedKey: 'dev-team-large',
      templateKind: 'default-dev',
      teamTemplate: {
        defaultProvider: 'claude-code',
        defaultBindings: buildFixedTeamTemplateDefaultBindings(),
        optionalAgentIds: ['atlas', 'metis'],
        recommendedDefault: false,
        requiredRoles: ['planner', 'researcher', 'executor', 'reviewer'],
        recommendedFor: '复杂功能开发、多阶段交付推进与里程碑管理',
        templateFocus: '复杂交付推进',
        templatePriority: 4,
        templateScale: 'large',
      },
    },
    nodes: [],
    edges: [],
  },
  {
    seedKey: 'dev-team-medium',
    name: '中型开发团队',
    description: '适合常规功能开发、缺陷修复和中等范围重构。',
    category: 'team-playbook',
    metadata: {
      origin: 'seed',
      seedKey: 'dev-team-medium',
      templateKind: 'default-dev',
      teamTemplate: {
        defaultProvider: 'claude-code',
        defaultBindings: buildFixedTeamTemplateDefaultBindings(),
        optionalAgentIds: ['atlas'],
        recommendedDefault: true,
        requiredRoles: ['planner', 'researcher', 'executor', 'reviewer'],
        recommendedFor: '常规功能开发、缺陷修复与中等范围重构',
        templateFocus: '日常功能开发',
        templatePriority: 1,
        templateScale: 'medium',
      },
    },
    nodes: [],
    edges: [],
  },
  {
    seedKey: 'dev-team-small',
    name: '小型开发团队',
    description: '适合小需求、明确任务和快速交付的轻量开发模板。',
    category: 'team-playbook',
    metadata: {
      origin: 'seed',
      seedKey: 'dev-team-small',
      templateKind: 'default-dev',
      teamTemplate: {
        defaultProvider: 'claude-code',
        defaultBindings: buildFixedTeamTemplateDefaultBindings(),
        optionalAgentIds: [],
        recommendedDefault: false,
        requiredRoles: ['planner', 'researcher', 'executor', 'reviewer'],
        recommendedFor: '小需求、快速迭代与明确任务的直接落地',
        templateFocus: '快速小步迭代',
        templatePriority: 3,
        templateScale: 'small',
      },
    },
    nodes: [],
    edges: [],
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
