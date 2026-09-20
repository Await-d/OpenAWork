import { sqliteGet } from '../infra/db.js';
import { CHILD_SESSION_TERMINAL_REASON_KEY } from '../tools/tool-sandbox.js';
import { parseSessionMetadataJson } from './session-workspace-metadata.js';

/**
 * 子会话是否已被终止（停止或超时）。
 *
 * 终止标记由 `terminateChildSession` 写入 `metadata.terminalReason`。回复权限 / 提问
 * 会触发 resume 并真正执行工具，因此 resume 入口必须先问这个守卫：否则用户在点击
 * 「停止子代理」的同一瞬间批准权限，已取消的子代理会被重新唤起并产生工具副作用。
 */
export function isTerminatedChildSession(sessionId: string): boolean {
  const row = sqliteGet<{ metadata_json: string }>(
    'SELECT metadata_json FROM sessions WHERE id = ? LIMIT 1',
    [sessionId],
  );
  if (!row) {
    return false;
  }

  const terminalReason = parseSessionMetadataJson(row.metadata_json)[
    CHILD_SESSION_TERMINAL_REASON_KEY
  ];
  return terminalReason === 'timeout' || terminalReason === 'cancelled';
}
