/**
 * 技能状态持久化存储
 *
 * 用于在会话级别持久化已调用的技能，以便在会话恢复时能够重新加载技能上下文。
 *
 * 核心功能：
 * - recordInvokedSkill: 记录已调用的技能
 * - loadInvokedSkills: 加载会话的所有已调用技能
 * - clearSkillState: 清理会话的技能状态
 *
 * 数据库表结构：
 * - session_invoked_skills: 技能调用记录
 *   - id: 自增主键
 *   - session_id: 会话 ID（外键，级联删除）
 *   - skill_name: 技能名称
 *   - skill_path: 技能文件路径
 *   - skill_content: 技能内容
 *   - invoked_at: 调用时间
 *   - UNIQUE(session_id, skill_name): 防止重复记录
 */

import { sqliteAll, sqliteRun } from '../infra/db.js';

export interface InvokedSkill {
  id: number;
  sessionId: string;
  skillName: string;
  skillPath: string;
  skillContent: string;
  invokedAt: string;
}

export interface InvokedSkillRecord {
  id: number;
  session_id: string;
  skill_name: string;
  skill_path: string;
  skill_content: string;
  invoked_at: string;
}

/**
 * 记录已调用的技能
 *
 * 使用 INSERT OR REPLACE 确保同一会话中的同一技能只有一条记录。
 * 如果技能已存在，会更新调用时间和内容。
 *
 * @param sessionId 会话 ID
 * @param skillName 技能名称
 * @param skillPath 技能文件路径
 * @param skillContent 技能内容
 */
export function recordInvokedSkill(
  sessionId: string,
  skillName: string,
  skillPath: string,
  skillContent: string,
): void {
  sqliteRun(
    `
    INSERT INTO session_invoked_skills (session_id, skill_name, skill_path, skill_content, invoked_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(session_id, skill_name)
    DO UPDATE SET
      skill_path = excluded.skill_path,
      skill_content = excluded.skill_content,
      invoked_at = excluded.invoked_at
    `,
    [sessionId, skillName, skillPath, skillContent],
  );
}

/**
 * 加载会话的所有已调用技能
 *
 * 按调用时间升序返回，以便按原始调用顺序恢复。
 *
 * @param sessionId 会话 ID
 * @returns 已调用的技能列表
 */
export function loadInvokedSkills(sessionId: string): InvokedSkill[] {
  const rows = sqliteAll<InvokedSkillRecord>(
    `
    SELECT id, session_id, skill_name, skill_path, skill_content, invoked_at
    FROM session_invoked_skills
    WHERE session_id = ?
    ORDER BY invoked_at ASC
    `,
    [sessionId],
  );

  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    skillName: row.skill_name,
    skillPath: row.skill_path,
    skillContent: row.skill_content,
    invokedAt: row.invoked_at,
  }));
}

/**
 * 清理会话的所有技能状态
 *
 * 用于会话删除或显式清理场景。
 * 注意：由于数据库设置了 ON DELETE CASCADE，会话删除时会自动清理，
 * 但保留此函数用于显式清理场景。
 *
 * @param sessionId 会话 ID
 */
export function clearSkillState(sessionId: string): void {
  sqliteRun(
    `
    DELETE FROM session_invoked_skills
    WHERE session_id = ?
    `,
    [sessionId],
  );
}

/**
 * 检查会话是否有已调用的技能
 *
 * @param sessionId 会话 ID
 * @returns 是否有已调用的技能
 */
export function hasInvokedSkills(sessionId: string): boolean {
  const result = sqliteAll<{ count: number }>(
    `
    SELECT COUNT(*) as count
    FROM session_invoked_skills
    WHERE session_id = ?
    `,
    [sessionId],
  );

  return (result[0]?.count ?? 0) > 0;
}

/**
 * 获取会话已调用的技能数量
 *
 * @param sessionId 会话 ID
 * @returns 已调用的技能数量
 */
export function countInvokedSkills(sessionId: string): number {
  const result = sqliteAll<{ count: number }>(
    `
    SELECT COUNT(*) as count
    FROM session_invoked_skills
    WHERE session_id = ?
    `,
    [sessionId],
  );

  return result[0]?.count ?? 0;
}
