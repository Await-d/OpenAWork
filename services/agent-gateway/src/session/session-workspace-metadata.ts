import path from 'node:path';
import { z } from 'zod';
import { parseGrillState } from '@openAwork/agent-core';
import { TEAM_RUNTIME_LAYER_ORDER, DEFAULT_FIXED_TEAM_MEMBER_SLOTS } from '@openAwork/shared';
import { validateWorkspacePath } from '../workspace/workspace-paths.js';
import { upstreamRetryMaxRetriesSchema } from '../provider/upstream-retry-policy.js';

const specialtyValues = Array.from(
  new Set([...DEFAULT_FIXED_TEAM_MEMBER_SLOTS.map((slot) => slot.specialty), 'custom']),
) as [string, ...string[]];

const teamMemberSlotSchema = z.object({
  agentId: z.string().min(1).max(200).optional(),
  agentLabel: z.string().min(1).max(200).optional(),
  displayName: z.string().min(1).max(200),
  id: z.string().min(1).max(120),
  layer: z.enum(TEAM_RUNTIME_LAYER_ORDER),
  personaKey: z.string().min(1).max(160),
  required: z.boolean(),
  specialty: z.enum(specialtyValues),
  toolsets: z.array(z.string().min(1).max(80)).max(20),
  toolsetsCustomized: z.boolean().optional(),
  // 可选的 per-member 模型绑定（智能分配模型功能写入；老数据无此字段）。
  providerId: z.string().min(1).max(200).optional(),
  modelId: z.string().min(1).max(200).optional(),
  variant: z.string().min(1).max(80).optional(),
  thinkingEnabled: z.boolean().optional(),
  reasoningEffort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).optional(),
  // 自定义角色字段（specialty === 'custom'）。
  custom: z.boolean().optional(),
  systemPrompt: z.string().max(8000).optional(),
  // 模板初始能力绑定（skills / mcp）。
  skillIds: z.array(z.string().min(1).max(160)).max(50).optional(),
  mcpServerIds: z.array(z.string().min(1).max(160)).max(50).optional(),
  // 路由关键词（让上游派发动态识别该成员擅长什么；自定义角色尤其需要）。
  routingKeywords: z.array(z.string().min(1).max(160)).max(50).optional(),
  // 派发优先级（同分排序权重）。
  dispatchPriority: z.enum(['high', 'normal', 'low']).optional(),
});

const teamDefinitionSchema = z.object({
  createdAt: z.string().optional(),
  defaultProvider: z.string().nullable().optional(),
  memberSlots: z.array(teamMemberSlotSchema).max(40).optional(),
  optionalMembers: z
    .array(
      z.object({
        agentId: z.string().min(1).max(200),
        agentLabel: z.string().min(1).max(200),
        canonicalRole: z.string().min(1).max(120).nullable().optional(),
      }),
    )
    .optional(),
  requiredRoleBindings: z.array(
    z.object({
      agentId: z.string().min(1).max(200),
      agentLabel: z.string().min(1).max(200),
      modelId: z.string().min(1).max(200).optional(),
      providerId: z.string().min(1).max(200).optional(),
      role: z.enum(['leader', 'planner', 'researcher', 'executor', 'reviewer']),
      variant: z.string().min(1).max(80).optional(),
    }),
  ),
  source: z.object({
    kind: z.enum(['blank', 'builtin-template', 'saved-template']),
    templateId: z.string().min(1).max(200).optional(),
    templateName: z.string().min(1).max(200).optional(),
  }),
  /**
   * 起始快捷建议（D 项）：模板内置，向 reception session metadata 透传，
   * 前端 ReceptionStarterCard 渲染为 chip。
   */
  starterSuggestions: z.array(z.string().min(1).max(200)).max(8).optional(),
  version: z.number().int().min(1).optional(),
});

// ─── teamInit：团队会话「初始化阶段」标记（与 @openAwork/shared 的 TeamInitState 同构）──
const teamInitStepSchema = z.object({
  key: z.enum([
    'scan-shared-record',
    'read-project-level1',
    'extract-project-memory',
    'understand-architecture',
    'bind-tools-per-layer',
    'scaffold-memory',
  ]),
  title: z.string().min(1).max(200),
  description: z.string().max(500),
  status: z.enum([
    'proposed',
    'confirmed',
    'running',
    'done',
    'skipped',
    'failed',
    'not_applicable',
  ]),
  requiresConfirm: z.boolean(),
  usesLlm: z.boolean(),
  result: z.record(z.unknown()).nullable().optional(),
  error: z.string().max(2000).nullable().optional(),
  confirmedAt: z.string().max(40).nullable().optional(),
  completedAt: z.string().max(40).nullable().optional(),
});

const teamInitLayerBindingSchema = z.object({
  skillIds: z.array(z.string().min(1).max(160)).max(50),
  mcpServerIds: z.array(z.string().min(1).max(160)).max(50),
  rationale: z.string().max(1000).nullable().optional(),
  boundAt: z.string().max(40).nullable().optional(),
});

const teamInitStateSchema = z.object({
  version: z.number().int().min(1),
  phase: z.enum(['proposed', 'in_progress', 'completed', 'skipped']),
  projectKind: z.enum(['empty', 'existing', 'unknown']),
  detectedAt: z.string().max(40).nullable().optional(),
  steps: z.array(teamInitStepSchema).max(20),
  bindings: z.object({
    perLayer: z.record(z.string(), teamInitLayerBindingSchema).optional(),
    architectureSummary: z.string().max(20000).nullable().optional(),
    projectMemoryDigest: z.string().max(20000).nullable().optional(),
  }),
});

const teamRoleInstanceSchema = z.object({
  rootSessionId: z.string().min(1).max(200),
  roleLayer: z.enum(['user', ...TEAM_RUNTIME_LAYER_ORDER]),
  personaKey: z.string().min(1).max(160).nullable().optional(),
  displayName: z.string().min(1).max(200).nullable().optional(),
});

/** 会话级权限档位（权限阶梯）：`ask` 默认 / `auto-edit` 文件编辑自动放行 / `yolo` 全部免询问。 */
const sessionPermissionModeSchema = z.enum(['ask', 'auto-edit', 'yolo']);

const sessionMetadataPatchSchema = z
  .object({
    agentId: z.string().min(1).max(120).optional(),
    clarificationState: z
      .string()
      .max(200000)
      .refine((value) => parseGrillState(value) !== null, {
        message: 'clarificationState 必须是合法的 GrillState 序列化 JSON',
      })
      .optional(),
    dialogueMode: z.enum(['clarify', 'coding', 'programmer']).optional(),
    editSourceMessageId: z.string().min(1).max(200).optional(),
    imageWorkbench: z.boolean().optional(),
    modelId: z.string().min(1).max(200).optional(),
    modelLabel: z.string().min(1).max(200).optional(),
    modelSelectionSource: z.enum(['metadata', 'defaults', 'manual']).optional(),
    parentSessionId: z.string().min(1).max(200).optional(),
    planMode: z.boolean().optional(),
    providerId: z.string().min(1).max(200).optional(),
    reasoningEffort: z
      .enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
      .optional(),
    /**
     * SSH 远程工作区：绑定的 SSH 连接 id。存在该字段时，`workingDirectory`
     * 被解释为「远端主机上的绝对路径」，本地 workspace roots 校验不适用
     * （参见 normalizePersistedSessionMetadata 的 SSH 分支）。
     * 显式传 `null` 表示清除绑定（PATCH 时同时解除会话↔连接绑定）。
     */
    sshConnectionId: z.string().min(1).max(200).nullable().optional(),
    teamDefinition: teamDefinitionSchema.optional(),
    teamInit: teamInitStateSchema.optional(),
    teamRoleInstance: teamRoleInstanceSchema.optional(),
    teamWorkspaceId: z.string().min(1).max(200).optional(),
    thinkingEnabled: z.boolean().optional(),
    upstreamRetryMaxRetries: upstreamRetryMaxRetriesSchema.optional(),
    variant: z.string().min(1).max(80).optional(),
    webSearchEnabled: z.boolean().optional(),
    workingDirectory: z.string().optional(),
    // 权限阶梯的规范键；保留布尔 yoloMode 作为旧写入方的兼容入口（二者在写路径互为投影）。
    permissionMode: sessionPermissionModeSchema.optional(),
    yoloMode: z.boolean().optional(),
  })
  .strict();

export function validateSessionMetadataPatch(metadata: Record<string, unknown>) {
  return sessionMetadataPatchSchema.safeParse(metadata);
}

/**
 * 会话绑定的 SSH 连接 id。存在即表示该会话运行在 SSH 远程工作区模式下：
 * `workingDirectory` 语义为「远端绝对路径」，本地 workspace roots 校验不适用。
 */
export function extractSessionSshConnectionId(metadata: Record<string, unknown>): string | null {
  const value = metadata['sshConnectionId'];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * 远端（POSIX）工作目录规范化：仅接受绝对路径；返回 posix 归一化结果
 * （去掉尾斜杠、折叠 `.`/`..`）。非法输入返回 null，由调用方按「清空
 * workingDirectory」处理。
 */
export function normalizeSshRemoteWorkingDirectory(value: string): string | null {
  const trimmed = value.trim();
  if (/[\r\n\0]/.test(trimmed)) return null;
  if (/^(?:[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/.test(trimmed)) {
    return path.win32.normalize(trimmed);
  }
  if (!trimmed.startsWith('/')) {
    return null;
  }
  const normalized = path.posix.normalize(trimmed);
  if (!normalized.startsWith('/')) {
    return null;
  }
  if (normalized.length > 1 && normalized.endsWith('/')) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

/**
 * 持久化 metadata 的读路径归一化：只收敛 workingDirectory，刻意不做权限档位归一化。
 *
 * 历史会话可能只带布尔 `yoloMode`（也可能两个键都缺席），读取时保持原样、不回写、
 * 不补写 `permissionMode`；需要档位时统一交给 `resolveSessionPermissionMode`
 * （@openAwork/agent-core）的兜底解析，避免读路径篡改持久化数据。
 */
export function normalizePersistedSessionMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const workingDirectory = metadata['workingDirectory'];
  if (typeof workingDirectory !== 'string') {
    return metadata;
  }

  // SSH 远程工作区：workingDirectory 是远端绝对路径，跳过本地 roots 校验，
  // 仅做 POSIX 归一化。
  if (extractSessionSshConnectionId(metadata)) {
    const normalizedRemote = normalizeSshRemoteWorkingDirectory(workingDirectory);
    if (normalizedRemote === null) {
      const nextMetadataWithoutRemote = { ...metadata };
      delete nextMetadataWithoutRemote['workingDirectory'];
      return nextMetadataWithoutRemote;
    }
    if (normalizedRemote === workingDirectory) {
      return metadata;
    }
    return { ...metadata, workingDirectory: normalizedRemote };
  }

  const safeWorkingDirectory = validateWorkspacePath(workingDirectory);
  if (safeWorkingDirectory === workingDirectory) {
    return metadata;
  }

  const nextMetadata = { ...metadata };
  if (!safeWorkingDirectory) {
    delete nextMetadata['workingDirectory'];
    return nextMetadata;
  }

  nextMetadata['workingDirectory'] = safeWorkingDirectory;
  return nextMetadata;
}

export function sanitizeSessionMetadataJson(metadataJson: string): string {
  try {
    const metadata = JSON.parse(metadataJson) as Record<string, unknown>;
    const normalizedMetadata = normalizePersistedSessionMetadata(metadata);
    return normalizedMetadata === metadata ? metadataJson : JSON.stringify(normalizedMetadata);
  } catch {
    return metadataJson;
  }
}

export function parseSessionMetadataJson(metadataJson: string): Record<string, unknown> {
  try {
    const metadata = JSON.parse(metadataJson) as Record<string, unknown>;
    return normalizePersistedSessionMetadata(metadata);
  } catch {
    return {};
  }
}

export function normalizeIncomingSessionMetadata(metadata: Record<string, unknown>): {
  metadata: Record<string, unknown>;
  workingDirectory?: string | null;
} {
  const workingDirectory = metadata['workingDirectory'];
  if (typeof workingDirectory !== 'string') {
    return { metadata };
  }

  // SSH 远程工作区：接受远端绝对路径（POSIX），不要求落在本地 workspace roots。
  if (extractSessionSshConnectionId(metadata)) {
    const normalizedRemote = normalizeSshRemoteWorkingDirectory(workingDirectory);
    if (normalizedRemote === null) {
      return { metadata, workingDirectory: null };
    }
    if (normalizedRemote === workingDirectory) {
      return { metadata, workingDirectory: normalizedRemote };
    }
    return {
      metadata: { ...metadata, workingDirectory: normalizedRemote },
      workingDirectory: normalizedRemote,
    };
  }

  const safeWorkingDirectory = validateWorkspacePath(workingDirectory);
  if (!safeWorkingDirectory) {
    return { metadata, workingDirectory: null };
  }

  if (safeWorkingDirectory === workingDirectory) {
    return { metadata, workingDirectory: safeWorkingDirectory };
  }

  return {
    metadata: { ...metadata, workingDirectory: safeWorkingDirectory },
    workingDirectory: safeWorkingDirectory,
  };
}

/**
 * 权限档位写路径规范化：`permissionMode` 是规范键，布尔 `yoloMode` 是它的派生投影。
 *
 * `patchMetadata`（本次 PATCH 的原始字段）代表用户本次的显式意图，必须先于合并结果判定，
 * 否则旧客户端的布尔写入永远无法把已持久化的 `yolo` 关掉。优先级：
 * 1. patch 携带合法 `permissionMode` → 以 patch 为准，回写 `yoloMode = permissionMode === 'yolo'`；
 * 2. 否则 patch 携带布尔 `yoloMode` → 以 patch 为准，补齐 `permissionMode = yoloMode ? 'yolo' : 'ask'`
 *    （true 可升级为 `yolo`，false 必须能降级为 `ask`）；
 * 3. 否则合并结果含合法 `permissionMode` → 以它为准回写 `yoloMode`（`yolo` → true，其余 → false）；
 * 4. 否则合并结果含布尔 `yoloMode` → 按它补齐 `permissionMode`（true → `yolo`，false → `ask`）；
 * 5. 两者都缺席时保持缺席——不凭空写入 `ask`，避免给从未表达过权限档位的会话留下印记。
 */
function canonicalizeSessionPermissionMode(
  metadata: Record<string, unknown>,
  patchMetadata: Record<string, unknown>,
): Record<string, unknown> {
  const patchPermissionMode = sessionPermissionModeSchema.safeParse(
    patchMetadata['permissionMode'],
  );
  if (patchPermissionMode.success) {
    return { ...metadata, yoloMode: patchPermissionMode.data === 'yolo' };
  }

  const patchYoloMode = patchMetadata['yoloMode'];
  if (typeof patchYoloMode === 'boolean') {
    return { ...metadata, permissionMode: patchYoloMode ? 'yolo' : 'ask' };
  }

  const mergedPermissionMode = sessionPermissionModeSchema.safeParse(metadata['permissionMode']);
  if (mergedPermissionMode.success) {
    return { ...metadata, yoloMode: mergedPermissionMode.data === 'yolo' };
  }

  const mergedYoloMode = metadata['yoloMode'];
  if (typeof mergedYoloMode === 'boolean') {
    return { ...metadata, permissionMode: mergedYoloMode ? 'yolo' : 'ask' };
  }

  return metadata;
}

export function mergeSessionMetadataForUpdate(
  currentMetadata: Record<string, unknown>,
  patchMetadata: Record<string, unknown>,
): { metadata: Record<string, unknown>; workingDirectory?: string | null } {
  const sanitizedCurrentMetadata = normalizePersistedSessionMetadata(currentMetadata);
  const mergedMetadata = { ...sanitizedCurrentMetadata, ...patchMetadata };
  return normalizeIncomingSessionMetadata(
    canonicalizeSessionPermissionMode(mergedMetadata, patchMetadata),
  );
}

export function extractSessionWorkingDirectory(metadata: Record<string, unknown>): string | null {
  const sanitizedMetadata = normalizePersistedSessionMetadata(metadata);
  const workingDirectory = sanitizedMetadata['workingDirectory'];
  return typeof workingDirectory === 'string' ? workingDirectory : null;
}

export function isSessionWorkspaceRebindingAttempt(
  currentMetadata: Record<string, unknown>,
  nextWorkingDirectory: string | null | undefined,
): boolean {
  const currentWorkingDirectory = extractSessionWorkingDirectory(currentMetadata);
  if (!currentWorkingDirectory || nextWorkingDirectory === undefined) {
    return false;
  }

  return currentWorkingDirectory !== nextWorkingDirectory;
}
