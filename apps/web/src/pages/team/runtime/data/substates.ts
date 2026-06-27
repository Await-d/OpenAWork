/**
 * substate 常量定义（L1.3 spec §1.2.2 同步）
 *
 * **后端依据**：`docs/team-architecture-l1-3-streaming-handoff-spec.md` §1.2.2
 *
 * 后端 sessions 表的 substate / substate_updated_at 字段已落地（db.ts ensureColumn）。
 * substate-store.ts 的 setSubstate 会原子写入并广播 team event。
 * 本文件定义前端使用的 substate 字符串常量 + 进度顺序 + 显示文案。
 *
 * 全局禁止任何 UI 代码硬编码 substate 字符串——必须 import 这里的常量。
 */

// ─── c 层（PM1 / 任务规划）substate ───────────────────────────────────────

export const SUBSTATES_C = {
  IDLE: 'idle',
  DRAFTING_SPEC: 'drafting_spec',
  SPEC_READY: 'spec_ready',
  CLARIFYING: 'clarifying',
  DRAFTING_PLAN: 'drafting_plan',
  PLAN_READY: 'plan_ready',
  DRAFTING_TASKS: 'drafting_tasks',
  TASKS_READY: 'tasks_ready',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

export type SubstateC = (typeof SUBSTATES_C)[keyof typeof SUBSTATES_C];

/** c 层 substate 推进顺序（用于进度条计算）。 */
export const SUBSTATE_C_ORDER: SubstateC[] = [
  SUBSTATES_C.IDLE,
  SUBSTATES_C.DRAFTING_SPEC,
  SUBSTATES_C.SPEC_READY,
  SUBSTATES_C.CLARIFYING, // 在 spec_ready 之后可能进入
  SUBSTATES_C.DRAFTING_PLAN,
  SUBSTATES_C.PLAN_READY,
  SUBSTATES_C.DRAFTING_TASKS,
  SUBSTATES_C.TASKS_READY,
  SUBSTATES_C.COMPLETED,
];

export const SUBSTATE_C_LABEL: Record<SubstateC, string> = {
  idle: '等待开始',
  drafting_spec: '草拟规格',
  spec_ready: '规格就绪',
  clarifying: '等待澄清',
  drafting_plan: '草拟计划',
  plan_ready: '计划就绪',
  drafting_tasks: '拆分任务',
  tasks_ready: '任务就绪',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

// ─── d 层（PM2 / 开发管控）substate ──────────────────────────────────────

export const SUBSTATES_D = {
  IDLE: 'idle',
  CONSTITUTION_CHECK: 'constitution_check',
  ARCHITECTURE_REVIEW: 'architecture_review',
  DISPATCHING: 'dispatching',
  AWAITING_EG: 'awaiting_eg',
  REVIEWING: 'reviewing',
  ESCALATING: 'escalating',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

export type SubstateD = (typeof SUBSTATES_D)[keyof typeof SUBSTATES_D];

export const SUBSTATE_D_ORDER: SubstateD[] = [
  SUBSTATES_D.IDLE,
  SUBSTATES_D.CONSTITUTION_CHECK,
  SUBSTATES_D.ARCHITECTURE_REVIEW,
  SUBSTATES_D.DISPATCHING,
  SUBSTATES_D.AWAITING_EG,
  SUBSTATES_D.REVIEWING,
  SUBSTATES_D.ESCALATING,
  SUBSTATES_D.COMPLETED,
];

export const SUBSTATE_D_LABEL: Record<SubstateD, string> = {
  idle: '等待开始',
  constitution_check: '宪法检查',
  architecture_review: '架构 review',
  dispatching: '派发任务',
  awaiting_eg: '等待执行',
  reviewing: '双重 review',
  escalating: '退回修正中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

// ─── reception 层（接待 / 等待下游）substate ─────────────────────────────

export const SUBSTATES_RECEPTION = {
  IDLE: 'idle',
  CHATTING: 'chatting',
  ROUTING: 'routing',
  DISPATCHING: 'dispatching',
  AWAITING_DOWNSTREAM: 'awaiting_downstream',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

export type SubstateReception = (typeof SUBSTATES_RECEPTION)[keyof typeof SUBSTATES_RECEPTION];

export const SUBSTATE_RECEPTION_LABEL: Record<SubstateReception, string> = {
  idle: '等待开始',
  chatting: '对话中',
  routing: '路由中',
  dispatching: '派发任务',
  awaiting_downstream: '等待下游',
  failed: '失败',
  cancelled: '已取消',
};

// ─── e/f/g 层（执行）substate ────────────────────────────────────────────

export const SUBSTATES_E = {
  IDLE: 'idle',
  IMPLEMENTING: 'implementing',
  TESTING: 'testing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

export type SubstateE = (typeof SUBSTATES_E)[keyof typeof SUBSTATES_E];

export const SUBSTATE_E_ORDER: SubstateE[] = [
  SUBSTATES_E.IDLE,
  SUBSTATES_E.IMPLEMENTING,
  SUBSTATES_E.TESTING,
  SUBSTATES_E.COMPLETED,
];

export const SUBSTATE_E_LABEL: Record<SubstateE, string> = {
  idle: '等待开始',
  implementing: '实现中',
  testing: '测试中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

// ─── 通用辅助 ─────────────────────────────────────────────────────────

/**
 * 跨层级合并的 substate → 中文标签表。用于不便确定 roleLayer 的场景（如推送通知条
 * 只拿到一个 substate 字符串）。三层有重叠 key（idle/completed/failed/cancelled），
 * 合并时语义一致，后写覆盖不影响结果。
 */
export const SUBSTATE_LABEL_ANY: Record<string, string> = {
  ...SUBSTATE_RECEPTION_LABEL,
  ...SUBSTATE_C_LABEL,
  ...SUBSTATE_D_LABEL,
  ...SUBSTATE_E_LABEL,
};

/** 取任意 substate 的中文标签，未知值回退原文。 */
export function substateLabelAny(substate: string | null | undefined): string | null {
  if (!substate) return null;
  return SUBSTATE_LABEL_ANY[substate] ?? substate;
}

/**
 * 根据 roleLayer 选择对应的 substate 顺序与标签表。
 * roleLayer 来自 sessions.role_layer 字段（Phase B 已落地）。
 */
export function selectSubstateMeta(roleLayer: string | null | undefined): {
  order: readonly string[];
  label: Record<string, string>;
} | null {
  switch (roleLayer) {
    case 'reception':
      return { order: Object.values(SUBSTATES_RECEPTION), label: SUBSTATE_RECEPTION_LABEL };
    case 'pm1':
      return { order: SUBSTATE_C_ORDER, label: SUBSTATE_C_LABEL };
    case 'pm2':
      return { order: SUBSTATE_D_ORDER, label: SUBSTATE_D_LABEL };
    case 'executor':
    case 'reviewer':
      return { order: SUBSTATE_E_ORDER, label: SUBSTATE_E_LABEL };
    default:
      return null;
  }
}

/**
 * 计算 substate 的进度百分比（0-100）。
 * 终态（completed/failed/cancelled）返回 100。
 * 非顺序中的 substate（如 clarifying 在 spec_ready 之后）返回当前 = 上一步进度。
 */
export function computeSubstateProgress(
  order: readonly string[],
  current: string | null | undefined,
): number {
  if (!current) return 0;
  if (current === 'completed' || current === 'failed' || current === 'cancelled') {
    return 100;
  }
  const index = order.indexOf(current);
  if (index < 0) return 0;
  // order 含终态 completed，所以分母用 order.length - 1
  const denominator = Math.max(order.length - 1, 1);
  return Math.round((index / denominator) * 100);
}
