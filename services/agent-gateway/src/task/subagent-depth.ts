import { sqliteGet } from '../infra/db.js';
import { parseSessionParentId } from '../session/session-descendant-tree.js';

/**
 * 子代理嵌套深度限制。
 *
 * 对齐上游 `tool/plugin/subagent.ts`：沿会话父链累加深度，超过
 * `experimental.subagent_depth`（默认 **1**）即拒绝再派生，避免子代理无界递归。
 * 本仓把父链放在 `sessions.metadata_json.parentSessionId`（task 子会话链，
 * 见 `session/session-descendant-tree.ts` 的链语义说明）。
 */

/** 上游默认值：只允许一层子代理。 */
export const DEFAULT_SUBAGENT_DEPTH_LIMIT = 1;

/** 上限护栏：避免用户设置出荒谬值导致完全无法派生。 */
const MAX_SUBAGENT_DEPTH_LIMIT = 8;

const SUBAGENT_DEPTH_KEY = 'subagent_depth';

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

function normalizeLimit(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_SUBAGENT_DEPTH_LIMIT;
  }
  return Math.min(Math.trunc(parsed), MAX_SUBAGENT_DEPTH_LIMIT);
}

/** 读取用户级深度限制；缺失、损坏或非法时回落上游默认值 1。 */
export function resolveSubagentDepthLimit(userId: string): number {
  let raw: unknown;
  try {
    const row = sqliteGet<{ value: string }>(
      'SELECT value FROM user_settings WHERE user_id = ? AND key = ?',
      [userId, SUBAGENT_DEPTH_KEY],
    );
    raw = row ? (JSON.parse(row.value) as unknown) : undefined;
  } catch {
    raw = undefined;
  }
  return normalizeLimit(raw);
}

export function formatSubagentDepthLimitMessage(input: { depth: number; limit: number }): string {
  return [
    `已达到子代理嵌套深度上限（当前深度 ${input.depth}，上限 ${input.limit}）。`,
    '请在当前子会话内直接完成该工作，而不是继续派生新的子代理。',
    '如需允许更深嵌套，请提高子代理深度设置（subagent_depth）。',
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
