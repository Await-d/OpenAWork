/**
 * stop-child-sessions — 快速停止直系 task 子代理（运行中与暂停等待审批/提问都要覆盖）。
 *
 * 与单任务取消路由（`POST /sessions/:sessionId/tasks/:taskId/cancel`）的区别：
 *   - 按「父会话的直系子会话」批量停止，调用方无需先查任务图；
 *   - 必须同时清空子会话的 pending/deciding 权限与提问，否则暂停中的子会话会在
 *     流已中止后仍停留在 paused（`hasPendingSessionInteraction` 为真）；
 *   - 只处理 `metadata_json.parentSessionId` 直系子会话，不触碰 team 层级子会话。
 *
 * 本模块依赖方向：routes/* 与 tools/* 的既有原语被 `session/` 复用（单向），
 * 避免让 routes/sessions.ts 继续膨胀（该文件已超 1500 行上限）。
 */

import { AgentTaskManagerImpl, type AgentTaskStatus } from '@openAwork/agent-core';
import { sqliteAll, sqliteGet, sqliteRun } from '../infra/db.js';
import { cancelPendingPermissionRequestsForSession } from '../routes/permissions.js';
import { cancelPendingQuestionRequestsForSession } from '../routes/questions.js';
import { stopAnyInFlightStreamRequestForSession } from '../routes/stream-cancellation.js';
import { clearPendingTaskParentAutoResumeForTask } from '../task/task-parent-auto-resume.js';
import { resolveTaskGraphProjectRoot } from '../task/task-graph-root.js';
import { CHILD_SESSION_TERMINAL_REASON_KEY, terminateChildSession } from '../tools/tool-sandbox.js';
import { parseSessionParentId } from './session-descendant-tree.js';
import { reconcileSessionRuntime } from './session-runtime-reconciler.js';
import { parseSessionMetadataJson } from './session-workspace-metadata.js';

export type StopChildSessionSkipReason = 'not_found' | 'not_direct_child' | 'already_terminal';

export interface StopChildSessionsInput {
  parentSessionId: string;
  userId: string;
  childSessionIds?: string[];
  all?: boolean;
}

export interface StopChildSessionsResult {
  stopped: string[];
  skipped: Array<{ childSessionId: string; reason: StopChildSessionSkipReason }>;
  failed: Array<{ childSessionId: string; error: string }>;
  interactions: { permissions: number; questions: number };
}

interface SessionChildRow {
  id: string;
  metadata_json: string;
  state_status: string;
  team_parent_session_id?: string | null;
}

interface ResolvedChildTask {
  graphSessionId: string;
  taskId: string;
  terminal: boolean;
}

function isTerminalTaskStatus(status: AgentTaskStatus): boolean {
  switch (status) {
    case 'completed':
    case 'failed':
    case 'cancelled':
      return true;
    case 'pending':
    case 'running':
    case 'blocked':
      return false;
  }
}

function readParentSessionIds(session: SessionChildRow): string[] {
  const candidateParentIds = [
    parseSessionParentId(session.metadata_json),
    session.team_parent_session_id ?? null,
  ];
  return candidateParentIds.filter(
    (parentSessionId, index): parentSessionId is string =>
      typeof parentSessionId === 'string' &&
      parentSessionId.length > 0 &&
      parentSessionId !== session.id &&
      candidateParentIds.indexOf(parentSessionId) === index,
  );
}

function collectGraphCandidateSessionIds(
  sessionsById: ReadonlyMap<string, SessionChildRow>,
  sessionId: string,
): string[] {
  const collectedSessionIds: string[] = [];
  const visited = new Set<string>();
  const queue = [sessionId];

  while (queue.length > 0) {
    const currentSessionId = queue.shift();
    if (!currentSessionId || visited.has(currentSessionId)) {
      continue;
    }

    visited.add(currentSessionId);
    collectedSessionIds.push(currentSessionId);

    const currentSession = sessionsById.get(currentSessionId);
    if (!currentSession) {
      continue;
    }

    for (const parentSessionId of readParentSessionIds(currentSession)) {
      if (!visited.has(parentSessionId)) {
        queue.push(parentSessionId);
      }
    }
  }

  return collectedSessionIds;
}

async function buildChildTaskIndex(input: {
  directChildIds: ReadonlySet<string>;
  parentSessionId: string;
  sessionsById: ReadonlyMap<string, SessionChildRow>;
}): Promise<Map<string, ResolvedChildTask>> {
  const index = new Map<string, ResolvedChildTask>();
  if (input.directChildIds.size === 0) {
    return index;
  }

  const taskManager = new AgentTaskManagerImpl();
  const graphSessionIds = collectGraphCandidateSessionIds(
    input.sessionsById,
    input.parentSessionId,
  );
  for (const graphSessionId of graphSessionIds) {
    const graph = await taskManager.loadOrCreate(
      resolveTaskGraphProjectRoot(graphSessionId),
      graphSessionId,
    );
    for (const task of Object.values(graph.tasks)) {
      const childSessionId = task.sessionId;
      if (
        !childSessionId ||
        !input.directChildIds.has(childSessionId) ||
        index.has(childSessionId)
      ) {
        continue;
      }

      index.set(childSessionId, {
        graphSessionId,
        taskId: task.id,
        terminal: isTerminalTaskStatus(task.status),
      });
    }
  }

  return index;
}

function resolveStopTargets(input: {
  all: boolean;
  childSessionIds: string[] | undefined;
  directChildIds: ReadonlySet<string>;
  sessionsById: ReadonlyMap<string, SessionChildRow>;
  taskIndex: ReadonlyMap<string, ResolvedChildTask>;
}): { skipped: StopChildSessionsResult['skipped']; targets: string[] } {
  const skipped: StopChildSessionsResult['skipped'] = [];
  const targets: string[] = [];

  if (input.childSessionIds && input.childSessionIds.length > 0) {
    const seen = new Set<string>();
    for (const childSessionId of input.childSessionIds) {
      if (seen.has(childSessionId)) {
        continue;
      }
      seen.add(childSessionId);

      if (!input.sessionsById.has(childSessionId)) {
        skipped.push({ childSessionId, reason: 'not_found' });
        continue;
      }
      if (!input.directChildIds.has(childSessionId)) {
        skipped.push({ childSessionId, reason: 'not_direct_child' });
        continue;
      }

      targets.push(childSessionId);
    }

    return { skipped, targets };
  }

  if (!input.all) {
    return { skipped, targets };
  }

  for (const session of input.sessionsById.values()) {
    if (!input.directChildIds.has(session.id)) {
      continue;
    }

    const task = input.taskIndex.get(session.id);
    if (task && !task.terminal) {
      targets.push(session.id);
      continue;
    }
    if (session.state_status === 'running' || session.state_status === 'paused') {
      targets.push(session.id);
    }
  }

  return { skipped, targets };
}

function writeCancelledChildTerminalReason(input: {
  childSessionId: string;
  userId: string;
}): void {
  const session = sqliteGet<{ metadata_json: string }>(
    'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [input.childSessionId, input.userId],
  );
  if (!session) {
    return;
  }

  const metadata = parseSessionMetadataJson(session.metadata_json);
  metadata[CHILD_SESSION_TERMINAL_REASON_KEY] = 'cancelled';
  sqliteRun(
    "UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [JSON.stringify(metadata), input.childSessionId, input.userId],
  );
}

/**
 * 停止父会话的直系 task 子代理（`metadata_json.parentSessionId === parentSessionId`）。
 *
 * 每个子代理按「清权限 → 清提问 → 终止任务/写终态 → 摘除自动回流条目 → 协调运行时」
 * 顺序处理，单个子代理失败只记入 `failed`，不影响其余子代理与整体响应（永不为
 * per-child 失败抛 5xx）。
 *
 * @returns 聚合结果；父会话不存在或不属于该用户时返回 `null`（路由据此映射 404）。
 */
export async function stopDirectChildSessions(
  input: StopChildSessionsInput,
): Promise<StopChildSessionsResult | null> {
  const parentSession = sqliteGet<{ id: string }>(
    'SELECT id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [input.parentSessionId, input.userId],
  );
  if (!parentSession) {
    return null;
  }

  const sessions = sqliteAll<SessionChildRow>(
    `SELECT id, metadata_json, state_status, team_parent_session_id
     FROM sessions
     WHERE user_id = ?
     ORDER BY created_at ASC, id ASC`,
    [input.userId],
  );
  const sessionsById = new Map(sessions.map((session) => [session.id, session] as const));
  const directChildIds = new Set(
    sessions
      .filter((session) => parseSessionParentId(session.metadata_json) === input.parentSessionId)
      .map((session) => session.id),
  );
  const taskIndex = await buildChildTaskIndex({
    directChildIds,
    parentSessionId: input.parentSessionId,
    sessionsById,
  });
  const { skipped, targets } = resolveStopTargets({
    all: input.all === true,
    childSessionIds: input.childSessionIds,
    directChildIds,
    sessionsById,
    taskIndex,
  });

  const result: StopChildSessionsResult = {
    stopped: [],
    skipped,
    failed: [],
    interactions: { permissions: 0, questions: 0 },
  };

  for (const childSessionId of targets) {
    try {
      const resolvedTask = taskIndex.get(childSessionId);
      if (!resolvedTask) {
        // 无 task 行的子会话没有 terminateChildSession 兜底，必须显式中止在途流，
        // 否则只写终态元数据、子代理仍会继续跑。
        await stopAnyInFlightStreamRequestForSession({
          sessionId: childSessionId,
          userId: input.userId,
        });
        writeCancelledChildTerminalReason({ childSessionId, userId: input.userId });
        result.stopped.push(childSessionId);
      } else if (resolvedTask.terminal) {
        result.skipped.push({ childSessionId, reason: 'already_terminal' });
      } else {
        const termination = await terminateChildSession({
          childSessionId,
          graphSessionId: resolvedTask.graphSessionId,
          reason: 'cancelled',
          taskId: resolvedTask.taskId,
          userId: input.userId,
        });
        if (termination.terminated) {
          result.stopped.push(childSessionId);
        } else {
          result.skipped.push({ childSessionId, reason: 'already_terminal' });
        }
      }

      // 先中止流、后清 pending：反过来会给「停止瞬间新建权限/提问」留窗口，
      // 使子会话在流已中止后仍被 reconcile 掰回 paused。失败时不做部分突变，
      // 子代理保持原状，调用方可重试。
      result.interactions.permissions += cancelPendingPermissionRequestsForSession({
        sessionId: childSessionId,
        userId: input.userId,
      });
      result.interactions.questions += cancelPendingQuestionRequestsForSession({
        sessionId: childSessionId,
        userId: input.userId,
      });

      if (resolvedTask) {
        clearPendingTaskParentAutoResumeForTask({
          parentSessionId: input.parentSessionId,
          userId: input.userId,
          taskId: resolvedTask.taskId,
        });
      }

      await reconcileSessionRuntime({ sessionId: childSessionId, userId: input.userId });
    } catch (error) {
      result.failed.push({ childSessionId, error: String(error) });
    }
  }

  return result;
}
