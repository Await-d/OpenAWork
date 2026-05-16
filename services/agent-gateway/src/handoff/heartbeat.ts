/**
 * 260515-team-phase-b · T-06 心跳基础设施
 *
 * 为每个团队 session（具有 role_layer 的）写入定期心跳，让 watcher / 崩溃
 * 恢复模块可以判断哪些 running session 是真活的。
 *
 * 设计：
 *   - 用 `sessions.last_heartbeat`（Phase B T-01 已加列）作为心跳锚
 *   - 由 stream-runtime 在每轮 LLM round 起始时调用 `touchSessionHeartbeat`
 *     （T-09/T-10 重构时接入；当前模块独立提供该函数）
 *   - 检测超时由 `findStaleHeartbeatCutoffIso` + handoff-store 的
 *     `reclaimAbandonedHandoffs` 配合完成
 *
 * 不做的事（推迟）：
 *   - 心跳超时直接终止 session 的"硬重置"——目前只让 handoff 退回 pending
 *   - 心跳进程级守护——由 Watcher 自身的 setInterval 已经覆盖
 */

import { sqliteRun } from '../db.js';

/** 心跳超时阈值：60s（v3.11 D51）。超过该时长仍未刷新视为崩溃。 */
export const HEARTBEAT_STALE_AFTER_MS = 60 * 1000;

/**
 * 为某个 session 刷一次心跳（写当前 UTC 时间到 last_heartbeat）。
 * 调用频率建议：每个 LLM round 起始 + 每 30s 中途各一次。
 */
export function touchSessionHeartbeat(sessionId: string): void {
  sqliteRun(`UPDATE sessions SET last_heartbeat = datetime('now') WHERE id = ?`, [sessionId]);
}

/**
 * 把 sessions.last_heartbeat 清空（用于 graceful shutdown 或显式标记不再活跃）。
 */
export function clearSessionHeartbeat(sessionId: string): void {
  sqliteRun(`UPDATE sessions SET last_heartbeat = NULL WHERE id = ?`, [sessionId]);
}

/**
 * 返回"早于此 ISO 字符串即视为超时"的截止值。
 * 与 SQLite `datetime('now')` 同格式（'YYYY-MM-DD HH:MM:SS' UTC）。
 */
export function findStaleHeartbeatCutoffIso(staleAfterMs = HEARTBEAT_STALE_AFTER_MS): string {
  return new Date(Date.now() - staleAfterMs).toISOString().replace('T', ' ').slice(0, 19);
}
