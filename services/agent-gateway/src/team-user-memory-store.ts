/**
 * 260515-team-phase-a · T-04 / T-06 后端
 *
 * 用户级长期记忆（users.user_memory_md）数据访问层。
 *
 * 对应 7 层指令注入栈第 6 层。这一段记忆是"该用户跨工作区一致的长期偏好"，
 * 区别于现有的 memories 表（按 (type, key) 抽取的结构化偏好条目）。
 *
 * 字段：users.user_memory_md TEXT NOT NULL DEFAULT ''
 *
 * 这里只做最小写入接口；安全扫描由 routes/* 层在调用前完成。
 */

import { sqliteGet, sqliteRun } from './db.js';

interface UserMemoryRow {
  id: string;
  user_memory_md: string | null;
}

export interface UserMemoryRecord {
  userId: string;
  body: string;
}

export function getUserMemory(userId: string): UserMemoryRecord | undefined {
  const row = sqliteGet<UserMemoryRow>(
    `SELECT id, user_memory_md FROM users WHERE id = ? LIMIT 1`,
    [userId],
  );
  if (!row) return undefined;
  return {
    userId: row.id,
    body: row.user_memory_md ?? '',
  };
}

export function updateUserMemory(input: { userId: string; body: string }): UserMemoryRecord {
  sqliteRun(`UPDATE users SET user_memory_md = ? WHERE id = ?`, [input.body, input.userId]);
  return { userId: input.userId, body: input.body };
}
