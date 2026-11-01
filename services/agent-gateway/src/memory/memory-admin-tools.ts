/**
 * `memory_manage` —— 会话内模型**提交待确认记忆提议**（不再直接写正式记忆）。
 *
 * 设计边界（261101-记忆确认写入与周期整理）：
 * - 只针对当前会话 owner 的记忆；工具不接受 userId 参数；
 * - add / update / delete 一律创建 `MemoryProposal`（`origin: 'tool'`），返回
 *   `status: 'pending_confirmation'`，由用户在确认路由批准后才落地；
 * - `list` 仍为只读列举，保持不变；
 * - 提交前提议内容必须过 `scanMemoryWriteContent`（与 `POST/PUT /memories` 同规）；
 * - v1 不写 `teamWorkspaceId`（团队知识记忆不开放给模型自助管理）；
 * - team / cron / channel 会话直接拒绝（记忆是用户级长期上下文，后台会话不得改写）；
 * - 真正写入门在 `POST /memories/proposals/:id/decision`，工具本身**不再是**写入点。
 */

import { z } from 'zod';
import type { ToolDefinition } from '@openAwork/agent-core';
import { MEMORY_ROLE_LAYERS, MEMORY_TYPES, userMemoryScope } from '@openAwork/agent-core';
import type { MemoryEntry } from '@openAwork/agent-core';
import { sqliteGet } from '../infra/db.js';
import { findEnabledMemoryByTypeAndKey, getMemoryById, listMemories } from './memory-store.js';
import { createMemoryProposal } from './governance/memory-proposal-store.js';
import { scanMemoryWriteContent } from './memory-security-scanner.js';
import { MEMORY_MANAGE_TOOL_NAME } from './memory-manage-tool-name.js';

export { MEMORY_MANAGE_TOOL_NAME } from './memory-manage-tool-name.js';

const MEMORY_VALUE_PREVIEW_CHARS = 500;

// ---------------------------------------------------------------------------
// 输入 schema
// ---------------------------------------------------------------------------

const memoryDraftSchema = z
  .object({
    type: z.enum(MEMORY_TYPES).optional(),
    key: z.string().trim().min(1).max(200).optional(),
    value: z.string().trim().min(1).max(4000).optional(),
    priority: z.number().int().min(0).max(100).optional(),
    confidence: z.number().min(0).max(1).optional(),
    workspaceRoot: z.string().trim().max(500).nullable().optional(),
    roleLayers: z.array(z.enum(MEMORY_ROLE_LAYERS)).max(5).nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export type MemoryManageDraft = z.infer<typeof memoryDraftSchema>;

export const memoryManageInputSchema = z
  .object({
    action: z.enum(['list', 'add', 'update', 'delete']),
    memoryId: z.string().trim().min(1).max(200).optional(),
    memory: memoryDraftSchema.optional(),
    search: z.string().trim().max(200).optional(),
    type: z.enum(MEMORY_TYPES).optional(),
    enabled: z.boolean().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.action === 'add') {
      if (!value.memory?.type || !value.memory.key || !value.memory.value) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'add 必须提供 memory.type / memory.key / memory.value。',
          path: ['memory'],
        });
      }
      return;
    }
    if (value.action === 'update' || value.action === 'delete') {
      if (!value.memoryId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${value.action} 必须提供 memoryId。`,
          path: ['memoryId'],
        });
      }
      if (value.action === 'update' && !value.memory) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'update 必须提供 memory 字段。',
          path: ['memory'],
        });
      }
    }
  });

export const memoryManageToolDefinition: ToolDefinition<
  typeof memoryManageInputSchema,
  z.ZodString
> = {
  name: MEMORY_MANAGE_TOOL_NAME,
  description:
    '管理当前用户的长期记忆。action=list 检索/列举（可按 search / type / enabled 过滤）；add 新增；update 修改（含 enabled 启停）；delete 删除。' +
    '注意：add / update / delete **仅提交一条待用户确认的记忆提议，确认后才真正生效**，' +
    '返回 `status: "pending_confirmation"` 与 `proposalId`；在用户确认前记忆不会发生变化，' +
    '请如实告知用户「已提交待确认」。提交前会做安全校验。不支持团队知识记忆。',
  inputSchema: memoryManageInputSchema,
  outputSchema: z.string(),
  timeout: 30000,
  execute: async () => {
    throw new Error('memory_manage must execute through the gateway-managed sandbox path');
  },
};

// ---------------------------------------------------------------------------
// 会话守卫（fail-closed）
// ---------------------------------------------------------------------------

export interface MemoryManageSessionRow {
  metadata_json: string;
  role_layer: string | null;
  team_parent_session_id: string | null;
  handoff_state: string | null;
}

const TEAM_ROLE_LAYERS = new Set(['pm1', 'pm2', 'executor', 'reviewer', 'reception']);

/**
 * 返回拒绝原因；`null` 表示允许进入正常权限门控。
 *
 * 与 `mcp_manage_servers` 的守卫同构：team 后台会被权限层自动免审批，
 * cron 会话无人审批，channel 会话不应改个人长期记忆——三类都在此拒绝。
 */
export function resolveMemoryManageSessionDenial(
  row: MemoryManageSessionRow | null,
): string | null {
  if (!row) {
    return '当前会话不存在或无法解析，已拒绝记忆变更。';
  }
  let metadata: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(row.metadata_json);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      metadata = parsed as Record<string, unknown>;
    }
  } catch {
    // 坏 metadata 不阻止守卫判定，按无 metadata 处理。
  }

  const roleLayer = typeof row.role_layer === 'string' ? row.role_layer.trim() : '';
  const hasTeamParent =
    typeof row.team_parent_session_id === 'string' && row.team_parent_session_id.trim().length > 0;
  const hasTeamMetadata =
    typeof metadata['teamWorkspaceId'] === 'string' ||
    (typeof metadata['teamRoleInstance'] === 'object' && metadata['teamRoleInstance'] !== null);
  if (TEAM_ROLE_LAYERS.has(roleLayer) || hasTeamParent || hasTeamMetadata) {
    return '团队会话不允许修改用户记忆，请回到个人会话操作。';
  }

  const source = typeof metadata['source'] === 'string' ? metadata['source'] : '';
  if (source === 'cron') {
    return '定时任务会话无人审批，不允许修改用户记忆。';
  }
  if (source === 'channel') {
    return '消息渠道会话不允许修改用户记忆，请在设置页或桌面端操作。';
  }

  return null;
}

function readMemoryManageSessionRow(sessionId: string): MemoryManageSessionRow | null {
  return (
    sqliteGet<MemoryManageSessionRow>(
      'SELECT metadata_json, role_layer, team_parent_session_id, handoff_state FROM sessions WHERE id = ? LIMIT 1',
      [sessionId],
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// 输出与安全扫描
// ---------------------------------------------------------------------------

function toMemorySummary(memory: MemoryEntry): Record<string, unknown> {
  return {
    id: memory.id,
    type: memory.type,
    key: memory.key,
    value:
      memory.value.length > MEMORY_VALUE_PREVIEW_CHARS
        ? `${memory.value.slice(0, MEMORY_VALUE_PREVIEW_CHARS)}…`
        : memory.value,
    source: memory.source,
    priority: memory.priority,
    confidence: memory.confidence,
    enabled: memory.enabled,
    updatedAt: memory.updatedAt,
  };
}

function assertMemoryContentAllowed(
  fields: ReadonlyArray<{ label: string; content: string | undefined }>,
): void {
  for (const field of fields) {
    if (field.content === undefined) continue;
    const scan = scanMemoryWriteContent(field.content);
    if (!scan.ok) {
      throw new Error(
        `记忆${field.label}未通过安全校验：${scan.reason ?? scan.threat ?? '命中安全规则'}`,
      );
    }
  }
}

function requireMemoryId(value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    throw new Error('缺少 memoryId。');
  }
  return value.trim();
}

// ---------------------------------------------------------------------------
// 动作实现
// ---------------------------------------------------------------------------

function listMemoryForTool(userId: string, input: z.infer<typeof memoryManageInputSchema>): string {
  const memories = listMemories(userId, {
    ...(input.type !== undefined ? { type: input.type } : {}),
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(input.search !== undefined ? { search: input.search } : {}),
    limit: input.limit ?? 50,
  });
  return JSON.stringify(
    {
      ok: true,
      action: 'list',
      count: memories.length,
      memories: memories.map(toMemorySummary),
    },
    null,
    2,
  );
}

/**
 * 提议提交结果的统一输出。
 *
 * 关键：不再出现 `ok: true` 直接表示「已写入」。`status` 恒为 `pending_confirmation`，
 * `outcome !== 'created'` 时明确说明提议未建立及原因，避免模型误报写入成功。
 */
function toProposalResult(input: {
  action: string;
  outcome: string;
  proposalId?: string;
  detail?: string;
  summary?: Record<string, unknown>;
}): string {
  const created = input.outcome === 'created';
  return JSON.stringify(
    {
      ok: created,
      action: input.action,
      status: created ? 'pending_confirmation' : 'not_created',
      pendingConfirmation: created,
      outcome: input.outcome,
      ...(input.proposalId ? { proposalId: input.proposalId } : {}),
      ...(input.detail ? { detail: input.detail } : {}),
      ...(input.summary ?? {}),
      message: created
        ? '已提交待用户确认的记忆提议；在用户确认前不会写入正式记忆。'
        : `未能提交记忆提议（${input.outcome}）；记忆未发生变化。`,
    },
    null,
    2,
  );
}

/** 从 draft 构造提议 payload（剔除非记忆字段，仅保留 schema 内可见字段）。 */
function buildProposalPayload(draft: MemoryManageDraft): Record<string, unknown> {
  return {
    ...(draft.type !== undefined ? { type: draft.type } : {}),
    ...(draft.key !== undefined ? { key: draft.key } : {}),
    ...(draft.value !== undefined ? { value: draft.value } : {}),
    ...(draft.priority !== undefined ? { priority: draft.priority } : {}),
    ...(draft.confidence !== undefined ? { confidence: draft.confidence } : {}),
    ...(draft.workspaceRoot !== undefined ? { workspaceRoot: draft.workspaceRoot } : {}),
    ...(draft.roleLayers !== undefined ? { roleLayers: draft.roleLayers } : {}),
    ...(draft.enabled !== undefined ? { enabled: draft.enabled } : {}),
  };
}

function addMemoryForTool(userId: string, input: z.infer<typeof memoryManageInputSchema>): string {
  const draft = input.memory;
  if (!draft?.type || !draft.key || !draft.value) {
    throw new Error('add 必须提供 memory.type / memory.key / memory.value。');
  }
  assertMemoryContentAllowed([
    { label: '键', content: draft.key },
    { label: '内容', content: draft.value },
  ]);

  // memories 表有 `(user_id, type, key) WHERE enabled = 1` 唯一索引：先给出可读的
  // 冲突提示，避免把 SQLite 约束错误直接抛给模型。停用态的新记忆不参与唯一索引，
  // 因此 `enabled: false` 时跳过预检（否则会误伤「先记下但暂不启用」的用法）。
  const wantsEnabled = draft.enabled !== false;
  if (wantsEnabled) {
    const duplicate = findEnabledMemoryByTypeAndKey(userId, draft.type, draft.key);
    if (duplicate) {
      throw new Error(
        `已存在启用中的同类记忆（${draft.type} / ${draft.key}，id=${duplicate.id}）；请用 update 修改它，或先停用旧记忆。`,
      );
    }
  }

  const result = createMemoryProposal({
    userId,
    action: 'create',
    scope: userMemoryScope(userId),
    payload: buildProposalPayload(draft),
    origin: 'tool',
    reason: 'memory_manage 工具提交的新增提议。',
    confidence: draft.confidence ?? null,
  });
  return toProposalResult({
    action: 'add',
    outcome: result.outcome,
    ...(result.proposal ? { proposalId: result.proposal.id } : {}),
    ...(result.detail ? { detail: result.detail } : {}),
    summary: { memory: buildProposalPayload(draft) },
  });
}

function updateMemoryForTool(
  userId: string,
  input: z.infer<typeof memoryManageInputSchema>,
): string {
  const memoryId = requireMemoryId(input.memoryId);
  const existing = getMemoryById(userId, memoryId);
  if (!existing) {
    throw new Error(`未找到记忆 ${memoryId}。`);
  }
  const draft: MemoryManageDraft = input.memory ?? {};
  assertMemoryContentAllowed([
    { label: '键', content: draft.key },
    { label: '内容', content: draft.value },
  ]);

  // 唯一索引预检：只要**结果态是启用**就检查（不只是改 type/key 时）。
  // 反例（曾漏判）：停用记忆 A 与启用记忆 B 同 type+key 可以共存（索引只约束
  // enabled=1），此时单独 `update A {enabled: true}` 会直接撞 SQLite 唯一索引，
  // 把不可读的约束错误抛给模型。
  const resultingEnabled = draft.enabled ?? existing.enabled;
  if (resultingEnabled) {
    const nextType = draft.type ?? existing.type;
    const nextKey = draft.key ?? existing.key;
    const duplicate = findEnabledMemoryByTypeAndKey(userId, nextType, nextKey);
    if (duplicate && duplicate.id !== memoryId) {
      throw new Error(
        `已存在启用中的同类记忆（${nextType} / ${nextKey}，id=${duplicate.id}）；请改用不同的 key，或先停用旧记忆。`,
      );
    }
  }

  // 提议载荷必须可独立表达「结果态正文」：`update` 动作要求 key + value 齐备，故把
  // 草稿与既有条目合并（草稿字段覆盖），否则只改 value 的提议会被判为载荷不完整。
  const result = createMemoryProposal({
    userId,
    action: 'update',
    scope: existing.scope,
    payload: {
      type: draft.type ?? existing.type,
      key: draft.key ?? existing.key,
      value: draft.value ?? existing.value,
      priority: draft.priority ?? existing.priority,
      confidence: draft.confidence ?? existing.confidence,
      workspaceRoot:
        draft.workspaceRoot !== undefined ? draft.workspaceRoot : existing.workspaceRoot,
      roleLayers: draft.roleLayers !== undefined ? draft.roleLayers : existing.roleLayers,
      ...(draft.enabled !== undefined ? { enabled: draft.enabled } : {}),
    },
    origin: 'tool',
    reason: 'memory_manage 工具提交的修改提议。',
    targetMemoryId: memoryId,
    expectedRevision: existing.revision,
    confidence: draft.confidence ?? null,
  });
  return toProposalResult({
    action: 'update',
    outcome: result.outcome,
    ...(result.proposal ? { proposalId: result.proposal.id } : {}),
    ...(result.detail ? { detail: result.detail } : {}),
    summary: { memoryId, memory: buildProposalPayload(draft) },
  });
}

function deleteMemoryForTool(
  userId: string,
  input: z.infer<typeof memoryManageInputSchema>,
): string {
  const memoryId = requireMemoryId(input.memoryId);
  const existing = getMemoryById(userId, memoryId);
  if (!existing) {
    throw new Error(`未找到记忆 ${memoryId}。`);
  }

  // 归档即删除的用户可见语义：创建 `archive` 提议，确认后由提交器归档条目。
  const result = createMemoryProposal({
    userId,
    action: 'archive',
    scope: existing.scope,
    payload: { type: existing.type, key: existing.key, value: existing.value },
    origin: 'tool',
    reason: 'memory_manage 工具提交的删除（归档）提议。',
    targetMemoryId: memoryId,
    expectedRevision: existing.revision,
  });
  return toProposalResult({
    action: 'delete',
    outcome: result.outcome,
    ...(result.proposal ? { proposalId: result.proposal.id } : {}),
    ...(result.detail ? { detail: result.detail } : {}),
    summary: { memoryId, key: existing.key },
  });
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

export interface RunMemoryManageInput {
  userId: string;
  sessionId: string;
  input: z.infer<typeof memoryManageInputSchema>;
}

export async function runMemoryManageTool(params: RunMemoryManageInput): Promise<string> {
  const denial = resolveMemoryManageSessionDenial(readMemoryManageSessionRow(params.sessionId));
  if (denial) {
    throw new Error(denial);
  }

  const { userId, input } = params;
  switch (input.action) {
    case 'list':
      return listMemoryForTool(userId, input);
    case 'add':
      return addMemoryForTool(userId, input);
    case 'update':
      return updateMemoryForTool(userId, input);
    case 'delete':
      return deleteMemoryForTool(userId, input);
    default: {
      const exhaustive: never = input.action;
      throw new Error(`不支持的 action: ${String(exhaustive)}`);
    }
  }
}
