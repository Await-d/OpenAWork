/**
 * 待审批权限请求的读取口（261101）。
 *
 * 为什么单独收敛在这里：`permission_requests` 的**写入**在沙箱阶梯
 * （`tools/sandbox/permission-ladder.ts`）、**决策**在 `routes/permissions.ts`，
 * 而渠道侧既要判断「本轮是不是停在等审批」，又要在审批后判断「是不是又停了
 * 一轮」，两边都只关心同一个谓词（`status = 'pending'`）。把那条 SQL 复制到
 * 多个调用点，迟早会出现一处忘了带上 status 条件的情况。
 */

import { sqliteAll } from '../infra/db.js';
import type { PermissionRiskLevel } from './permission-contract.js';

export interface PendingPermissionSummary {
  readonly id: string;
  readonly toolName: string;
  readonly scope: string;
  readonly riskLevel: PermissionRiskLevel;
  readonly expiresAt: number | null;
}

interface PendingPermissionRow {
  id: string;
  tool_name: string;
  scope: string;
  risk_level: string;
  expires_at: number | null;
}

/**
 * 最早失效的 pending 请求的时间戳；没有带时限的请求时返回 `null`。
 *
 * 用于把「这条授权多久作废」告诉渠道用户：`expires_at` 为空表示该请求不会超时
 * （`resolvePermissionRequestTimeoutMs` 返回空），此时不该编一个时间出来。
 */
export function resolveEarliestPendingExpiry(
  entries: readonly PendingPermissionSummary[],
): number | null {
  return entries.reduce<number | null>((earliest, entry) => {
    if (typeof entry.expiresAt !== 'number') {
      return earliest;
    }
    return earliest === null || entry.expiresAt < earliest ? entry.expiresAt : earliest;
  }, null);
}

/** 按创建顺序列出该会话当前挂着的待审批请求（最早的在最前）。 */
export function listPendingPermissionSummaries(sessionId: string): PendingPermissionSummary[] {
  return sqliteAll<PendingPermissionRow>(
    `SELECT id, tool_name, scope, risk_level, expires_at
       FROM permission_requests
      WHERE session_id = ? AND status = 'pending'
      ORDER BY created_at ASC`,
    [sessionId],
  ).map((row) => ({
    id: row.id,
    toolName: row.tool_name,
    scope: row.scope,
    riskLevel: row.risk_level as PermissionRiskLevel,
    expiresAt: row.expires_at,
  }));
}
