/**
 * 260515-team-phase-a · T-06
 *
 * 团队运行时指令栈注入。
 *
 * 拼接顺序（顶→底，对应 v3.11 §6.1 决策）：
 *   1. AGENTS.md          —— 仓库 / 工作区根目录
 *   2. architecture.md    —— 仓库 / 工作区根目录（如果存在）
 *   3. constitution_md    —— team_workspaces.constitution_md（DB）
 * 3.5. quality-gates      —— 内联常量 QUALITY_GATES_MD（所有角色共享的质量门禁附录）
 *   4. project-memory.md  —— 仓库 .agentdocs/project-memory.md（D55：git 文件）
 *   5. lessons-learned.md —— 仓库 .agentdocs/lessons-learned.md（D55：git 文件）
 *   6. user_memory_md     —— users.user_memory_md（DB）
 *   7. workspaceKnowledge —— memories（DB，按 teamWorkspaceId + roleLayer 选）
 *   8. SOUL               —— agent_personas.soul_md（DB，按 role_layer 选）
 *
 * **去重说明**：层 1（AGENTS.md）已经由 `routes/stream.ts::buildWorkspaceContext`
 * 注入到 stable 段的 workspace ctx 中（含递归 directory_agents block + 若干别名
 * CRUSH/CLAUDE/GEMINI），所以本模块**不再重复注入** AGENTS.md，仅作为概念性
 * "栈第 1 层"在文档中保留。这样可以避免 token 翻倍 + prompt cache prefix 抖动。
 *
 * 这一段被嵌进 system prompt 的 stable prefix，每个 session 内部稳定
 * （Anthropic prompt cache 友好）。当用户改了任意一层后，建议触发
 * ForceApply（team-force-apply-store.ts）让 cache breaker tag 推进，
 * 强制下一轮重新拼装。
 *
 * D48 token 上限：Phase A 不实现压缩，但当总 token 估算 > 24K 时附加警告
 * 段，让模型自己声明已知上下文受限。
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import type { MemoryEntry } from '@openAwork/agent-core';
import { redactText } from '@openAwork/agent-core';
import { getTeamConstitution } from './team-constitution-store.js';
import { getForceApplyCacheTag, getForceApplyState } from './team-force-apply-store.js';
import { resolveEffectiveSoul } from './team-personas-store.js';
import { getUserMemory } from './team-user-memory-store.js';
import { listMemoriesForTeamWorkspaceKnowledge } from '../memory/memory-store.js';
import { sqliteGet } from '../infra/db.js';
import { QUALITY_GATES_MD, getCompletionProtocolMd } from '../team-phase-a-content/index.js';
import type { SoulRoleLayer } from '../team-phase-a-content/index.js';

export interface TeamInstructionStackInput {
  userId: string;
  /** 当前会话的工作区根（用于读 AGENTS.md / architecture.md / project-memory / lessons-learned） */
  workspaceRoot: string | null;
  /** 当前会话所属的 team_workspaces.id（无团队上下文时传 null） */
  teamWorkspaceId: string | null;
  /** 该 agent 的角色层级；不在 5 层之内时不注入 SOUL */
  roleLayer: SoulRoleLayer | null;
  /** persona key，默认 'default' */
  personaKey?: string;
}

export interface TeamInstructionStackResult {
  /** 拼接后的完整团队指令栈文本（已带 cache-breaker tag） */
  stableBlock: string;
  /** 估算 token 数（粗略：字符数 / 4） */
  estimatedTokens: number;
  /** 各层是否成功载入（debug / 监控用） */
  layers: {
    agentsMd: boolean;
    architectureMd: boolean;
    constitution: boolean;
    qualityGates: boolean;
    projectMemory: boolean;
    lessonsLearned: boolean;
    userMemory: boolean;
    workspaceKnowledge: boolean;
    soul: boolean;
  };
  /** 当 estimatedTokens 超过软上限时为 true */
  oversize: boolean;
}

const SOFT_TOKEN_LIMIT = 24_000;
const TOKEN_PER_CHAR = 0.25; // 简单估算：1 token ≈ 4 char
const WORKSPACE_KNOWLEDGE_LIMIT = 40;

interface TeamWorkspaceRootRow {
  default_working_root: string | null;
}

// Byte ceiling for the workspace files injected into every team prompt
// (architecture.md / .agentdocs/project-memory.md / .agentdocs/lessons-learned.md).
// `workspaceRoot` is user-controlled, so a pathological multi-MB file would
// balloon both gateway memory and every upstream request — the same hot-path
// hazard §0.127 closed for stream.ts::buildWorkspaceContext. We `stat` first and
// skip the file BEFORE buffering it. Shares the OPENAWORK_CONTEXT_FILE_MAX_BYTES
// knob with that reader so operators tune one value; <=0 disables the guard.
const DEFAULT_TEAM_INSTRUCTION_FILE_MAX_BYTES = 1024 * 1024;
function resolveTeamInstructionFileMaxBytes(): number {
  const raw = globalThis.process?.env?.['OPENAWORK_CONTEXT_FILE_MAX_BYTES'];
  if (raw === undefined || raw === null || raw.trim() === '') {
    return DEFAULT_TEAM_INSTRUCTION_FILE_MAX_BYTES;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
}

async function readFileSafe(filePath: string): Promise<string | null> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return null;
    const maxBytes = resolveTeamInstructionFileMaxBytes();
    if (maxBytes > 0 && stat.size > maxBytes) {
      // Skip oversize files before reading them into memory; the rest of the
      // instruction stack is still assembled (graceful degradation).
      console.warn(
        `[team-instruction-stack] 跳过超限的指令栈文件（${stat.size} 字节 > ${maxBytes}）：${filePath}`,
      );
      return null;
    }
    const content = await fs.readFile(filePath, 'utf8');
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch (error) {
    if (!isFileNotFoundError(error)) {
      console.warn(
        `[team-instruction-stack] 读取指令栈文件失败：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return null;
  }
}

function isFileNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  return (error as { code?: unknown }).code === 'ENOENT';
}

async function readWorkspaceFile(
  workspaceRoot: string | null,
  relativePath: string,
): Promise<string | null> {
  if (!workspaceRoot) return null;
  const full = path.join(workspaceRoot, relativePath);
  return readFileSafe(full);
}

function wrapLayer(label: string, body: string): string {
  return `<team-instruction layer="${label}">\n${body}\n</team-instruction>`;
}

/**
 * 拼装团队指令栈。任意一层缺失时安静跳过，但会在 layers 标志位中记录。
 */
export async function buildTeamInstructionStack(
  input: TeamInstructionStackInput,
): Promise<TeamInstructionStackResult> {
  const layers = {
    agentsMd: false,
    architectureMd: false,
    constitution: false,
    qualityGates: false,
    projectMemory: false,
    lessonsLearned: false,
    userMemory: false,
    workspaceKnowledge: false,
    soul: false,
  };

  const segments: string[] = [];

  // 1. AGENTS.md — 已由 stream.ts::buildWorkspaceContext 注入，避免双重注入
  //    所以此处只做"是否存在"的探测，标记 layers.agentsMd 用于监控/调试。
  const agentsMdPresent = await readWorkspaceFile(input.workspaceRoot, 'AGENTS.md');
  if (agentsMdPresent) {
    layers.agentsMd = true;
  }

  // 2. architecture.md
  const architectureMd = await readWorkspaceFile(input.workspaceRoot, 'architecture.md');
  if (architectureMd) {
    segments.push(wrapLayer('architecture-md', architectureMd));
    layers.architectureMd = true;
  }

  // 3. constitution_md（DB）
  if (input.teamWorkspaceId) {
    const constitution = getTeamConstitution({
      userId: input.userId,
      teamWorkspaceId: input.teamWorkspaceId,
    });
    if (constitution && constitution.body.trim().length > 0) {
      segments.push(wrapLayer('constitution', constitution.body.trim()));
      layers.constitution = true;
    }
  }

  // 3.5. quality-gates（内联常量，所有角色共享的质量门禁附录）
  // 3.6. completion-protocol（executor / reviewer 专用的完成协议，永不被上下文压缩）
  if (input.roleLayer) {
    segments.push(wrapLayer('quality-gates', QUALITY_GATES_MD));
    layers.qualityGates = true;
    const protocolMd = getCompletionProtocolMd(input.roleLayer);
    if (protocolMd) {
      segments.push(wrapLayer('completion-protocol', protocolMd));
    }
  }

  // 4. project-memory.md（D55：git 文件）
  const projectMemory = await readWorkspaceFile(
    input.workspaceRoot,
    '.agentdocs/project-memory.md',
  );
  if (projectMemory) {
    segments.push(wrapLayer('project-memory', projectMemory));
    layers.projectMemory = true;
  }

  // 5. lessons-learned.md（D55：git 文件）
  const lessonsLearned = await readWorkspaceFile(
    input.workspaceRoot,
    '.agentdocs/lessons-learned.md',
  );
  if (lessonsLearned) {
    segments.push(wrapLayer('lessons-learned', lessonsLearned));
    layers.lessonsLearned = true;
  }

  // 6. user_memory_md（DB）
  const userMemory = getUserMemory(input.userId);
  if (userMemory && userMemory.body.trim().length > 0) {
    segments.push(wrapLayer('user-memory', userMemory.body.trim()));
    layers.userMemory = true;
  }

  if (input.teamWorkspaceId && input.roleLayer) {
    const workspaceKnowledge = buildWorkspaceKnowledgeLayer({
      roleLayer: input.roleLayer,
      teamWorkspaceId: input.teamWorkspaceId,
      userId: input.userId,
      workspaceRoot: input.workspaceRoot,
    });
    if (workspaceKnowledge) {
      segments.push(wrapLayer(`workspace-knowledge:${input.roleLayer}`, workspaceKnowledge));
      layers.workspaceKnowledge = true;
    }
  }

  // 7. SOUL（DB，按 role_layer 选）
  if (input.roleLayer) {
    const effective = resolveEffectiveSoul({
      userId: input.userId,
      roleLayer: input.roleLayer,
      key: input.personaKey,
    });
    if (effective.soulMd.trim().length > 0) {
      segments.push(
        wrapLayer(
          `soul:${input.roleLayer}${effective.isDefault ? ':default' : ''}`,
          effective.soulMd.trim(),
        ),
      );
      layers.soul = true;
    }
  }

  // Cache breaker：用户 ForceApply 后这段会变化，触发 prompt cache miss
  const forceApplyTag = getForceApplyCacheTag(input.userId);
  segments.push(`<team-instruction layer="cache-breaker" tag="${forceApplyTag}" />`);

  const stableBlock = redactText(segments.join('\n\n'));
  const estimatedTokens = Math.ceil(stableBlock.length * TOKEN_PER_CHAR);
  const oversize = estimatedTokens > SOFT_TOKEN_LIMIT;

  let finalBlock = stableBlock;
  if (oversize) {
    finalBlock += `\n\n<team-instruction layer="oversize-warning">\n注意：当前团队指令栈估算约 ${estimatedTokens} tokens，已超过软上限 ${SOFT_TOKEN_LIMIT}。如果回答中明显遗漏某些约束，请向用户提示"上下文过大，建议精简 user_memory / project-memory / workspace knowledge"。\n</team-instruction>`;
  }

  return {
    stableBlock: finalBlock,
    estimatedTokens,
    layers,
    oversize,
  };
}

/**
 * 同步版本：只取 DB 内容（跳过 git 文件读取），用于不需要 fs IO 的场景
 * （比如测试断言或 ForceApply 状态查询）。
 */
export function buildTeamInstructionStackSync(
  input: Omit<TeamInstructionStackInput, 'workspaceRoot'>,
): Pick<TeamInstructionStackResult, 'stableBlock' | 'layers'> {
  const layers = {
    agentsMd: false,
    architectureMd: false,
    constitution: false,
    qualityGates: false,
    projectMemory: false,
    lessonsLearned: false,
    userMemory: false,
    workspaceKnowledge: false,
    soul: false,
  };
  const segments: string[] = [];

  if (input.teamWorkspaceId) {
    const constitution = getTeamConstitution({
      userId: input.userId,
      teamWorkspaceId: input.teamWorkspaceId,
    });
    if (constitution && constitution.body.trim().length > 0) {
      segments.push(wrapLayer('constitution', constitution.body.trim()));
      layers.constitution = true;
    }
  }

  // 3.5. quality-gates（内联常量，所有角色共享的质量门禁附录）
  // 3.6. completion-protocol（executor / reviewer 专用的完成协议）
  if (input.roleLayer) {
    segments.push(wrapLayer('quality-gates', QUALITY_GATES_MD));
    layers.qualityGates = true;
    const protocolMd = getCompletionProtocolMd(input.roleLayer);
    if (protocolMd) {
      segments.push(wrapLayer('completion-protocol', protocolMd));
    }
  }

  const userMemory = getUserMemory(input.userId);
  if (userMemory && userMemory.body.trim().length > 0) {
    segments.push(wrapLayer('user-memory', userMemory.body.trim()));
    layers.userMemory = true;
  }

  if (input.teamWorkspaceId && input.roleLayer) {
    const workspaceKnowledge = buildWorkspaceKnowledgeLayer({
      roleLayer: input.roleLayer,
      teamWorkspaceId: input.teamWorkspaceId,
      userId: input.userId,
      workspaceRoot: null,
    });
    if (workspaceKnowledge) {
      segments.push(wrapLayer(`workspace-knowledge:${input.roleLayer}`, workspaceKnowledge));
      layers.workspaceKnowledge = true;
    }
  }

  if (input.roleLayer) {
    const effective = resolveEffectiveSoul({
      userId: input.userId,
      roleLayer: input.roleLayer,
      key: input.personaKey,
    });
    if (effective.soulMd.trim().length > 0) {
      segments.push(
        wrapLayer(
          `soul:${input.roleLayer}${effective.isDefault ? ':default' : ''}`,
          effective.soulMd.trim(),
        ),
      );
      layers.soul = true;
    }
  }

  const forceApplyTag = getForceApplyCacheTag(input.userId);
  segments.push(`<team-instruction layer="cache-breaker" tag="${forceApplyTag}" />`);

  return {
    stableBlock: redactText(segments.join('\n\n')),
    layers,
  };
}

/**
 * 暴露 ForceApply 状态供路由 / 前端展示。
 */
export { getForceApplyState };

function buildWorkspaceKnowledgeLayer(input: {
  roleLayer: SoulRoleLayer;
  teamWorkspaceId: string;
  userId: string;
  workspaceRoot: string | null;
}): string | null {
  const records = listWorkspaceKnowledgeRecords(input);
  if (records.length === 0) {
    return null;
  }

  const lines = records.map((memory) => {
    const layerScope =
      memory.roleLayers === null ? '全部层级' : `仅 ${memory.roleLayers.join(', ')}`;
    return `- [${memory.type} / ${layerScope}] ${memory.key}: ${truncateKnowledgeValue(memory.value)}`;
  });
  return [
    `以下是当前团队工作区知识库中允许 ${input.roleLayer} 层读取和使用的长期知识。`,
    '这些内容来自工作区知识入库，不是当前会话消息关联。',
    '',
    ...lines,
  ].join('\n');
}

function truncateKnowledgeValue(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length > 1000 ? `${normalized.slice(0, 1000)}...` : normalized;
}

function listWorkspaceKnowledgeRecords(input: {
  roleLayer: SoulRoleLayer;
  teamWorkspaceId: string;
  userId: string;
  workspaceRoot: string | null;
}): MemoryEntry[] {
  const workspaceRoots = collectWorkspaceKnowledgeRoots(input);
  const queryRoots = workspaceRoots.length > 0 ? workspaceRoots : [null];
  const recordsById = new Map<string, MemoryEntry>();

  for (const workspaceRoot of queryRoots) {
    const records = listMemoriesForTeamWorkspaceKnowledge(input.userId, {
      enabled: true,
      limit: WORKSPACE_KNOWLEDGE_LIMIT,
      roleLayer: input.roleLayer,
      teamWorkspaceId: input.teamWorkspaceId,
      workspaceRoot,
    });
    for (const record of records) {
      recordsById.set(record.id, record);
    }
  }

  return [...recordsById.values()]
    .sort(compareWorkspaceKnowledgeRecords)
    .slice(0, WORKSPACE_KNOWLEDGE_LIMIT);
}

function collectWorkspaceKnowledgeRoots(input: {
  teamWorkspaceId: string;
  userId: string;
  workspaceRoot: string | null;
}): string[] {
  const roots: string[] = [];
  addUniqueRoot(roots, input.workspaceRoot);
  addUniqueRoot(
    roots,
    resolveTeamWorkspaceDefaultRoot({
      teamWorkspaceId: input.teamWorkspaceId,
      userId: input.userId,
    }),
  );
  return roots;
}

function resolveTeamWorkspaceDefaultRoot(input: {
  teamWorkspaceId: string;
  userId: string;
}): string | null {
  const row = sqliteGet<TeamWorkspaceRootRow>(
    `SELECT default_working_root
       FROM team_workspaces
      WHERE id = ? AND user_id = ?
      LIMIT 1`,
    [input.teamWorkspaceId, input.userId],
  );
  return normalizeWorkspaceRoot(row?.default_working_root);
}

function addUniqueRoot(roots: string[], value: string | null): void {
  const normalized = normalizeWorkspaceRoot(value);
  if (normalized && !roots.includes(normalized)) {
    roots.push(normalized);
  }
}

function normalizeWorkspaceRoot(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function compareWorkspaceKnowledgeRecords(left: MemoryEntry, right: MemoryEntry): number {
  const priorityDiff = right.priority - left.priority;
  if (priorityDiff !== 0) {
    return priorityDiff;
  }
  const confidenceDiff = right.confidence - left.confidence;
  if (confidenceDiff !== 0) {
    return confidenceDiff;
  }
  if (left.key < right.key) {
    return -1;
  }
  if (left.key > right.key) {
    return 1;
  }
  if (left.id < right.id) {
    return -1;
  }
  if (left.id > right.id) {
    return 1;
  }
  return 0;
}
