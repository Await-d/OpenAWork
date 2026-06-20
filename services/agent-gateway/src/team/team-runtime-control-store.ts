import { cancelHandoff, pauseHandoff, resumeHandoff } from '../handoff/store/handoff-store.js';
import { sqliteAll, sqliteGet, sqliteRun } from '../infra/db.js';
import { submitInboundMessage } from '../handoff/store/inbound-store.js';

const TEAM_RUNTIME_CONTROL_SESSION_LIMIT = 200;
const TEAM_RUNTIME_CONTROL_MAX_DEPTH = 16;

/**
 * substate 终态集合——这些状态的 session 不需要恢复，直接跳过。
 */
const TERMINAL_SUBSTATES = new Set(['completed', 'failed', 'cancelled']);

/**
 * 需要用户交互才能继续的 substate——不注入 resume_signal，改为写提示消息。
 */
const USER_BLOCKED_SUBSTATES = new Set(['clarifying']);

interface TeamRuntimeControlScopeRow {
  id: string;
  role_layer: string | null;
}

interface TeamRuntimeControlSessionRow {
  id: string;
  paused: number;
  paused_at: string | null;
}

interface TeamRuntimeControlPausedSessionWithSubstateRow {
  id: string;
  paused: number;
  paused_at: string | null;
  role_layer: string | null;
  substate: string | null;
}

interface TeamRuntimeControlHandoffRow {
  id: string;
}

export interface TeamRuntimeControlScope {
  controllableSessionIds: string[];
  depthLimitReached: boolean;
  limitReached: boolean;
  omittedSessionCount: number;
  rootRoleLayer: string | null;
  rootSessionId: string;
  sessionLimit: number;
  sessionMaxDepth: number;
  treeSessionIds: string[];
  truncated: boolean;
}

export interface PauseTeamRuntimeTreeResult extends TeamRuntimeControlScope {
  pausedHandoffIds: string[];
  pausedSessionIds: string[];
}

export interface ResumeTeamRuntimeTreeResult extends TeamRuntimeControlScope {
  resumedHandoffIds: string[];
  resumedSessionIds: string[];
  staleSessionCount: number;
  /** 被跳过的 session（终态或需用户交互） */
  skippedSessionIds: string[];
  /** 因 substate=clarifying 被保持暂停、已写提示消息的 session */
  userBlockedSessionIds: string[];
  /** 分层恢复详情 */
  layerResumeDetails: LayerResumeDetail[];
}

/**
 * 每层的恢复动作分类。
 */
export type LayerResumeAction =
  | 'resumed'          // 正常恢复（注入 resume_signal）
  | 'skipped_terminal' // 终态，无需恢复
  | 'skipped_user_blocked' // clarifying 等需用户交互，保持暂停 + 写提示
  | 'skipped_not_paused';  // 本来就没暂停

export interface LayerResumeDetail {
  sessionId: string;
  roleLayer: string | null;
  substate: string | null;
  action: LayerResumeAction;
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

  const rawTreeRows = sqliteAll<{ depth: number; id: string }>(
    `WITH RECURSIVE session_tree(id, depth, path) AS (
       SELECT id,
              0,
              char(31) || id || char(31)
         FROM sessions
        WHERE id = ? AND user_id = ?
       UNION ALL
       SELECT child.id,
              tree.depth + 1,
              tree.path || child.id || char(31)
         FROM sessions child
         JOIN session_tree tree
           ON child.team_parent_session_id = tree.id
        WHERE child.user_id = ?
          AND tree.depth < ?
          AND instr(tree.path, char(31) || child.id || char(31)) = 0
     )
     SELECT id, MIN(depth) AS depth
       FROM session_tree
      GROUP BY id
      ORDER BY depth ASC, id ASC
     LIMIT ?`,
    [
      input.rootSessionId,
      input.userId,
      input.userId,
      TEAM_RUNTIME_CONTROL_MAX_DEPTH + 1,
      TEAM_RUNTIME_CONTROL_SESSION_LIMIT + 1,
    ],
  );

  const rowsWithinDepth = rawTreeRows.filter((row) => row.depth <= TEAM_RUNTIME_CONTROL_MAX_DEPTH);
  const depthLimitReached = rawTreeRows.some((row) => row.depth > TEAM_RUNTIME_CONTROL_MAX_DEPTH);
  const limitReached = rowsWithinDepth.length > TEAM_RUNTIME_CONTROL_SESSION_LIMIT;
  const includedRows = rowsWithinDepth.slice(0, TEAM_RUNTIME_CONTROL_SESSION_LIMIT);
  const omittedSessionCount =
    Math.max(0, rowsWithinDepth.length - includedRows.length) +
    rawTreeRows.filter((row) => row.depth > TEAM_RUNTIME_CONTROL_MAX_DEPTH).length;
  const treeSessionIds = includedRows.map((row) => row.id);
  const controllableSessionIds =
    root.role_layer === 'reception'
      ? treeSessionIds.filter((sessionId) => sessionId !== input.rootSessionId)
      : treeSessionIds;

  return {
    controllableSessionIds,
    depthLimitReached,
    limitReached,
    omittedSessionCount,
    rootRoleLayer: root.role_layer,
    rootSessionId: input.rootSessionId,
    sessionLimit: TEAM_RUNTIME_CONTROL_SESSION_LIMIT,
    sessionMaxDepth: TEAM_RUNTIME_CONTROL_MAX_DEPTH,
    treeSessionIds,
    truncated: limitReached || depthLimitReached,
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

/**
 * 分层恢复：按 session 的 substate 决定恢复动作。
 *
 * 恢复决策矩阵：
 *   - 终态（completed/failed/cancelled）→ 跳过
 *   - 用户阻塞态（clarifying）→ 保持暂停，写提示消息让用户回答
 *   - 其他非终态 → 正常恢复（unpause + resume_signal）
 *
 * 与旧版区别：不再一刀切地 unpaused 所有 session，而是按 substate 精细控制。
 */
export function resumeTeamRuntimeTree(input: {
  rootSessionId: string;
  userId: string;
}): ResumeTeamRuntimeTreeResult | null {
  const scope = resolveTeamRuntimeControlScope(input);
  if (!scope) {
    return null;
  }

  // ── 收集子树中所有暂停 session 的 substate ────────────────────────
  const pausedSessionRows = selectPausedSessionRowsWithSubstate({
    sessionIds: scope.controllableSessionIds,
    userId: input.userId,
  });

  const resumedSessionIds: string[] = [];
  const skippedSessionIds: string[] = [];
  const userBlockedSessionIds: string[] = [];
  const layerResumeDetails: LayerResumeDetail[] = [];

  for (const row of pausedSessionRows) {
    const substate = row.substate;

    if (substate && TERMINAL_SUBSTATES.has(substate)) {
      // 终态 session：unpause 但不发 resume_signal（它已经结束了）
      skippedSessionIds.push(row.id);
      layerResumeDetails.push({
        sessionId: row.id,
        roleLayer: row.role_layer,
        substate,
        action: 'skipped_terminal',
      });
      // 仍清除 paused 标志，避免界面停在"暂停"态
      sqliteRun(
        `UPDATE sessions
            SET paused = 0,
                paused_at = NULL,
                paused_by_user_id = NULL,
                pause_reason = NULL,
                updated_at = datetime('now')
          WHERE id = ? AND user_id = ? AND paused = 1`,
        [row.id, input.userId],
      );
      continue;
    }

    if (substate && USER_BLOCKED_SUBSTATES.has(substate)) {
      // 用户阻塞态：保持暂停，写提示消息
      userBlockedSessionIds.push(row.id);
      layerResumeDetails.push({
        sessionId: row.id,
        roleLayer: row.role_layer,
        substate,
        action: 'skipped_user_blocked',
      });
      // 不 unpaused，不发 resume_signal
      // 写一条 inbound message 提示用户需要回答澄清问题
      // 使用 clarification_answer 类型：pm1 的 allowedInboundTypes 包含它，
      // 且语义比 user_input 更准确——这是对之前 clarification 请求的回复。
      try {
        submitInboundMessage({
          userId: input.userId,
          toSessionId: row.id,
          fromRoleLayer: 'system',
          messageType: 'clarification_answer',
          payload: {
            text: '用户已恢复团队会话。该会话之前正在等待你的澄清回答，请在对话中回答之前的提问以继续推进。',
            source: 'resume-all-user-blocked-hint',
          },
        });
      } catch (err) {
        console.warn(
          `[resume-tree] 写用户阻塞提示失败（${row.id}）：${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      continue;
    }

    // 正常恢复：unpause + 后续会注入 resume_signal
    resumedSessionIds.push(row.id);
    layerResumeDetails.push({
      sessionId: row.id,
      roleLayer: row.role_layer,
      substate: substate ?? null,
      action: 'resumed',
    });
  }

  // ── 批量 unpaused 正常恢复的 session ──────────────────────────────
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

  // ── stale 统计（暂停超过 1 小时） ─────────────────────────────────
  const staleSessionCount = pausedSessionRows.filter(
    (row) => row.paused_at !== null && row.paused_at < oneHourAgoSqliteDateTime(),
  ).length;

  // ── 恢复暂停的 handoff ────────────────────────────────────────────
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
    skippedSessionIds,
    userBlockedSessionIds,
    layerResumeDetails,
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

function selectPausedSessionRowsWithSubstate(input: {
  sessionIds: string[];
  userId: string;
}): TeamRuntimeControlPausedSessionWithSubstateRow[] {
  if (input.sessionIds.length === 0) {
    return [];
  }

  return sqliteAll<TeamRuntimeControlPausedSessionWithSubstateRow>(
    `SELECT id, paused, paused_at, role_layer, substate
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
