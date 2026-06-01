import { cancelHandoff, pauseHandoff, resumeHandoff } from '../handoff/store/handoff-store.js';
import { sqliteAll, sqliteGet, sqliteRun } from '../infra/db.js';

interface TeamRuntimeControlScopeRow {
  id: string;
  role_layer: string | null;
}

interface TeamRuntimeControlSessionRow {
  id: string;
  paused: number;
  paused_at: string | null;
}

interface TeamRuntimeControlHandoffRow {
  id: string;
}

export interface TeamRuntimeControlScope {
  controllableSessionIds: string[];
  rootRoleLayer: string | null;
  rootSessionId: string;
  treeSessionIds: string[];
}

export interface PauseTeamRuntimeTreeResult extends TeamRuntimeControlScope {
  pausedHandoffIds: string[];
  pausedSessionIds: string[];
}

export interface ResumeTeamRuntimeTreeResult extends TeamRuntimeControlScope {
  resumedHandoffIds: string[];
  resumedSessionIds: string[];
  staleSessionCount: number;
}

export interface CancelTeamRuntimeTreeResult extends TeamRuntimeControlScope {
  cancelledHandoffIds: string[];
}

export function resolveTeamRuntimeControlScope(input: {
  rootSessionId: string;
  userId: string;
}): TeamRuntimeControlScope | null {
  const root = sqliteGet<TeamRuntimeControlScopeRow>(
    `SELECT id, role_layer
       FROM sessions
      WHERE id = ? AND user_id = ?
      LIMIT 1`,
    [input.rootSessionId, input.userId],
  );
  if (!root) {
    return null;
  }

  const treeRows = sqliteAll<{ id: string }>(
    `WITH RECURSIVE session_tree(id) AS (
       SELECT id
         FROM sessions
        WHERE id = ? AND user_id = ?
       UNION ALL
       SELECT child.id
         FROM sessions child
         JOIN session_tree tree
           ON child.team_parent_session_id = tree.id
        WHERE child.user_id = ?
     )
     SELECT id FROM session_tree`,
    [input.rootSessionId, input.userId, input.userId],
  );

  const treeSessionIds = treeRows.map((row) => row.id);
  const controllableSessionIds =
    root.role_layer === 'reception'
      ? treeSessionIds.filter((sessionId) => sessionId !== input.rootSessionId)
      : treeSessionIds;

  return {
    controllableSessionIds,
    rootRoleLayer: root.role_layer,
    rootSessionId: input.rootSessionId,
    treeSessionIds,
  };
}

export function pauseTeamRuntimeTree(input: {
  reason?: string | null;
  rootSessionId: string;
  userId: string;
}): PauseTeamRuntimeTreeResult | null {
  const scope = resolveTeamRuntimeControlScope(input);
  if (!scope) {
    return null;
  }

  const pausedSessionIds = selectSessionIdsByPausedState({
    paused: false,
    sessionIds: scope.controllableSessionIds,
    userId: input.userId,
  });

  if (pausedSessionIds.length > 0) {
    sqliteRun(
      `UPDATE sessions
          SET paused = 1,
              paused_at = datetime('now'),
              paused_by_user_id = ?,
              pause_reason = ?,
              updated_at = datetime('now')
        WHERE user_id = ?
          AND paused = 0
          AND id IN (${pausedSessionIds.map(() => '?').join(', ')})`,
      [input.userId, input.reason ?? null, input.userId, ...pausedSessionIds],
    );
  }

  const handoffIds = listControllableHandoffIds({
    paused: false,
    sessionIds: scope.treeSessionIds,
    userId: input.userId,
  });
  const pausedHandoffIds: string[] = [];
  for (const handoffId of handoffIds) {
    if (pauseHandoff({ userId: input.userId, handoffId, reason: input.reason ?? null })) {
      pausedHandoffIds.push(handoffId);
    }
  }

  return {
    ...scope,
    pausedHandoffIds,
    pausedSessionIds,
  };
}

export function resumeTeamRuntimeTree(input: {
  rootSessionId: string;
  userId: string;
}): ResumeTeamRuntimeTreeResult | null {
  const scope = resolveTeamRuntimeControlScope(input);
  if (!scope) {
    return null;
  }

  const pausedSessionRows = selectPausedSessionRows({
    sessionIds: scope.controllableSessionIds,
    userId: input.userId,
  });
  const resumedSessionIds = pausedSessionRows.map((row) => row.id);
  const staleSessionCount = pausedSessionRows.filter(
    (row) => row.paused_at !== null && row.paused_at < oneHourAgoSqliteDateTime(),
  ).length;

  if (resumedSessionIds.length > 0) {
    sqliteRun(
      `UPDATE sessions
          SET paused = 0,
              paused_at = NULL,
              paused_by_user_id = NULL,
              pause_reason = NULL,
              updated_at = datetime('now')
        WHERE user_id = ?
          AND paused = 1
          AND id IN (${resumedSessionIds.map(() => '?').join(', ')})`,
      [input.userId, ...resumedSessionIds],
    );
  }

  const handoffIds = listControllableHandoffIds({
    paused: true,
    sessionIds: scope.treeSessionIds,
    userId: input.userId,
  });
  const resumedHandoffIds: string[] = [];
  for (const handoffId of handoffIds) {
    if (resumeHandoff({ userId: input.userId, handoffId })) {
      resumedHandoffIds.push(handoffId);
    }
  }

  return {
    ...scope,
    resumedHandoffIds,
    resumedSessionIds,
    staleSessionCount,
  };
}

/**
 * 级联取消：把某个 session 子树下所有未终止的 handoff 全部 cancel。
 *
 * 背景（跨层健壮性补强）：单条 `cancelHandoff` 只翻自己那一行的状态，不级联到
 * 它派生出的下游/孙子 handoff（如 pm2 取消时它派发的 executor/reviewer 仍在跑）。
 * `cancel_downstream` 指令注释里说的「级联由 watcher 处理」此前并未实现。本函数
 * 用与 pause/resume-all 相同的递归 session 树遍历，一次性取消整棵子树，避免
 * 「取消了上游、下游还在烧 token」的悬挂执行。
 *
 * 注意：本函数只改 DB 状态（handoff.state='cancelled'）。真正中止正在跑的 LLM
 * 流由调用方在拿到 cancelledHandoffIds / treeSessionIds 后，注入 cancel_signal
 * （team-stream-control gate 会在下个 round 边界响应）+ stopAllInFlightStreamRequests。
 */
export function cancelTeamRuntimeTree(input: {
  rootSessionId: string;
  userId: string;
}): CancelTeamRuntimeTreeResult | null {
  const scope = resolveTeamRuntimeControlScope(input);
  if (!scope) {
    return null;
  }

  const handoffIds = listCancellableHandoffIds({
    sessionIds: scope.treeSessionIds,
    userId: input.userId,
  });
  const cancelledHandoffIds: string[] = [];
  for (const handoffId of handoffIds) {
    if (cancelHandoff({ userId: input.userId, handoffId })) {
      cancelledHandoffIds.push(handoffId);
    }
  }

  return {
    ...scope,
    cancelledHandoffIds,
  };
}

function listCancellableHandoffIds(input: { sessionIds: string[]; userId: string }): string[] {
  if (input.sessionIds.length === 0) {
    return [];
  }

  const placeholders = input.sessionIds.map(() => '?').join(', ');
  const rows = sqliteAll<TeamRuntimeControlHandoffRow>(
    `SELECT id
       FROM handoff_records
      WHERE user_id = ?
        AND state NOT IN ('completed', 'failed', 'cancelled')
        AND (
          from_session_id IN (${placeholders})
          OR to_session_id IN (${placeholders})
        )`,
    [input.userId, ...input.sessionIds, ...input.sessionIds],
  );
  return rows.map((row) => row.id);
}

function listControllableHandoffIds(input: {
  paused: boolean;
  sessionIds: string[];
  userId: string;
}): string[] {
  if (input.sessionIds.length === 0) {
    return [];
  }

  const placeholders = input.sessionIds.map(() => '?').join(', ');
  const rows = sqliteAll<TeamRuntimeControlHandoffRow>(
    `SELECT id
       FROM handoff_records
      WHERE user_id = ?
        AND paused = ?
        AND state NOT IN ('completed', 'failed', 'cancelled')
        AND (
          from_session_id IN (${placeholders})
          OR to_session_id IN (${placeholders})
        )`,
    [input.userId, input.paused ? 1 : 0, ...input.sessionIds, ...input.sessionIds],
  );
  return rows.map((row) => row.id);
}

function oneHourAgoSqliteDateTime(): string {
  return sqliteGet<{ value: string }>(`SELECT datetime('now', '-1 hour') AS value`)?.value ?? '';
}

function selectPausedSessionRows(input: {
  sessionIds: string[];
  userId: string;
}): TeamRuntimeControlSessionRow[] {
  if (input.sessionIds.length === 0) {
    return [];
  }

  return sqliteAll<TeamRuntimeControlSessionRow>(
    `SELECT id, paused, paused_at
       FROM sessions
      WHERE user_id = ?
        AND paused = 1
        AND id IN (${input.sessionIds.map(() => '?').join(', ')})`,
    [input.userId, ...input.sessionIds],
  );
}

function selectSessionIdsByPausedState(input: {
  paused: boolean;
  sessionIds: string[];
  userId: string;
}): string[] {
  if (input.sessionIds.length === 0) {
    return [];
  }

  const rows = sqliteAll<TeamRuntimeControlSessionRow>(
    `SELECT id, paused, paused_at
       FROM sessions
      WHERE user_id = ?
        AND paused = ?
        AND id IN (${input.sessionIds.map(() => '?').join(', ')})`,
    [input.userId, input.paused ? 1 : 0, ...input.sessionIds],
  );
  return rows.map((row) => row.id);
}
