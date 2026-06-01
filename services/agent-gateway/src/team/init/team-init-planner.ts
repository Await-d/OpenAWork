/**
 * team-init-planner · 团队会话「初始化阶段」计划器
 *
 * 在 `POST /team/workspaces/:id/sessions` 创建成功后被同步调用，依据
 *   - 工作区共享记录（该 workspace 下已有 session 数量）
 *   - 工作目录文件系统（是否为空项目 / 是否存在 git 文件层 / 关键标识文件）
 * 启发式地（零 LLM、零副作用）算出一份「初始化待办清单」（TeamInitState），
 * 写入新会话的 metadata。清单本身不执行任何带副作用的动作——除了 scan-shared-record
 * 这一步纯读、零副作用，planner 会就地把它标记为 done 并填入判定结果。
 *
 * 真正的执行（解读结构 / 提炼记忆 / 理解架构 / 绑定工具 / 生成骨架）由 team-init-runner
 * 在用户逐项确认后进行，分析类步骤优先调用辅助 LLM（无配置时回落启发式）。
 */

import { promises as fs } from 'node:fs';
import {
  TEAM_INIT_STATE_VERSION,
  type TeamInitState,
  type TeamInitStep,
  type TeamInitProjectKind,
} from '@openAwork/shared';
import { sqliteGet } from '../../infra/db.js';
import { validateWorkspacePath } from '../../workspace/workspace-paths.js';

/** 视为「项目已存在」的标识文件 / 目录。 */
const PROJECT_SIGNAL_ENTRIES = [
  '.git',
  '.agentdocs',
  'AGENTS.md',
  'architecture.md',
  'package.json',
  'pyproject.toml',
  'go.mod',
  'Cargo.toml',
  'pom.xml',
  'build.gradle',
  'composer.json',
  'Gemfile',
  'src',
];

/** 扫描目录时忽略的「噪声」条目——它们的存在不代表项目非空。 */
const EMPTINESS_IGNORED_ENTRIES = new Set(['.DS_Store', '.gitkeep', 'Thumbs.db', '.shadow-git']);

export interface ProjectEmptinessProbe {
  projectKind: TeamInitProjectKind;
  /** 是否存在 git 文件层 / 关键标识文件。 */
  hasProjectSignals: boolean;
  /** 工作目录下的顶层条目数（已剔除噪声）。 */
  topLevelEntryCount: number;
  /** 命中的标识文件名（便于 UI 展示「检测到 package.json…」）。 */
  matchedSignals: string[];
  /** 该 workspace 下已有的 session 数量（共享项目记录维度）。 */
  workspaceSessionCount: number;
  /** working root 是否可用（不存在 / 非法路径时为 false）。 */
  workingRootAvailable: boolean;
}

/**
 * 探测工作目录是否为空项目。纯读操作，不抛错（失败回落到 unknown）。
 */
export async function probeProjectEmptiness(input: {
  workingRoot: string | null;
  teamWorkspaceId: string;
  userId: string;
}): Promise<ProjectEmptinessProbe> {
  const workspaceSessionCount = countWorkspaceSessions(input.teamWorkspaceId, input.userId);

  const safeRoot = input.workingRoot ? validateWorkspacePath(input.workingRoot) : null;
  if (!safeRoot) {
    return {
      projectKind: 'unknown',
      hasProjectSignals: false,
      topLevelEntryCount: 0,
      matchedSignals: [],
      workspaceSessionCount,
      workingRootAvailable: false,
    };
  }

  let entries: string[] = [];
  try {
    entries = await fs.readdir(safeRoot);
  } catch {
    // 目录不存在 / 无权限 → 视为空项目（新目录）。
    return {
      projectKind: 'empty',
      hasProjectSignals: false,
      topLevelEntryCount: 0,
      matchedSignals: [],
      workspaceSessionCount,
      workingRootAvailable: false,
    };
  }

  const meaningfulEntries = entries.filter((name) => !EMPTINESS_IGNORED_ENTRIES.has(name));
  const matchedSignals = PROJECT_SIGNAL_ENTRIES.filter((signal) => entries.includes(signal));
  const hasProjectSignals = matchedSignals.length > 0;

  // 判定：有标识文件 → existing；否则若顶层有>2个实际条目 → existing；都不满足 → empty。
  const projectKind: TeamInitProjectKind =
    hasProjectSignals || meaningfulEntries.length > 2 ? 'existing' : 'empty';

  return {
    projectKind,
    hasProjectSignals,
    topLevelEntryCount: meaningfulEntries.length,
    matchedSignals,
    workspaceSessionCount,
    workingRootAvailable: true,
  };
}

function countWorkspaceSessions(teamWorkspaceId: string, userId: string): number {
  try {
    const row = sqliteGet<{ count: number }>(
      `SELECT COUNT(*) AS count
         FROM sessions
        WHERE user_id = ?
          AND json_valid(metadata_json)
          AND json_extract(metadata_json, '$.teamWorkspaceId') = ?`,
      [userId, teamWorkspaceId],
    );
    return row?.count ?? 0;
  } catch {
    return 0;
  }
}

/**
 * 根据探测结果构建初始化步骤清单。
 * - scan-shared-record：纯读，planner 已执行 → 直接标 done。
 * - 其余步骤按 projectKind 决定 proposed / not_applicable。
 */
export function buildTeamInitSteps(probe: ProjectEmptinessProbe): TeamInitStep[] {
  const nowIso = new Date().toISOString();
  const isExisting = probe.projectKind === 'existing';
  const isEmpty = probe.projectKind === 'empty';

  const steps: TeamInitStep[] = [];

  // 1) 共享记录扫描 —— 纯读，已在 planner 阶段完成。
  steps.push({
    key: 'scan-shared-record',
    title: '读取工作区共享项目记录',
    description: '检查该团队工作区已有的会话与工作目录，判断是否为空项目。',
    status: 'done',
    requiresConfirm: false,
    usesLlm: false,
    result: {
      projectKind: probe.projectKind,
      isEmpty,
      hasProjectSignals: probe.hasProjectSignals,
      matchedSignals: probe.matchedSignals,
      topLevelEntryCount: probe.topLevelEntryCount,
      workspaceSessionCount: probe.workspaceSessionCount,
      workingRootAvailable: probe.workingRootAvailable,
    },
    completedAt: nowIso,
  });

  // 2) 读取项目一级结构（仅非空项目）—— 列结构 + AI 解读各目录职责。
  steps.push({
    key: 'read-project-level1',
    title: '了解项目一级结构',
    description: '读取工作目录的顶层目录与文件，由 AI 解读项目类型与各目录职责。',
    status: isExisting ? 'proposed' : 'not_applicable',
    requiresConfirm: true,
    usesLlm: true,
  });

  // 3) 提取项目记忆（仅非空项目）—— 读记忆文件 + AI 提炼关键约束。
  steps.push({
    key: 'extract-project-memory',
    title: '提取项目记忆',
    description: '读取 project-memory / lessons-learned / AGENTS 等记忆文件，由 AI 提炼关键约束。',
    status: isExisting ? 'proposed' : 'not_applicable',
    requiresConfirm: true,
    usesLlm: true,
  });

  // 4) 理解项目架构（仅非空项目，可用 LLM）。
  steps.push({
    key: 'understand-architecture',
    title: '理解项目架构',
    description: '结合一级结构与 architecture.md / 配置文件，生成可注入的架构摘要。',
    status: isExisting ? 'proposed' : 'not_applicable',
    requiresConfirm: true,
    usesLlm: true,
  });

  // 5) 各层根据项目结构绑定工具（skill / mcp）—— 空/非空都需要。
  steps.push({
    key: 'bind-tools-per-layer',
    title: '为各层绑定工具能力',
    description: '依据项目类型为执行 / 规划等层级推荐并绑定合适的 skill 与 MCP。',
    status: 'proposed',
    requiresConfirm: true,
    usesLlm: true,
  });

  // 6) 空项目专属：生成初始项目记忆骨架（仅会话内摘要，不落盘）—— AI 按项目类型定制。
  steps.push({
    key: 'scaffold-memory',
    title: '搭建初始项目记忆',
    description: '为空项目准备一份初始项目记忆骨架，由 AI 结合工作区线索定制，作为后续协作的起点。',
    status: isEmpty ? 'proposed' : 'not_applicable',
    requiresConfirm: true,
    usesLlm: true,
  });

  return steps;
}

/**
 * 计划入口：探测 + 构建步骤 → 返回完整 TeamInitState（phase=proposed）。
 */
export async function planTeamInit(input: {
  workingRoot: string | null;
  teamWorkspaceId: string;
  userId: string;
}): Promise<TeamInitState> {
  const probe = await probeProjectEmptiness(input);
  const steps = buildTeamInitSteps(probe);
  return {
    version: TEAM_INIT_STATE_VERSION,
    phase: 'proposed',
    projectKind: probe.projectKind,
    detectedAt: new Date().toISOString(),
    steps,
    bindings: { perLayer: {} },
  };
}
