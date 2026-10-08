import type { RunEvent, SessionContextRecord } from '@openAwork/shared';
import { sqliteGet, sqliteRun } from '../infra/db.js';
import type { SqliteBindableValue } from '../infra/sqlite-bind-params.js';
import { getAnyInFlightStreamRequestForSession } from '../routes/stream-cancellation.js';
import {
  clearSessionRuntimeThread,
  hasFreshSessionRuntimeThread,
} from './session-runtime-thread-store.js';

export type PersistedSessionStateStatus = 'idle' | 'paused' | 'running';

interface CountRow {
  count: number;
}

interface SessionStateRow {
  state_status: string;
}

const DECIDING_INTERACTION_TIMEOUT_SQL = "datetime('now', '-10 minutes')";
export const DECIDING_INTERACTION_TIMEOUT_MS = 10 * 60 * 1000;

export interface SessionRuntimeReconciliationResult {
  previousStatus: PersistedSessionStateStatus | null;
  sessionContext: SessionContextRecord | null;
  status: PersistedSessionStateStatus | null;
  wasReset: boolean;
}

export type SessionInteractionRunEvent = Extract<
  RunEvent,
  {
    type: 'permission_asked' | 'permission_replied' | 'question_asked' | 'question_replied';
  }
>;

export function resolveSessionInteractionStateUpdate(event: SessionInteractionRunEvent): {
  shouldKeepPausedState: boolean;
  status: PersistedSessionStateStatus;
} {
  switch (event.type) {
    case 'permission_asked':
    case 'question_asked': {
      return {
        shouldKeepPausedState: true,
        status: 'paused',
      };
    }
    case 'permission_replied': {
      return {
        shouldKeepPausedState: false,
        status: event.decision === 'reject' ? 'idle' : 'running',
      };
    }
    case 'question_replied': {
      return {
        shouldKeepPausedState: false,
        status: event.status === 'dismissed' ? 'idle' : 'running',
      };
    }
  }
}

export function toSessionContextStatus(
  status: PersistedSessionStateStatus | null,
): SessionContextRecord['status'] {
  if (status === 'running') {
    return 'busy';
  }
  if (status === 'paused') {
    return 'paused';
  }
  return 'idle';
}

export function buildSessionContextRecord(input: {
  clientSurface?: string;
  currentRunId?: string;
  parentSessionId?: string;
  planRef?: string;
  revision?: number;
  rootSessionId?: string;
  sessionId: string;
  status: PersistedSessionStateStatus | null;
  updatedAt?: number;
}): SessionContextRecord {
  return {
    sessionId: input.sessionId,
    ...(input.parentSessionId ? { parentSessionId: input.parentSessionId } : {}),
    ...(input.rootSessionId ? { rootSessionId: input.rootSessionId } : {}),
    status: toSessionContextStatus(input.status),
    ...(input.currentRunId ? { currentRunId: input.currentRunId } : {}),
    ...(input.planRef ? { planRef: input.planRef } : {}),
    ...(input.clientSurface ? { clientSurface: input.clientSurface } : {}),
    revision: input.revision ?? 0,
    updatedAt: input.updatedAt ?? Date.now(),
  };
}

function normalizePersistedSessionStateStatus(value: string): PersistedSessionStateStatus {
  if (value === 'running' || value === 'paused') {
    return value;
  }

  return 'idle';
}

/**
 * 回收「僵尸 deciding」：父代理已 claim 成 `deciding` 却中途崩掉（进程被杀、异常
 * 抛出、连接断开）的请求，超过 10 分钟没人推进就退回 `pending`。
 *
 * 这不是可选的清理，而是**用户可恢复性**的一部分：两个 pending 列表接口
 * （`GET /sessions/:id/permissions/pending`、`…/questions/pending`）的 SQL 都是
 * `status = 'pending'`，不包含 `deciding`。所以一条没被回收的僵尸记录会让会话被判为
 * paused、却让审批浮窗永远空着——用户既看不到待办也走不掉。
 *
 * 代价意识：它**只允许在写路径或按批量的低频路径调用**。历史上它被塞进
 * `hasPendingSessionInteraction`（而后者在 `/sessions` 列表里对每条会话各调一次），
 * 于是「读一次会话列表」会变成 N×2 个写事务去抢 SQLite 写锁——而列表本身被侧栏
 * 30s 轮询一次，是纯放大器。读路径已改为纯读，释放改由这些调用点显式承担：
 *   - `releaseStaleDecidingSessionRecordsForUser`：批量路由入口，一次覆盖该用户全部会话
 *   - pending 列表接口：用户真正要看待办的地方
 *   - `reconcileSessionStateStatus`（默认开启）：启动对账与 remediation 的修复路径
 *   - task 自动决策入口（`task-parent-auto-decision.ts` 自带等价 SQL）
 */
function releaseStaleDecidingRecords(
  table: 'permission_requests' | 'question_requests',
  where: string,
  params: SqliteBindableValue[],
): void {
  sqliteRun(
    `UPDATE ${table}
       SET status = 'pending', updated_at = datetime('now')
     WHERE status = 'deciding' AND updated_at < ${DECIDING_INTERACTION_TIMEOUT_SQL} AND ${where}`,
    params,
  );
}

/**
 * 释放单个会话的僵尸 deciding。
 *
 * **刻意不导出**：它唯一的生产调用方是同文件的 `reconcileSessionStateStatus`（即
 * 「协调」语义本身），导出等于邀请在读路径上顺手调用——而那正是本次要消除的写放大。
 * 批量入口用 `releaseStaleDecidingSessionRecordsForUser`。
 */
function releaseStaleDecidingSessionRecords(sessionId: string): void {
  releaseStaleDecidingRecords('permission_requests', 'session_id = ?', [sessionId]);
  releaseStaleDecidingRecords('question_requests', 'session_id = ?', [sessionId]);
}

/**
 * 一次覆盖该用户**所有**会话的僵尸 deciding——批量路由入口用它把 N 次写降到 2 次。
 *
 * 范围是当前批次的超集，因此语义只更强不会更弱：多释放的那些会话本来就有僵尸，
 * 而它们在客户端 pending 列表里同样不可见。
 */
export function releaseStaleDecidingSessionRecordsForUser(userId: string): void {
  const owned = 'session_id IN (SELECT id FROM sessions WHERE user_id = ?)';
  releaseStaleDecidingRecords('permission_requests', owned, [userId]);
  releaseStaleDecidingRecords('question_requests', owned, [userId]);
}

function countPendingSessionRecords(
  table: 'permission_requests' | 'question_requests',
  sessionId: string,
): number {
  return (
    sqliteGet<CountRow>(
      `SELECT COUNT(1) AS count FROM ${table} WHERE session_id = ? AND status IN ('pending', 'deciding')`,
      [sessionId],
    )?.count ?? 0
  );
}

/**
 * 会话是否存在未处理的交互（权限 / 提问）。
 *
 * **纯读**：判定口径刻意把 `deciding` 也算作未处理（见上），所以调用它之前是否回收过
 * 僵尸 `deciding` 都不影响返回值。这让本函数可以被放进 `/sessions` 列表那种对每条
 * 会话调用一次的读路径，而不必担心写放大。需要修复僵尸状态时，请显式调用上面的
 * `releaseStaleDeciding*`。
 */
export function hasPendingSessionInteraction(sessionId: string): boolean {
  return (
    countPendingSessionRecords('permission_requests', sessionId) > 0 ||
    countPendingSessionRecords('question_requests', sessionId) > 0
  );
}

function resolveLiveSessionStateStatus(
  previousStatus: PersistedSessionStateStatus,
  sessionId: string,
): PersistedSessionStateStatus {
  if (hasPendingSessionInteraction(sessionId)) {
    return 'paused';
  }

  if (previousStatus === 'idle') {
    return 'running';
  }

  return previousStatus;
}

export function reconcileSessionStateStatus(input: {
  nowMs?: number;
  /**
   * 是否顺带回收该会话的僵尸 `deciding`。默认 true——reconcile 本身就是「修正状态」
   * 的语义，启动对账（`reconcileAllSessionRuntimes`）与 remediation 接口都依赖这一步真正
   * 把 `deciding` 改回 `pending`。
   *
   * 批量读路径（`/sessions` 列表、`/recovery`、`/status` 等）必须传 false：它们对子树里
   * 每条会话各调一次 reconcile，在这里回收会把一次列表请求变成 N×2 个写事务。它们改为
   * 在入口调一次 `releaseStaleDecidingSessionRecordsForUser`。
   */
  releaseStaleDeciding?: boolean;
  sessionId: string;
  userId: string;
}): SessionRuntimeReconciliationResult {
  if (input.releaseStaleDeciding !== false) {
    releaseStaleDecidingSessionRecords(input.sessionId);
  }

  const row = sqliteGet<SessionStateRow>(
    'SELECT state_status FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [input.sessionId, input.userId],
  );
  if (!row) {
    return {
      previousStatus: null,
      sessionContext: null,
      status: null,
      wasReset: false,
    };
  }

  const previousStatus = normalizePersistedSessionStateStatus(row.state_status);

  // 说明：子任务取消链路（tool-sandbox.ts:5335-5343）会先写入 state_status='idle'
  // 再中止仍在内存中的流，导致「持久化 idle」与「活跃流」自相矛盾。只要存在在途流或
  // 新鲜的运行时心跳，就以实时状态为准，并在与持久值不一致时立即回写，避免返回过期 idle。
  const hasLiveSignal =
    getAnyInFlightStreamRequestForSession({
      sessionId: input.sessionId,
      userId: input.userId,
    }) !== undefined ||
    hasFreshSessionRuntimeThread({
      nowMs: input.nowMs,
      sessionId: input.sessionId,
      userId: input.userId,
    });

  if (hasLiveSignal) {
    const desiredStatus = resolveLiveSessionStateStatus(previousStatus, input.sessionId);
    if (desiredStatus !== previousStatus) {
      sqliteRun(
        "UPDATE sessions SET state_status = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
        [desiredStatus, input.sessionId, input.userId],
      );
    }

    return {
      previousStatus,
      sessionContext: buildSessionContextRecord({
        sessionId: input.sessionId,
        status: desiredStatus,
      }),
      status: desiredStatus,
      wasReset: false,
    };
  }

  if (hasPendingSessionInteraction(input.sessionId)) {
    clearSessionRuntimeThread({ sessionId: input.sessionId, userId: input.userId });
    if (previousStatus !== 'paused') {
      sqliteRun(
        "UPDATE sessions SET state_status = 'paused', updated_at = datetime('now') WHERE id = ? AND user_id = ?",
        [input.sessionId, input.userId],
      );
    }

    return {
      previousStatus,
      sessionContext: buildSessionContextRecord({ sessionId: input.sessionId, status: 'paused' }),
      status: 'paused',
      wasReset: false,
    };
  }

  if (previousStatus === 'idle') {
    clearSessionRuntimeThread({ sessionId: input.sessionId, userId: input.userId });
    return {
      previousStatus,
      sessionContext: buildSessionContextRecord({
        sessionId: input.sessionId,
        status: previousStatus,
      }),
      status: previousStatus,
      wasReset: false,
    };
  }

  clearSessionRuntimeThread({ sessionId: input.sessionId, userId: input.userId });
  sqliteRun(
    "UPDATE sessions SET state_status = 'idle', updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [input.sessionId, input.userId],
  );
  return {
    previousStatus,
    sessionContext: buildSessionContextRecord({ sessionId: input.sessionId, status: 'idle' }),
    status: 'idle',
    wasReset: true,
  };
}
