import { sqliteGet } from '../infra/db.js';
import { parseSessionParentId } from '../session/session-descendant-tree.js';
import {
  DEFAULT_SUBAGENT_LIMITS,
  SUBAGENT_LIMITS_GUARDRAILS,
} from '../provider/provider-config.js';
import { resolveSubagentLimitsForUser } from './subagent-limits.js';

/**
 * 子代理嵌套深度限制。
 *
 * 对齐上游 `tool/plugin/subagent.ts`：沿会话父链累加深度，超过深度上限即拒绝
 * 再派生，避免子代理无界递归。深度上限是**用户级可调设置**的一项
 * （`subagent_limits.maxNestingDepth`，默认 **1**，护栏 1–8），由
 * `task/subagent-limits.ts` 统一读取；本文件只负责深度计算与判定。
 *
 * 本仓把父链放在 `sessions.metadata_json.parentSessionId`（task 子会话链，
 * 见 `session/session-descendant-tree.ts` 的链语义说明）。
 */

/** 上游默认值：只允许一层子代理（与统一限制的默认值同源）。 */
export const DEFAULT_SUBAGENT_DEPTH_LIMIT = DEFAULT_SUBAGENT_LIMITS.maxNestingDepth;

/** 深度上限护栏（保留导出便于文档与测试引用，实际校验在 schema 层）。 */
export const MAX_SUBAGENT_DEPTH_LIMIT = SUBAGENT_LIMITS_GUARDRAILS.maxNestingDepth.max;

export interface SubagentDepthChainRow {
  id: string;
  metadata_json: string;
}

/**
 * 沿 `metadata.parentSessionId` 链计算深度。
 *
 * 顶层会话深度为 `0`，其直接子代理深度为 `1`。父链缺失、断链或出现环时
 * 在当前位置停止（与 `collectDescendantSessionIds` 的容错取向一致）。
 */
export function computeSubagentDepth(
  sessionId: string,
  loadSession: (id: string) => SubagentDepthChainRow | undefined,
): number {
  let depth = 0;
  let currentId = sessionId;
  const visited = new Set<string>([sessionId]);

  for (;;) {
    const row = loadSession(currentId);
    if (!row) {
      return depth;
    }

    const parentId = parseSessionParentId(row.metadata_json);
    if (!parentId || visited.has(parentId)) {
      return depth;
    }

    visited.add(parentId);
    depth += 1;
    currentId = parentId;
  }
}

/** 读取用户级深度限制；缺失、损坏或非法时回落上游默认值 1。 */
export function resolveSubagentDepthLimit(userId: string): number {
  // 深度是统一子代理限制（`subagent_limits.maxNestingDepth`）的一项，
  // 由 `task/subagent-limits.ts` 负责读取与历史 `subagent_depth` 键的回落。
  return resolveSubagentLimitsForUser(userId).maxNestingDepth;
}

export function formatSubagentDepthLimitMessage(input: { depth: number; limit: number }): string {
  return [
    `已达到子代理嵌套深度上限（当前深度 ${input.depth}，上限 ${input.limit}）。`,
    '请在当前子会话内直接完成该工作，而不是继续派生新的子代理。',
    '如需允许更深嵌套，请在设置页的「子代理」区域提高嵌套深度上限。',
  ].join('\n');
}

export type SubagentDepthCheckResult =
  | { allowed: true; depth: number; limit: number }
  | { allowed: false; depth: number; limit: number; message: string };

/**
 * 校验「在 `parentSessionId` 下再派生一个子代理」是否被允许。
 *
 * 注意语义：当前会话自身深度为 `depth`，再派生一层后其子代理深度为 `depth + 1`，
 * 因此条件与上游一致——`depth >= limit` 即拒绝。
 */
export function checkSubagentDepthAllowed(input: {
  parentSessionId: string;
  userId: string;
  loadSession?: (id: string) => SubagentDepthChainRow | undefined;
}): SubagentDepthCheckResult {
  const loadSession = input.loadSession ?? loadSessionRow;
  const depth = computeSubagentDepth(input.parentSessionId, loadSession);
  const limit = resolveSubagentDepthLimit(input.userId);

  if (depth >= limit) {
    return {
      allowed: false,
      depth,
      limit,
      message: formatSubagentDepthLimitMessage({ depth, limit }),
    };
  }

  return { allowed: true, depth, limit };
}

function loadSessionRow(sessionId: string): SubagentDepthChainRow | undefined {
  return sqliteGet<SubagentDepthChainRow>(
    'SELECT id, metadata_json FROM sessions WHERE id = ? LIMIT 1',
    [sessionId],
  );
}
