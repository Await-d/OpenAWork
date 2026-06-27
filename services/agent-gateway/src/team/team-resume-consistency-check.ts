/**
 * Team 恢复前一致性校验。
 *
 * 在 resumeTeamRuntimeTree 之前调用，扫描 session 子树并修复以下不一致状态：
 *   1. orphan session — parent 已 cancelled/failed 但 child 仍 running/paused
 *   2. zombie handoff — state=running/claimed 但 to_session 不存在
 *   3. duplicate handoff — 同一 from→to 层级有多条 running
 *   4. stale heartbeat — running handoff 的心跳已过期（先 reclaim 让 watcher 重新 claim）
 *   5. stuck state_status — state_status=running 但无 in-flight 流
 *
 * 所有修复均为 best-effort：单条失败不阻塞其余，只记 warn 日志。
 */

import { sqliteAll, sqliteRun } from '../infra/db.js';
import { cancelHandoff } from '../handoff/store/handoff-store.js';
import { findStaleHeartbeatCutoffIso, HEARTBEAT_STALE_AFTER_MS } from '../handoff/bus/heartbeat.js';
import { buildSqlitePlaceholders, chunkSqliteBindValues } from '../infra/sqlite-batch.js';

export interface ConsistencyFix {
  type:
    | 'orphan_session_cancelled'
    | 'zombie_handoff_failed'
    | 'duplicate_handoff_cancelled'
    | 'stale_heartbeat_reclaimed'
    | 'stuck_running_reset';
  sessionId?: string;
  handoffId?: string;
  detail: string;
}

export interface ConsistencyReport {
  fixes: ConsistencyFix[];
  orphanSessionCount: number;
  zombieHandoffCount: number;
  duplicateHandoffCount: number;
  staleHeartbeatCount: number;
  stuckRunningCount: number;
  totalFixes: number;
}

interface SessionTreeNodeRow {
  id: string;
  parent_id: string | null;
  role_layer: string | null;
  state_status: string | null;
  substate: string | null;
  paused: number;
  last_heartbeat: string | null;
}

interface HandoffRow {
  id: string;
  state: string;
  from_session_id: string;
  to_session_id: string | null;
  from_role_layer: string;
  to_role_layer: string;
  paused: number;
  retry_count: number;
}

/**
 * 对 session 子树做恢复前一致性扫描与修复。
 *
 * @returns ConsistencyReport — 描述每项修复的详情
 */
export function preResumeConsistencyCheck(input: {
  rootSessionId: string;
  userId: string;
}): ConsistencyReport {
  const fixes: ConsistencyFix[] = [];

  // ── 收集子树所有 session ──────────────────────────────────────────
  const sessions = sqliteAll<SessionTreeNodeRow>(
    `WITH RECURSIVE session_tree(id) AS (
       SELECT id FROM sessions WHERE id = ? AND user_id = ?
       UNION ALL
       SELECT child.id FROM sessions child
         JOIN session_tree tree ON child.team_parent_session_id = tree.id
        WHERE child.user_id = ?
     )
     SELECT s.id, s.team_parent_session_id AS parent_id, s.role_layer,
            s.state_status, s.substate, s.paused, s.last_heartbeat
       FROM sessions s
      WHERE s.user_id = ? AND s.id IN (SELECT id FROM session_tree)`,
    [input.rootSessionId, input.userId, input.userId, input.userId],
  );

  if (sessions.length === 0) {
    return emptyReport();
  }

  const sessionIds = sessions.map((s) => s.id);
  const sessionById = new Map(sessions.map((s) => [s.id, s]));

  // ── 1. orphan session 检测 ────────────────────────────────────────
  // parent 已 cancelled/failed 但 child 仍非终态 → 将 child substate 置 cancelled
  for (const session of sessions) {
    if (!session.parent_id) continue;
    const parent = sessionById.get(session.parent_id);
    if (!parent) continue;

    const parentTerminal = parent.substate === 'cancelled' || parent.substate === 'failed';
    if (!parentTerminal) continue;

    const childTerminal =
      session.substate === 'cancelled' ||
      session.substate === 'failed' ||
      session.substate === 'completed';
    if (childTerminal) continue;

    try {
      sqliteRun(
        `UPDATE sessions
            SET substate = 'cancelled',
                state_status = 'idle',
                updated_at = datetime('now')
          WHERE id = ? AND user_id = ?`,
        [session.id, input.userId],
      );
      fixes.push({
        type: 'orphan_session_cancelled',
        sessionId: session.id,
        detail: `parent ${session.parent_id} 已终态(${parent.substate})，child ${session.id} 仍 ${session.substate}，已置 cancelled`,
      });
    } catch (err) {
      console.warn(
        `[resume-consistency] orphan session 修复失败（${session.id}）：${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // ── 收集子树所有 handoff ──────────────────────────────────────────
  const handoffsById = new Map<string, HandoffRow>();
  for (const batchSessionIds of chunkSqliteBindValues(sessionIds, 1, undefined, 2)) {
    const placeholders = buildSqlitePlaceholders(batchSessionIds.length, ', ');
    const rows = sqliteAll<HandoffRow>(
      `SELECT id, state, from_session_id, to_session_id,
            from_role_layer, to_role_layer, paused, retry_count
       FROM handoff_records
      WHERE user_id = ?
        AND (
          from_session_id IN (${placeholders})
          OR to_session_id IN (${placeholders})
        )`,
      [input.userId, ...batchSessionIds, ...batchSessionIds],
    );
    for (const row of rows) {
      if (!handoffsById.has(row.id)) {
        handoffsById.set(row.id, row);
      }
    }
  }
  const handoffs = Array.from(handoffsById.values());

  // ── 2. zombie handoff 检测 ────────────────────────────────────────
  // state=running/claimed 但 to_session 不存在或不在子树中 → 置 failed
  for (const handoff of handoffs) {
    if (handoff.state !== 'running' && handoff.state !== 'claimed') continue;
    if (handoff.to_session_id && sessionById.has(handoff.to_session_id)) continue;

    try {
      sqliteRun(
        `UPDATE handoff_records
            SET state = 'failed',
                failure_reason = 'zombie-handoff-to-session-missing',
                completed_at = datetime('now'),
                updated_at = datetime('now')
          WHERE id = ? AND user_id = ? AND state IN ('running', 'claimed')`,
        [handoff.id, input.userId],
      );
      fixes.push({
        type: 'zombie_handoff_failed',
        handoffId: handoff.id,
        detail: `handoff ${handoff.id} state=${handoff.state} 但 to_session ${handoff.to_session_id ?? 'null'} 不存在`,
      });
    } catch (err) {
      console.warn(
        `[resume-consistency] zombie handoff 修复失败（${handoff.id}）：${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // ── 3. duplicate handoff 检测 ─────────────────────────────────────
  // 同一 from_session_id + to_role_layer 有多条 running → 保留最新，其余 cancel
  const runningHandoffs = handoffs.filter((h) => h.state === 'running');
  const groupedByKey = new Map<string, HandoffRow[]>();
  for (const h of runningHandoffs) {
    const key = `${h.from_session_id}:${h.to_role_layer}`;
    const group = groupedByKey.get(key);
    if (group) {
      group.push(h);
    } else {
      groupedByKey.set(key, [h]);
    }
  }

  for (const [, group] of groupedByKey) {
    if (group.length <= 1) continue;
    // 按 id 降序排（假设越新的 id 越大——UUID 不保证但实际近似），保留第一条
    group.sort((a, b) => b.id.localeCompare(a.id));
    for (let i = 1; i < group.length; i++) {
      const dup = group[i]!;
      try {
        if (
          cancelHandoff({
            userId: input.userId,
            handoffId: dup.id,
          })
        ) {
          fixes.push({
            type: 'duplicate_handoff_cancelled',
            handoffId: dup.id,
            detail: `from=${dup.from_session_id} to_layer=${dup.to_role_layer} 有 ${group.length} 条 running，取消冗余 ${dup.id}`,
          });
        }
      } catch (err) {
        console.warn(
          `[resume-consistency] duplicate handoff 修复失败（${dup.id}）：${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  // ── 4. stale heartbeat 检测 ───────────────────────────────────────
  // running handoff 的 to_session 心跳已过期 → 退回 pending 让 watcher 重新 claim
  const staleCutoff = findStaleHeartbeatCutoffIso(HEARTBEAT_STALE_AFTER_MS);
  for (const handoff of handoffs) {
    if (handoff.state !== 'running' && handoff.state !== 'claimed') continue;
    // Paused handoffs are intentionally waiting for user/system control flow;
    // reclaiming them here would clear to_session_id before resume-all can
    // fan out resume_signal to the existing assignee session.
    if (handoff.paused === 1) continue;
    if (!handoff.to_session_id) continue;
    const session = sessionById.get(handoff.to_session_id);
    if (!session) continue;

    const heartbeatStale = session.last_heartbeat === null || session.last_heartbeat < staleCutoff;
    if (!heartbeatStale) continue;

    try {
      // 退回 pending，retry_count 不变（由 watcher 的 reclaim 逻辑统一处理 retry_count）
      sqliteRun(
        `UPDATE handoff_records
            SET state = 'pending',
                claim_token = NULL,
                claimed_at = NULL,
                started_at = NULL,
                to_session_id = NULL,
                updated_at = datetime('now')
          WHERE id = ? AND user_id = ? AND state IN ('running', 'claimed')`,
        [handoff.id, input.userId],
      );
      fixes.push({
        type: 'stale_heartbeat_reclaimed',
        handoffId: handoff.id,
        detail: `handoff ${handoff.id} 心跳过期（last_heartbeat=${session.last_heartbeat ?? 'null'}），已退回 pending`,
      });
    } catch (err) {
      console.warn(
        `[resume-consistency] stale heartbeat 修复失败（${handoff.id}）：${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // ── 5. stuck state_status 检测 ────────────────────────────────────
  // state_status=running 但 session 不是任何活跃 handoff 的 to_session → 重置为 idle
  const activeToSessionIds = new Set(
    handoffs
      .filter((h) => h.state === 'running' || h.state === 'claimed')
      .map((h) => h.to_session_id)
      .filter((id): id is string => id !== null),
  );

  for (const session of sessions) {
    if (session.state_status !== 'running') continue;
    if (!session.role_layer) continue; // 只处理 team session
    if (activeToSessionIds.has(session.id)) continue; // 有活跃 handoff，合理

    try {
      sqliteRun(
        `UPDATE sessions
            SET state_status = 'idle',
                updated_at = datetime('now')
          WHERE id = ? AND user_id = ? AND state_status = 'running'`,
        [session.id, input.userId],
      );
      fixes.push({
        type: 'stuck_running_reset',
        sessionId: session.id,
        detail: `session ${session.id} state_status=running 但无活跃 handoff，已重置为 idle`,
      });
    } catch (err) {
      console.warn(
        `[resume-consistency] stuck running 修复失败（${session.id}）：${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  return {
    fixes,
    orphanSessionCount: fixes.filter((f) => f.type === 'orphan_session_cancelled').length,
    zombieHandoffCount: fixes.filter((f) => f.type === 'zombie_handoff_failed').length,
    duplicateHandoffCount: fixes.filter((f) => f.type === 'duplicate_handoff_cancelled').length,
    staleHeartbeatCount: fixes.filter((f) => f.type === 'stale_heartbeat_reclaimed').length,
    stuckRunningCount: fixes.filter((f) => f.type === 'stuck_running_reset').length,
    totalFixes: fixes.length,
  };
}

function emptyReport(): ConsistencyReport {
  return {
    fixes: [],
    orphanSessionCount: 0,
    zombieHandoffCount: 0,
    duplicateHandoffCount: 0,
    staleHeartbeatCount: 0,
    stuckRunningCount: 0,
    totalFixes: 0,
  };
}
