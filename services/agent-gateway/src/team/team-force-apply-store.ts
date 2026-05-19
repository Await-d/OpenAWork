/**
 * 260515-team-phase-a · T-09 后端支撑
 *
 * ForceApply（强制使下一轮 LLM prompt 缓存失效）。
 *
 * 用户改完 user_memory / constitution / persona 后，下一轮 LLM 调用会自动
 * 拿到新内容（因为我们在 prompt 拼接时是当场读 DB），但 Anthropic / OpenAI
 * 的 prompt cache 是基于 prefix 哈希的——只要 stable 段没有"被动"变化，
 * 仍然会命中旧 prefix，导致用户感觉"我改了 SOUL 但模型没反应"。
 *
 * ForceApply 解决思路：
 *   - 在 stable system prompt 里追加一个不可见的 "cache breaker" 段，内容
 *     包含 (userId, lastForceAppliedAt) 哈希
 *   - 用户点击 ForceApply 时记录 lastForceAppliedAt = now
 *   - 下一轮调用 prompt 拼接时读到新 lastForceAppliedAt → stable 段哈希变 →
 *     prompt cache 自动 miss 并重新拼装
 *
 * 限流（D41 C3）：24 小时内最多 5 次 ForceApply。超出返回 429。
 */

import { sqliteAll, sqliteGet, sqliteRun } from '../db.js';

interface ForceApplyEventRow {
  id: number;
  user_id: string;
  applied_at: string;
}

const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_MAX_USES = 5;

// 表 / 索引由 db.ts::migrate() 创建（与其他表一致），本模块不再做懒初始化。

export interface ForceApplyState {
  /** 24 小时内已用次数 */
  usedInWindow: number;
  /** 24 小时窗口内最多次数 */
  maxInWindow: number;
  /** 上一次 ForceApply 的 ISO 时间戳；从未 ForceApply 过返回 null */
  lastAppliedAt: string | null;
}

function loadEventsInWindow(userId: string): ForceApplyEventRow[] {
  // SQLite 的 datetime('now') 返回 'YYYY-MM-DD HH:MM:SS'（UTC）格式，
  // 这里把 JS Date 也换成同格式以保证字符串比较正确。
  const cutoffIso = new Date(Date.now() - RATE_LIMIT_WINDOW_MS)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);
  return sqliteAll<ForceApplyEventRow>(
    `SELECT id, user_id, applied_at
     FROM team_force_apply_events
     WHERE user_id = ? AND applied_at >= ?
     ORDER BY applied_at DESC`,
    [userId, cutoffIso],
  );
}

export function getForceApplyState(userId: string): ForceApplyState {
  const events = loadEventsInWindow(userId);
  const lastEvent = sqliteGet<ForceApplyEventRow>(
    `SELECT id, user_id, applied_at
     FROM team_force_apply_events
     WHERE user_id = ?
     ORDER BY applied_at DESC LIMIT 1`,
    [userId],
  );
  return {
    usedInWindow: events.length,
    maxInWindow: RATE_LIMIT_MAX_USES,
    lastAppliedAt: lastEvent?.applied_at ?? null,
  };
}

export type ForceApplyResult =
  | { ok: true; state: ForceApplyState }
  | { ok: false; reason: 'rate-limited'; state: ForceApplyState };

/**
 * 记录一次 ForceApply 事件。如果 24h 内已用满 5 次返回 rate-limited。
 */
export function recordForceApply(userId: string): ForceApplyResult {
  const events = loadEventsInWindow(userId);
  if (events.length >= RATE_LIMIT_MAX_USES) {
    return {
      ok: false,
      reason: 'rate-limited',
      state: {
        usedInWindow: events.length,
        maxInWindow: RATE_LIMIT_MAX_USES,
        lastAppliedAt: events[0]?.applied_at ?? null,
      },
    };
  }
  sqliteRun(
    `INSERT INTO team_force_apply_events (user_id, applied_at) VALUES (?, datetime('now'))`,
    [userId],
  );
  return { ok: true, state: getForceApplyState(userId) };
}

/**
 * 给 stable system prompt 提供 cache-breaker tag。
 * 内容是 lastAppliedAt 的 ISO 时间戳；从未 ForceApply 过时返回固定 'never'。
 *
 * 注意：这段会被嵌进 stable prefix 里，所以它的变化即等于 prompt cache miss。
 */
export function getForceApplyCacheTag(userId: string): string {
  const state = getForceApplyState(userId);
  return state.lastAppliedAt ?? 'never';
}
