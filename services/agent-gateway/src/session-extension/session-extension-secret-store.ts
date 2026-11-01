/**
 * 会话级凭据存储（261101）。
 *
 * 方案 §4 的要求是「`secretRef` 逐次验证归属，**不让模型在聊天中填写密钥**」。因此
 * 这里刻意分成两条路：
 *   - **写入**只走 owner-only 的 HTTP 接口（`PUT /sessions/:id/extension-secrets/:name`），
 *     模型与工具都拿不到它；
 *   - **读取**只在建连那一刻按 `secretRef` 解析一次，明文不落库、不回显、不入日志。
 *
 * 密文复用网关既有的信封加密原语（`ssh/ssh-secret-cipher`，AES-256-GCM，主密钥
 * 落在 `resolveGatewayDataDir()`）——不另造一套密钥管理，避免「同一台机器两套主密钥、
 * 备份时漏一份」。
 *
 * 本模块**不做** `secretRef` 归属校验：那是 `session-extension-runtime-policy` 的职责，
 * 由调用方先验后取，避免两个模块互相 import 成环。
 */

import { sqliteAll, sqliteGet, sqliteRunWithChanges } from '../infra/db.js';
import { decryptSecret, encryptSecret } from '../ssh/ssh-secret-cipher.js';

/**
 * 凭据名允许集合。
 *
 * 同时用于 env 变量名与 header 名，所以只留最保守的一类字符；`:` 明确排除——
 * `secretRef` 用冒号分隔会话与名称，名称里含冒号会让解析产生歧义。
 */
const SECRET_NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export function isValidSessionExtensionSecretName(name: string): boolean {
  return SECRET_NAME_PATTERN.test(name);
}

export interface SessionExtensionSecretMeta {
  readonly name: string;
  readonly updatedAt: number;
}

/** 写入（或轮换）一条会话凭据；`value` 为明文，落库前加密。 */
export function setSessionExtensionSecret(params: {
  sessionId: string;
  name: string;
  value: string;
  now?: number;
}): boolean {
  if (!isValidSessionExtensionSecretName(params.name)) return false;
  const now = params.now ?? Date.now();
  const cipher = encryptSecret(params.value);
  if (cipher === null) return false;
  // 轮换即换密文：`updated_at` 同时参与 MCP 连接指纹，让旧连接立刻失效。
  return (
    sqliteRunWithChanges(
      `INSERT INTO session_extension_secrets (session_id, name, value_cipher, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(session_id, name) DO UPDATE SET value_cipher = excluded.value_cipher, updated_at = excluded.updated_at`,
      [params.sessionId, params.name, cipher, now, now],
    ) > 0
  );
}

export function deleteSessionExtensionSecret(sessionId: string, name: string): boolean {
  return (
    sqliteRunWithChanges(
      'DELETE FROM session_extension_secrets WHERE session_id = ? AND name = ?',
      [sessionId, name],
    ) > 0
  );
}

export function hasSessionExtensionSecret(sessionId: string, name: string): boolean {
  const row = sqliteGet<{ name: string }>(
    'SELECT name FROM session_extension_secrets WHERE session_id = ? AND name = ? LIMIT 1',
    [sessionId, name],
  );
  return row !== undefined;
}

/**
 * 凭据的最后修改时间；不存在返回 `null`。
 *
 * 参与 MCP 连接指纹：轮换同一引用下的值必须让旧连接作废，否则改完密钥还在用旧的。
 */
export function getSessionExtensionSecretUpdatedAt(sessionId: string, name: string): number | null {
  const row = sqliteGet<{ updated_at: number }>(
    'SELECT updated_at FROM session_extension_secrets WHERE session_id = ? AND name = ? LIMIT 1',
    [sessionId, name],
  );
  return row?.updated_at ?? null;
}

/** 只列名字与时间，**绝不含明文**——供状态接口回显「已配置哪些凭据」。 */
export function listSessionExtensionSecretMetas(sessionId: string): SessionExtensionSecretMeta[] {
  return sqliteAll<{ name: string; updated_at: number }>(
    'SELECT name, updated_at FROM session_extension_secrets WHERE session_id = ? ORDER BY name ASC',
    [sessionId],
  ).map((row) => ({ name: row.name, updatedAt: row.updated_at }));
}

/**
 * 解析 `secretRef` 指向的明文。
 *
 * 返回 `null` 表示「不存在」——调用方必须 fail-closed 拒绝建连，绝不能退化成
 * 「引用无效所以不带凭据继续连」。
 */
export function resolveSessionExtensionSecretValue(params: {
  sessionId: string;
  name: string;
}): { name: string; value: string } | null {
  const row = sqliteGet<{ value_cipher: string }>(
    'SELECT value_cipher FROM session_extension_secrets WHERE session_id = ? AND name = ? LIMIT 1',
    [params.sessionId, params.name],
  );
  if (!row) return null;
  const value = decryptSecret(row.value_cipher);
  if (value === null || value.length === 0) return null;
  return { name: params.name, value };
}

/** 会话删除时清理（表本身有 FK 级联，这里是「显式调用也可」的幂等出口）。 */
export function clearSessionExtensionSecrets(sessionId: string): number {
  return sqliteRunWithChanges('DELETE FROM session_extension_secrets WHERE session_id = ?', [
    sessionId,
  ]);
}

/** 只用于测试/排障的轻量存在性检查。 */
export function countSessionExtensionSecrets(sessionId: string): number {
  const row = sqliteGet<{ count: number }>(
    'SELECT COUNT(*) AS count FROM session_extension_secrets WHERE session_id = ?',
    [sessionId],
  );
  return row?.count ?? 0;
}
