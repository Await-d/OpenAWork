/**
 * 260516-team-phase-e · T-02 / T-03
 *
 * 模板分发机制 + TeamRoleAdapter。
 *
 * 分发优先级：overrides（用户自定义，存 DB）→ core（内置包）。
 * Adapter：每个角色层有一个 adapter 负责 resolve 具体的 agent 实现。
 */

import { sqliteAll, sqliteGet } from '../../infra/db.js';
import {
  teamWorkflowSchema,
  validateWorkflowConsistency,
  type TeamWorkflow,
} from './workflow-template-schema.js';
import { BUILTIN_WORKFLOWS } from './workflow-builtin-packs.js';

// ─── T-02: 模板分发 ────────────────────────────────────────────────────────

/**
 * 按优先级解析 workflow：overrides（DB）→ core（内置）。
 */
export function resolveWorkflow(input: {
  workflowId: string;
  userId: string;
}): TeamWorkflow | null {
  // 1. 查 DB overrides（用户自定义 / forked）
  const row = sqliteGet<{ metadata_json: string }>(
    `SELECT metadata_json FROM workflow_templates
     WHERE user_id = ? AND json_extract(metadata_json, '$.teamWorkflow.id') = ?
     LIMIT 1`,
    [input.userId, input.workflowId],
  );
  if (row) {
    try {
      const meta = JSON.parse(row.metadata_json) as Record<string, unknown>;
      const teamWorkflow = meta['teamWorkflow'];
      const parsed = teamWorkflowSchema.safeParse(teamWorkflow);
      if (parsed.success) {
        const validation = validateWorkflowConsistency(parsed.data);
        if (validation.valid) return parsed.data;
      }
    } catch (_parseErr) {
      void _parseErr;
    }
  }

  // 2. 查内置 core 包
  const builtin = BUILTIN_WORKFLOWS.find((w) => w.id === input.workflowId);
  return builtin ?? null;
}

/**
 * 列出用户可用的所有 workflow（内置 + 自定义）。
 */
export function listAvailableWorkflows(userId: string): TeamWorkflow[] {
  const results: TeamWorkflow[] = [...BUILTIN_WORKFLOWS];

  const rows = sqliteAll<{ metadata_json: string }>(
    `SELECT metadata_json FROM workflow_templates
     WHERE user_id = ? AND json_extract(metadata_json, '$.teamWorkflow') IS NOT NULL
     ORDER BY updated_at DESC`,
    [userId],
  );
  for (const row of rows) {
    try {
      const meta = JSON.parse(row.metadata_json) as Record<string, unknown>;
      const parsed = teamWorkflowSchema.safeParse(meta['teamWorkflow']);
      if (parsed.success) results.push(parsed.data);
    } catch (_parseErr) {
      void _parseErr;
    }
  }

  return results;
}

// ─── T-03: TeamRoleAdapter ──────────────────────────────────────────────────

export interface RoleAdapterResolution {
  /** agent 实现标识（对应 agent-catalog 中的 id） */
  agentImplKey: string;
  /** LLM provider 覆盖（null = 使用默认） */
  provider: string | null;
  /** 额外注入到 system prompt 的内容 */
  promptSuffix: string;
  /** 该角色可用的工具集 */
  toolsets: string[];
}

export interface TeamRoleAdapter {
  roleLayer: string;
  resolve(ctx: { userId: string; workflowId: string; stepId: string }): RoleAdapterResolution;
}

// 5 个内置 adapter

const receptionAdapter: TeamRoleAdapter = {
  roleLayer: 'reception',
  resolve: () => ({
    agentImplKey: 'interaction-agent',
    provider: null,
    promptSuffix: '你是接待层，负责把用户意图改写为结构化需求。',
    toolsets: ['read', 'web'],
  }),
};

const pm1Adapter: TeamRoleAdapter = {
  roleLayer: 'pm1',
  resolve: () => ({
    agentImplKey: 'planner',
    provider: null,
    promptSuffix: '你是 PM1 规划层，负责生成 spec/plan/tasks 产物链。',
    toolsets: ['read', 'write'],
  }),
};

const pm2Adapter: TeamRoleAdapter = {
  roleLayer: 'pm2',
  resolve: () => ({
    agentImplKey: 'team-leader',
    provider: null,
    promptSuffix: '你是 PM2 管控层，负责拆分任务并派发给执行团队。',
    toolsets: ['read', 'write', 'shell'],
  }),
};

const executorAdapter: TeamRoleAdapter = {
  roleLayer: 'executor',
  resolve: () => ({
    agentImplKey: 'executor',
    provider: null,
    promptSuffix: '你是执行层，负责按任务要求产出可工作的代码/文档。',
    toolsets: ['read', 'write', 'shell', 'lsp', 'test', 'desktop'],
  }),
};

const reviewerAdapter: TeamRoleAdapter = {
  roleLayer: 'reviewer',
  resolve: () => ({
    agentImplKey: 'reviewer',
    provider: null,
    promptSuffix: '你是评审层，负责检查产物质量和宪法合规。',
    toolsets: ['read', 'lsp', 'review'],
  }),
};

export const BUILTIN_ADAPTERS: readonly TeamRoleAdapter[] = [
  receptionAdapter,
  pm1Adapter,
  pm2Adapter,
  executorAdapter,
  reviewerAdapter,
];

export function resolveRoleAdapter(roleLayer: string): TeamRoleAdapter | null {
  return BUILTIN_ADAPTERS.find((a) => a.roleLayer === roleLayer) ?? null;
}
