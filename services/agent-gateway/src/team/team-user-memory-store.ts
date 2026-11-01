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

import { sqliteGet, sqliteRun } from '../infra/db.js';
import { logGatewayWarn } from '../infra/gateway-logger.js';

interface UserMemoryRow {
  id: string;
  user_memory_md: string | null;
}

export interface UserMemoryRecord {
  userId: string;
  body: string;
}

/**
 * 写入者身份。
 *
 * - `user`：人工显式保存路径（用户在设置页 / 桌面端点保存）——允许直接落库；
 * - `maintenance`：自动 / 后台调用点——**fail-closed**，直接拒绝并记 warn，调用方
 *   必须改为创建待确认提议（`origin: 'team_init'`）。261101 起自动路径不得静默改写
 *   用户长期记忆。
 */
export type UserMemoryActorKind = 'user' | 'maintenance';

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

/**
 * 更新用户级长期记忆（`users.user_memory_md`）。
 *
 * `actorKind` 缺省为 `'user'`（保持既有调用点零改动）：只有人工显式路径可直接写。
 * 传 `'maintenance'` 时抛错并 warn —— 自动路径必须改走提议，不能再有静默写入旁路。
 */
export function updateUserMemory(input: {
  userId: string;
  body: string;
  actorKind?: UserMemoryActorKind;
}): UserMemoryRecord {
  const actorKind = input.actorKind ?? 'user';
  if (actorKind === 'maintenance') {
    logGatewayWarn(
      '[team-user-memory-store] 自动 / 后台路径尝试直接写入用户长期记忆，已 fail-closed 拒绝；请改为创建待确认提议。',
    );
    throw new Error('自动路径不得直接写入用户长期记忆，请改为提交待确认提议。');
  }
  sqliteRun(`UPDATE users SET user_memory_md = ? WHERE id = ?`, [input.body, input.userId]);
  return { userId: input.userId, body: input.body };
}
