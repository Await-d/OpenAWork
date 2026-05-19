/**
 * 260515-team-phase-a · T-06
 *
 * 7 层指令栈注入。
 *
 * 拼接顺序（顶→底，对应 v3.11 §6.1 决策）：
 *   1. AGENTS.md          —— 仓库 / 工作区根目录
 *   2. architecture.md    —— 仓库 / 工作区根目录（如果存在）
 *   3. constitution_md    —— team_workspaces.constitution_md（DB）
 *   4. project-memory.md  —— 仓库 .agentdocs/project-memory.md（D55：git 文件）
 *   5. lessons-learned.md —— 仓库 .agentdocs/lessons-learned.md（D55：git 文件）
 *   6. user_memory_md     —— users.user_memory_md（DB）
 *   7. SOUL               —— agent_personas.soul_md（DB，按 role_layer 选）
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

import { getTeamConstitution } from './team-constitution-store.js';
import { getForceApplyCacheTag, getForceApplyState } from './team-force-apply-store.js';
import { resolveEffectiveSoul } from './team-personas-store.js';
import { getUserMemory } from './team-user-memory-store.js';
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
  /** 拼接后的完整 7 层注入文本（已带 cache-breaker tag） */
  stableBlock: string;
  /** 估算 token 数（粗略：字符数 / 4） */
  estimatedTokens: number;
  /** 各层是否成功载入（debug / 监控用） */
  layers: {
    agentsMd: boolean;
    architectureMd: boolean;
    constitution: boolean;
    projectMemory: boolean;
    lessonsLearned: boolean;
    userMemory: boolean;
    soul: boolean;
  };
  /** 当 estimatedTokens 超过软上限时为 true */
  oversize: boolean;
}

const SOFT_TOKEN_LIMIT = 24_000;
const TOKEN_PER_CHAR = 0.25; // 简单估算：1 token ≈ 4 char

async function readFileSafe(filePath: string): Promise<string | null> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return null;
    const content = await fs.readFile(filePath, 'utf8');
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
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
 * 拼装 7 层指令栈。任意一层缺失时安静跳过，但会在 layers 标志位中记录。
 */
export async function buildTeamInstructionStack(
  input: TeamInstructionStackInput,
): Promise<TeamInstructionStackResult> {
  const layers = {
    agentsMd: false,
    architectureMd: false,
    constitution: false,
    projectMemory: false,
    lessonsLearned: false,
    userMemory: false,
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

  const stableBlock = segments.join('\n\n');
  const estimatedTokens = Math.ceil(stableBlock.length * TOKEN_PER_CHAR);
  const oversize = estimatedTokens > SOFT_TOKEN_LIMIT;

  let finalBlock = stableBlock;
  if (oversize) {
    finalBlock += `\n\n<team-instruction layer="oversize-warning">\n注意：当前 7 层指令栈估算约 ${estimatedTokens} tokens，已超过软上限 ${SOFT_TOKEN_LIMIT}。如果回答中明显遗漏某些约束，请向用户提示"上下文过大，建议精简 user_memory / project-memory"。\n</team-instruction>`;
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
    projectMemory: false,
    lessonsLearned: false,
    userMemory: false,
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

  const userMemory = getUserMemory(input.userId);
  if (userMemory && userMemory.body.trim().length > 0) {
    segments.push(wrapLayer('user-memory', userMemory.body.trim()));
    layers.userMemory = true;
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
    stableBlock: segments.join('\n\n'),
    layers,
  };
}

/**
 * 暴露 ForceApply 状态供路由 / 前端展示。
 */
export { getForceApplyState };
