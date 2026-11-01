import { randomUUID } from 'node:crypto';
import { sqliteGet, sqliteRun, sqliteRunWithChanges, sqliteTransaction } from '../../infra/db.js';

export function claimMemorySemanticAnalysis(
  userId: string,
  scopeKey: string,
  fingerprint: string,
  now: Date,
): string | null {
  return sqliteTransaction(() => {
    const day = now.toISOString().slice(0, 10);
    sqliteRun('DELETE FROM memory_semantic_usage WHERE day < ?', [
      new Date(now.getTime() - 35 * 86_400_000).toISOString().slice(0, 10),
    ]);
    sqliteRun('INSERT OR IGNORE INTO memory_semantic_scopes(user_id, scope_key) VALUES (?, ?)', [
      userId,
      scopeKey,
    ]);
    const token = randomUUID();
    const claimed = sqliteRunWithChanges(
      `UPDATE memory_semantic_scopes SET lease_token = ?, lease_until = ?
       WHERE user_id = ? AND scope_key = ? AND (fingerprint IS NULL OR fingerprint != ?)
         AND (lease_until IS NULL OR lease_until <= ?)`,
      [
        token,
        new Date(now.getTime() + 120_000).toISOString(),
        userId,
        scopeKey,
        fingerprint,
        now.toISOString(),
      ],
    );
    if (!claimed) return null;
    sqliteRun('INSERT OR IGNORE INTO memory_semantic_usage(user_id, day) VALUES (?, ?)', [
      userId,
      day,
    ]);
    const reserved = sqliteRunWithChanges(
      'UPDATE memory_semantic_usage SET calls = calls + 1 WHERE user_id = ? AND day = ? AND calls < 3',
      [userId, day],
    );
    if (!reserved) {
      releaseMemorySemanticAnalysis(userId, scopeKey, token);
      return null;
    }
    return token;
  });
}

export function ownsMemorySemanticAnalysis(
  userId: string,
  scopeKey: string,
  token: string,
  now: Date,
): boolean {
  return (
    sqliteGet<{ lease_token: string }>(
      `SELECT lease_token FROM memory_semantic_scopes
     WHERE user_id = ? AND scope_key = ? AND lease_token = ? AND lease_until > ?`,
      [userId, scopeKey, token, now.toISOString()],
    ) !== undefined
  );
}

export function completeMemorySemanticAnalysis(
  userId: string,
  scopeKey: string,
  token: string,
  fingerprint: string,
): void {
  sqliteRun(
    `UPDATE memory_semantic_scopes SET fingerprint = ?, lease_token = NULL, lease_until = NULL
     WHERE user_id = ? AND scope_key = ? AND lease_token = ?`,
    [fingerprint, userId, scopeKey, token],
  );
}

export function releaseMemorySemanticAnalysis(
  userId: string,
  scopeKey: string,
  token: string,
): void {
  sqliteRun(
    `UPDATE memory_semantic_scopes SET lease_token = NULL, lease_until = NULL
     WHERE user_id = ? AND scope_key = ? AND lease_token = ?`,
    [userId, scopeKey, token],
  );
}

export function recordMemorySemanticTokens(
  userId: string,
  now: Date,
  inputTokens: number,
  outputTokens: number,
): void {
  const bounded = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0);
  sqliteRun(
    `UPDATE memory_semantic_usage SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ?
     WHERE user_id = ? AND day = ?`,
    [bounded(inputTokens), bounded(outputTokens), userId, now.toISOString().slice(0, 10)],
  );
}
