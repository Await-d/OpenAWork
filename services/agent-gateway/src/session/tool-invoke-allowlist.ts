/**
 * Tool-invoke allowlist — 会话级「折叠工具可调用名单」。
 *
 * `tool_invoke` 解包后必须校验内层工具确实对本会话可见：名单由网关在构建
 * 本轮工具面时写入（直连 + 折叠 + 元工具），因此天然继承会话/团队层/渠道/
 * 对话模式等全部上游门控；沙箱侧只做成员校验，不再重复整条过滤链。
 *
 * 存储位置与会话记忆一致：`sessions.metadata_json.toolInvokeAllowlist`。
 * 名单不变时不写库，避免每轮额外的 metadata 写入（也避免扰动缓存前缀）。
 */

import { sqliteGet, sqliteRun } from '../infra/db.js';

export const TOOL_INVOKE_ALLOWLIST_KEY = 'toolInvokeAllowlist';

function readMetadata(sessionId: string, userId: string): Record<string, unknown> | null {
  const row = sqliteGet<{ metadata_json: string }>(
    'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ?',
    [sessionId, userId],
  );
  if (!row?.metadata_json) return null;
  try {
    const parsed = JSON.parse(row.metadata_json) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function readToolInvokeAllowlist(sessionId: string, userId: string): string[] {
  const metadata = readMetadata(sessionId, userId);
  const value = metadata?.[TOOL_INVOKE_ALLOWLIST_KEY];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

/**
 * 写入本轮可见工具名单；内容未变化时跳过写入。
 *
 * 返回是否实际写库（便于调用方观测）。
 */
export function writeToolInvokeAllowlist(
  sessionId: string,
  userId: string,
  toolNames: readonly string[],
): boolean {
  const unique = [...new Set(toolNames)]
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
    .map((name) => name.trim())
    .sort();
  const metadata = readMetadata(sessionId, userId);
  if (metadata === null) return false;
  const existing = Array.isArray(metadata[TOOL_INVOKE_ALLOWLIST_KEY])
    ? (metadata[TOOL_INVOKE_ALLOWLIST_KEY] as unknown[]).filter(
        (entry): entry is string => typeof entry === 'string',
      )
    : [];
  if (
    existing.length === unique.length &&
    existing.every((name, index) => name === unique[index])
  ) {
    return false;
  }
  metadata[TOOL_INVOKE_ALLOWLIST_KEY] = unique;
  sqliteRun('UPDATE sessions SET metadata_json = ? WHERE id = ? AND user_id = ?', [
    JSON.stringify(metadata),
    sessionId,
    userId,
  ]);
  return true;
}
