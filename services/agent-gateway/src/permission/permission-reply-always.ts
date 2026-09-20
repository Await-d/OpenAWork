/**
 * 「always」模式的共享解析与回溯放行。
 *
 * 两条权限回复路径（`routes/permissions.ts` 与
 * `routes/session-shared-read-routes.ts`）必须保持同一语义，因此这里的两个函数
 * 是它们的唯一实现。
 */
import {
  PERMISSION_CATEGORIES,
  resolvePermissionCategory,
  wildcardMatch,
} from '@openAwork/agent-core';
import { sqliteAll, sqliteRunWithChanges } from '../infra/db.js';
import { appendPermissionDecisionLog } from '../session/permission-decision-log-store.js';
import { createPermissionRepliedEvent } from '../session/session-permission-events.js';
import { publishSessionRunEvent } from '../session/session-run-events.js';
import {
  parsePermissionAlwaysJson,
  parsePermissionRequestClientRequestId,
} from './permission-contract.js';

/** 持久化请求优先保留类别；仅对历史工具名执行工具到类别的转换。 */
export function resolvePermissionReplyCategory(toolNameOrCategory: string): string {
  if (PERMISSION_CATEGORIES.some((category) => category.id === toolNameOrCategory)) {
    return toolNameOrCategory;
  }
  return resolvePermissionCategory(toolNameOrCategory);
}

export interface PermissionAlwaysSource {
  tool_name: string;
  scope: string;
  always_json: string | null;
}

/**
 * always 模式的唯一解析入口（save 单一事实来源）。
 *
 * 优先客户端 `alwaysOverride`（用户显式选择的授权范围档位），否则用请求自身
 * 持久化的 `always_json`（由权限派生器写入），最后回退原始 scope——绝不因为缺少
 * `always_json` 列就把永久授权静默放宽成 `*`。
 */
export function resolveAlwaysPatterns(
  permissionRequest: PermissionAlwaysSource,
  alwaysOverride: string[] | undefined,
): string[] {
  if (alwaysOverride && alwaysOverride.length > 0) {
    return alwaysOverride;
  }
  const parsedAlways = parsePermissionAlwaysJson(permissionRequest.always_json);
  return parsedAlways.length > 0 ? parsedAlways : [permissionRequest.scope];
}

interface PendingCoverageRow {
  id: string;
  tool_name: string;
  scope: string;
  request_payload_json: string | null;
}

/**
 * 授予「本会话允许 / 永久允许」后，同会话同类别中已被新规则覆盖的其它 pending
 * 请求一并自动放行（对齐 opencode 的 always 回溯放行，permission.ts:250-283），
 * 避免用户对同一批调用逐个点击。
 *
 * 有意不自动 resume：每次 resume 都会启动一次完整 LLM 续跑，并发续跑同一会话
 * 不安全；被放行的请求是持久审批行，后续重试会直接命中。范围限定同会话——跨会话
 * pending 属罕见场景，且其它会话的新请求已由 user 级 grant 自动放行。
 *
 * 返回被放行的 request id，供调用方做通知已读与响应计数。
 */
export function cascadeApproveCoveredPendingPermissions(input: {
  sessionId: string;
  excludeRequestId: string;
  category: string;
  patterns: string[];
  decision: 'permanent' | 'session';
}): string[] {
  const rows = sqliteAll<PendingCoverageRow>(
    `SELECT id, tool_name, scope, request_payload_json
       FROM permission_requests
      WHERE session_id = ? AND status = 'pending' AND id != ? AND tool_name = ?
      ORDER BY created_at ASC`,
    [input.sessionId, input.excludeRequestId, input.category],
  ).filter((row) => input.patterns.some((pattern) => wildcardMatch(row.scope, pattern)));

  const cascadedRequestIds: string[] = [];
  for (const row of rows) {
    const changes = sqliteRunWithChanges(
      `UPDATE permission_requests
       SET status = 'approved', decision = ?, updated_at = datetime('now')
       WHERE id = ? AND session_id = ? AND status = 'pending'`,
      [input.decision, row.id, input.sessionId],
    );
    if (changes === 0) {
      continue;
    }
    appendPermissionDecisionLog({
      requestId: row.id,
      sessionId: input.sessionId,
      toolName: row.tool_name,
      scope: row.scope,
      decision: input.decision,
    });
    const clientRequestId = parsePermissionRequestClientRequestId(row.request_payload_json);
    publishSessionRunEvent(
      input.sessionId,
      createPermissionRepliedEvent({ requestId: row.id, decision: input.decision }),
      clientRequestId ? { clientRequestId } : undefined,
    );
    cascadedRequestIds.push(row.id);
  }
  return cascadedRequestIds;
}
