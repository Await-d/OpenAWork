/**
 * T-18 编排可见性：把后端已落库的深度与派发统计解析成面板可渲染的形状。
 *
 * 数据来源（网关侧写入，前端只读）：
 *   - 编排深度：`reception→pm1` handoff 的 `payload.orchestrationDepth`
 *     （`handoff/runner/reception-orchestrator.ts` 写入）
 *   - 派发统计：PM2 handoff 的 `result_json.{parsedCount,dispatchedCount,cap,truncated,undispatched}`
 *     （`handoff/runner/pm2-runner.ts` 写入）
 *
 * 解析必须容错：这些字段来自历史记录，可能缺失或类型不符（旧任务、被截断的任务），
 * 不能因为一个字段异常就让整个面板不渲染。
 */

export type OrchestrationDepth = 'L0' | 'L1' | 'L2' | 'L3';

const DEPTH_LABELS: Record<OrchestrationDepth, string> = {
  L0: 'L0（只读回答）',
  L1: 'L1（小改动直接执行）',
  L2: 'L2（同模块改动）',
  L3: 'L3（跨模块 / 高风险改动）',
};

export function isOrchestrationDepth(value: unknown): value is OrchestrationDepth {
  return value === 'L0' || value === 'L1' || value === 'L2' || value === 'L3';
}

export function formatOrchestrationDepth(depth: OrchestrationDepth): string {
  return DEPTH_LABELS[depth];
}

export function readOrchestrationDepth(payload: unknown): OrchestrationDepth | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return null;
  }
  const value = (payload as { orchestrationDepth?: unknown }).orchestrationDepth;
  return isOrchestrationDepth(value) ? value : null;
}

export interface DispatchStats {
  /** 计划里解析出的任务数 */
  parsedCount: number | null;
  /** 实际派发出去的包数 */
  dispatchedCount: number | null;
  /** 派发上限（0 表示未设上限） */
  cap: number | null;
  /** 被上限截断的任务数 */
  truncated: number | null;
  /** 被截断任务的可读清单（`taskId: title`） */
  undispatched: string[];
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readUndispatched(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const { taskId, title } = entry as { taskId?: unknown; title?: unknown };
    if (typeof taskId !== 'string' || taskId.length === 0) return [];
    return [`${taskId}: ${typeof title === 'string' ? title : '（无标题）'}`];
  });
}

/**
 * 读取 PM2 派发统计。没有任何统计字段时返回 null，让调用方跳过渲染，
 * 而不是显示一排 0 让人误以为「解析到 0 个任务」。
 */
export function readDispatchStats(resultJson: unknown): DispatchStats | null {
  if (typeof resultJson !== 'object' || resultJson === null || Array.isArray(resultJson)) {
    return null;
  }
  const source = resultJson as Record<string, unknown>;
  const stats: DispatchStats = {
    parsedCount: readNumber(source['parsedCount'] ?? source['parsedTaskCount']),
    dispatchedCount: readNumber(source['dispatchedCount'] ?? source['packageCount']),
    cap: readNumber(source['cap']),
    truncated: readNumber(source['truncated']),
    undispatched: readUndispatched(source['undispatched']),
  };
  const hasAny =
    stats.parsedCount !== null ||
    stats.dispatchedCount !== null ||
    stats.cap !== null ||
    stats.truncated !== null ||
    stats.undispatched.length > 0;
  return hasAny ? stats : null;
}

/** 一行式摘要，例如「解析 3 / 派发 3 / 上限 8」。 */
export function formatDispatchStats(stats: DispatchStats): string {
  const parts = [
    `解析 ${stats.parsedCount ?? '—'}`,
    `派发 ${stats.dispatchedCount ?? '—'}`,
    stats.cap !== null && stats.cap > 0 ? `上限 ${stats.cap}` : '未设上限',
  ];
  if ((stats.truncated ?? 0) > 0) {
    parts.push(`被截断 ${stats.truncated}`);
  }
  return parts.join(' / ');
}
