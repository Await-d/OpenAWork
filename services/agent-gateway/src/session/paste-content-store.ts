/**
 * Paste Content Store — 大文本（>1KB）哈希存储，减少 session_messages 体积
 *
 * 核心功能：
 * - 自动检测大文本内容（阈值：1KB）
 * - 计算 SHA-256 哈希并去重
 * - 存储到 session_paste_contents 表
 * - 会话删除时级联清理
 *
 * 参考实现：temp/claude-code-sourcemap/restored-src/src/utils/pasteStore.ts
 */

import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { sqliteGet, sqliteRun } from '../infra/db.js';

/** 大文本阈值：1KB (1024 字节) */
export const PASTE_CONTENT_THRESHOLD_BYTES = 1024;

interface PasteContentRow {
  id: string;
  session_id: string;
  content_hash: string;
  content: string;
  size_bytes: number;
  created_at: string;
  last_accessed_at: string;
}

/**
 * 计算内容的 SHA-256 哈希值
 * @param content - 文本内容
 * @returns 完整的 SHA-256 哈希值（64 字符）
 */
export function hashPasteContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * 检查内容是否超过阈值，需要哈希存储
 * @param content - 文本内容
 * @returns 是否需要存储为粘贴内容
 */
export function shouldStorePasteContent(content: string): boolean {
  return Buffer.byteLength(content, 'utf8') > PASTE_CONTENT_THRESHOLD_BYTES;
}

/**
 * 存储粘贴内容到数据库
 *
 * @param sessionId - 会话 ID
 * @param content - 文本内容
 * @returns 内容哈希值，如果内容过小则返回 null
 *
 * @example
 * ```ts
 * const largeText = "...".repeat(1000);
 * const hash = storePasteContent(sessionId, largeText);
 * if (hash) {
 *   // 使用 PasteReference 替代原始内容
 * }
 * ```
 */
export function storePasteContent(sessionId: string, content: string): string | null {
  // 小文本直接内联，不存储
  if (!shouldStorePasteContent(content)) {
    return null;
  }

  const contentHash = hashPasteContent(content);
  const sizeBytes = Buffer.byteLength(content, 'utf8');

  // 检查是否已存在（去重）
  const existing = sqliteGet<Pick<PasteContentRow, 'id'>>(
    'SELECT id FROM session_paste_contents WHERE content_hash = ? LIMIT 1',
    [contentHash],
  );

  if (existing) {
    // 已存在，更新访问时间
    sqliteRun(
      "UPDATE session_paste_contents SET last_accessed_at = datetime('now') WHERE content_hash = ?",
      [contentHash],
    );
    return contentHash;
  }

  // 插入新记录
  const id = randomUUID();
  sqliteRun(
    `INSERT INTO session_paste_contents
     (id, session_id, content_hash, content, size_bytes, created_at, last_accessed_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [id, sessionId, contentHash, content, sizeBytes],
  );

  return contentHash;
}

/**
 * 根据哈希值检索粘贴内容
 *
 * @param sessionId - 会话 ID（用于访问控制）
 * @param contentHash - 内容哈希值
 * @returns 原始内容，如果未找到则返回 null
 *
 * @example
 * ```ts
 * const content = retrievePasteContent(sessionId, hash);
 * if (content) {
 *   // 展开引用
 * }
 * ```
 */
export function retrievePasteContent(sessionId: string, contentHash: string): string | null {
  const row = sqliteGet<Pick<PasteContentRow, 'content'>>(
    'SELECT content FROM session_paste_contents WHERE content_hash = ? AND session_id = ? LIMIT 1',
    [contentHash, sessionId],
  );

  if (row) {
    // 更新访问时间
    sqliteRun(
      "UPDATE session_paste_contents SET last_accessed_at = datetime('now') WHERE content_hash = ?",
      [contentHash],
    );
    return row.content;
  }

  return null;
}

/**
 * 垃圾回收：删除未被引用的粘贴内容
 *
 * @param sessionId - 会话 ID
 * @param referencedHashes - 当前仍在使用的哈希值集合
 *
 * @example
 * ```ts
 * // 在会话压缩或清理时调用
 * const activeHashes = extractPasteReferencesFromMessages(messages);
 * gcUnusedPastes(sessionId, activeHashes);
 * ```
 */
export function gcUnusedPastes(sessionId: string, referencedHashes: Set<string>): void {
  if (referencedHashes.size === 0) {
    // 没有引用，删除所有该会话的粘贴内容
    sqliteRun('DELETE FROM session_paste_contents WHERE session_id = ?', [sessionId]);
    return;
  }

  // 删除未被引用的内容
  const placeholders = Array.from(referencedHashes)
    .map(() => '?')
    .join(',');
  sqliteRun(
    `DELETE FROM session_paste_contents
     WHERE session_id = ? AND content_hash NOT IN (${placeholders})`,
    [sessionId, ...Array.from(referencedHashes)],
  );
}

/**
 * 获取会话的粘贴内容统计
 *
 * @param sessionId - 会话 ID
 * @returns 统计信息：总数、总字节数
 */
export function getPasteContentStats(sessionId: string): {
  count: number;
  totalBytes: number;
} {
  const row = sqliteGet<{ count: number; total_bytes: number | null }>(
    'SELECT COUNT(*) as count, SUM(size_bytes) as total_bytes FROM session_paste_contents WHERE session_id = ?',
    [sessionId],
  );

  return {
    count: row?.count ?? 0,
    totalBytes: row?.total_bytes ?? 0,
  };
}

/**
 * 清理指定会话的所有粘贴内容（会话删除时调用）
 *
 * @param sessionId - 会话 ID
 * @returns 删除的记录数
 */
export function clearSessionPasteContents(sessionId: string): number {
  const beforeCount = getPasteContentStats(sessionId).count;
  sqliteRun('DELETE FROM session_paste_contents WHERE session_id = ?', [sessionId]);
  const afterCount = getPasteContentStats(sessionId).count;
  return beforeCount - afterCount;
}

/**
 * 批量存储多个粘贴内容（优化版本）
 *
 * @param sessionId - 会话 ID
 * @param contents - 内容数组
 * @returns 哈希值数组（小文本对应 null）
 */
export function storePasteContentsBatch(sessionId: string, contents: string[]): (string | null)[] {
  const results: (string | null)[] = [];

  for (const content of contents) {
    results.push(storePasteContent(sessionId, content));
  }

  return results;
}
