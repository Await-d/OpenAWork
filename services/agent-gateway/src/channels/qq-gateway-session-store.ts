import { sqliteGet, sqliteRun } from '../infra/db.js';

export interface QQGatewaySessionState {
  readonly sessionId: string;
  readonly lastSeq: number;
  readonly lastConnectedAt: number;
  readonly intentLevelIndex: number;
  readonly savedAt: number;
}

interface UserSettingRow {
  readonly value: string;
}

const SESSION_KEY_PREFIX = 'qq_gateway_session:';

function buildSessionKey(pluginId: string): string {
  return `${SESSION_KEY_PREFIX}${pluginId}`;
}

function isSessionState(value: unknown): value is QQGatewaySessionState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record['sessionId'] === 'string' &&
    record['sessionId'].length > 0 &&
    typeof record['lastSeq'] === 'number' &&
    Number.isFinite(record['lastSeq']) &&
    typeof record['lastConnectedAt'] === 'number' &&
    Number.isFinite(record['lastConnectedAt']) &&
    typeof record['intentLevelIndex'] === 'number' &&
    Number.isInteger(record['intentLevelIndex']) &&
    typeof record['savedAt'] === 'number' &&
    Number.isFinite(record['savedAt'])
  );
}

export function loadQQGatewaySession(
  userId: string | undefined,
  pluginId: string,
): QQGatewaySessionState | null {
  if (!userId) {
    return null;
  }
  const row = sqliteGet<UserSettingRow>(
    'SELECT value FROM user_settings WHERE user_id = ? AND key = ? LIMIT 1',
    [userId, buildSessionKey(pluginId)],
  );
  if (!row) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(row.value);
    return isSessionState(parsed) ? parsed : null;
  } catch (error) {
    console.warn('[qq] gateway session 解析失败，已忽略旧会话', {
      pluginId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export function saveQQGatewaySession(
  userId: string | undefined,
  pluginId: string,
  state: QQGatewaySessionState,
): void {
  if (!userId) {
    return;
  }
  try {
    sqliteRun(
      `INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      [userId, buildSessionKey(pluginId), JSON.stringify(state)],
    );
  } catch (error) {
    console.warn('[qq] gateway session 保存失败，已跳过本次持久化', {
      pluginId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function clearQQGatewaySession(userId: string | undefined, pluginId: string): void {
  if (!userId) {
    return;
  }
  try {
    sqliteRun('DELETE FROM user_settings WHERE user_id = ? AND key = ?', [
      userId,
      buildSessionKey(pluginId),
    ]);
  } catch (error) {
    console.warn('[qq] gateway session 清理失败，已忽略', {
      pluginId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
