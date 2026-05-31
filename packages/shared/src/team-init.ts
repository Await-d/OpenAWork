/**
 * 团队会话「初始化阶段」（team init phase）共享类型。
 *
 * 背景：团队会话创建完成后不再直接进入「等用户提需求 → 编排」，而是先进入一个
 * **初始化阶段**——自动算出一份「初始化待办清单」，逐项展示给用户，每一项都需要
 * 用户确认后才执行（纯读、零副作用的步骤可标记为自动执行）。每步的产物（项目记忆、
 * 架构理解、各层 skill / mcp 绑定）全部回写到会话 metadata 上，形成「已初始化标记」，
 * 后续任意位置读取会话都能知道哪些初始化了、哪些没有。
 *
 * 该模块同时被前端（apps/web）与后端（services/agent-gateway）消费，所以放在
 * @openAwork/shared，避免协议分叉。后端 zod schema 与本文件的 TS 类型保持同构。
 */

import type { TeamRuntimeLayer } from './index.js';

/** 初始化阶段的整体状态机。 */
export type TeamInitPhase =
  | 'proposed' // 已算出清单，等待用户逐项确认
  | 'in_progress' // 至少一步已执行，还有未完成步骤
  | 'completed' // 所有需要的步骤都已完成
  | 'skipped'; // 用户跳过初始化（直接提需求）

/** 项目空/非空判定结果。 */
export type TeamInitProjectKind =
  | 'empty' // 空项目 / 空工作目录
  | 'existing' // 已有内容的项目
  | 'unknown'; // 无法判定（如无 working root）

/** 单个初始化步骤的稳定 key。新增步骤时同步更新 TEAM_INIT_STEP_ORDER。 */
export type TeamInitStepKey =
  | 'scan-shared-record' // 读取共享项目记录 + 判定空/非空（纯读，自动执行）
  | 'read-project-level1' // 读取项目一级目录结构（非空项目）
  | 'extract-project-memory' // 提取项目记忆（project-memory / lessons-learned / AGENTS）
  | 'understand-architecture' // 理解项目架构（可用 LLM）
  | 'bind-tools-per-layer' // 各层根据项目结构绑定 skill / mcp
  | 'scaffold-memory'; // 空项目：生成初始项目记忆骨架

/** 单步状态机。 */
export type TeamInitStepStatus =
  | 'proposed' // 已提议，等待用户确认
  | 'confirmed' // 用户已确认，等待执行（运行前的瞬时态）
  | 'running' // 执行中
  | 'done' // 执行成功
  | 'skipped' // 用户跳过该步
  | 'failed' // 执行失败（可重试）
  | 'not_applicable'; // 当前项目类型不适用（如空项目跳过 architecture）

/** 单个初始化步骤记录（回写到 sessions.metadata_json.teamInit.steps）。 */
export interface TeamInitStep {
  key: TeamInitStepKey;
  title: string;
  /** 给用户看的一句话说明。 */
  description: string;
  status: TeamInitStepStatus;
  /**
   * 是否需要用户显式确认才执行。
   * 纯读、零副作用的步骤（如 scan-shared-record）可设 false 让 planner 自动执行。
   */
  requiresConfirm: boolean;
  /** 该步是否会调用 LLM（前端可据此提示「会消耗额度」）。 */
  usesLlm: boolean;
  /** 执行产物（形状随 key 而定，前端只做展示，不强约束）。 */
  result?: Record<string, unknown> | null;
  /** 失败时的错误摘要。 */
  error?: string | null;
  confirmedAt?: string | null;
  completedAt?: string | null;
}

/** 单层的能力绑定快照。 */
export interface TeamInitLayerBinding {
  skillIds: string[];
  mcpServerIds: string[];
  /** 绑定理由（LLM / 启发式给出的一句话，便于用户理解）。 */
  rationale?: string | null;
  boundAt?: string | null;
}

/** 初始化产出的绑定汇总。 */
export interface TeamInitBindings {
  /** 按运行层组织的 skill / mcp 绑定。 */
  perLayer: Partial<Record<TeamRuntimeLayer, TeamInitLayerBinding>>;
  /** 项目架构摘要（理解项目后写入，可注入后续指令栈）。 */
  architectureSummary?: string | null;
  /** 项目记忆要点（从 project-memory / lessons-learned 提取）。 */
  projectMemoryDigest?: string | null;
}

/** 会话上的初始化标记块（sessions.metadata_json.teamInit）。 */
export interface TeamInitState {
  version: number;
  phase: TeamInitPhase;
  projectKind: TeamInitProjectKind;
  detectedAt?: string | null;
  steps: TeamInitStep[];
  bindings: TeamInitBindings;
}

export const TEAM_INIT_STATE_VERSION = 1;

/** 步骤的标准展示顺序。 */
export const TEAM_INIT_STEP_ORDER: TeamInitStepKey[] = [
  'scan-shared-record',
  'read-project-level1',
  'extract-project-memory',
  'understand-architecture',
  'bind-tools-per-layer',
  'scaffold-memory',
];

/** 判断初始化是否已结束（completed / skipped）——结束后不再阻塞正常编排。 */
export function isTeamInitFinished(state: TeamInitState | null | undefined): boolean {
  return state?.phase === 'completed' || state?.phase === 'skipped';
}

/**
 * 根据当前 steps 派生整体 phase。
 * - 所有「适用且需要」的步骤都 done/skipped → completed
 * - 否则若有任意一步已经 done/running → in_progress
 * - 否则 proposed
 * 注意：phase='skipped' 是用户显式跳过的终态，不由本函数推导。
 */
export function deriveTeamInitPhase(steps: TeamInitStep[]): Exclude<TeamInitPhase, 'skipped'> {
  const actionable = steps.filter((step) => step.status !== 'not_applicable');
  if (actionable.length === 0) {
    return 'completed';
  }
  const allSettled = actionable.every(
    (step) => step.status === 'done' || step.status === 'skipped',
  );
  if (allSettled) {
    return 'completed';
  }
  const anyStarted = actionable.some(
    (step) => step.status === 'done' || step.status === 'running' || step.status === 'skipped',
  );
  return anyStarted ? 'in_progress' : 'proposed';
}
