import { createPermissionsClient, createSessionsClient } from '@openAwork/web-client';
import type {
  PendingPermissionRequest,
  Session,
  SessionTask,
  SessionTodo,
  SessionTodoLanes,
} from '@openAwork/web-client';
export { toSessionPendingPermissionState } from '../../../utils/permission/pending-permission-state.js';

type AbortableSessionsClient = ReturnType<typeof createSessionsClient> & {
  getChildren: (
    token: string,
    sessionId: string,
    options?: { signal?: AbortSignal },
  ) => Promise<Session[]>;
  getTodoLanes: (
    token: string,
    sessionId: string,
    options?: { signal?: AbortSignal },
  ) => Promise<SessionTodoLanes>;
  getTasks: (
    token: string,
    sessionId: string,
    options?: { signal?: AbortSignal },
  ) => Promise<SessionTask[]>;
};

type AbortablePermissionsClient = ReturnType<typeof createPermissionsClient> & {
  listPending: (
    token: string,
    sessionId: string,
    options?: { signal?: AbortSignal },
  ) => Promise<PendingPermissionRequest[]>;
};

export type SessionTodoItem = SessionTodo;
export type SessionStateStatus = Session['state_status'];

export interface SessionRuntimeSnapshot {
  childrenResult: PromiseSettledResult<Session[]>;
  pendingPermissionsResult: PromiseSettledResult<PendingPermissionRequest[]>;
  tasksResult: PromiseSettledResult<SessionTask[]>;
  todoLanesResult: PromiseSettledResult<SessionTodoLanes>;
}

export async function fetchSessionRuntimeSnapshot(options: {
  gatewayUrl: string;
  sessionId: string;
  signal?: AbortSignal;
  token: string;
}): Promise<SessionRuntimeSnapshot> {
  const sessionsClient = createSessionsClient(options.gatewayUrl) as AbortableSessionsClient;
  const permissionsClient = createPermissionsClient(
    options.gatewayUrl,
  ) as AbortablePermissionsClient;
  const [todoLanesResult, childrenResult, tasksResult, currentPendingPermissionsResult] =
    await Promise.allSettled([
      sessionsClient.getTodoLanes(options.token, options.sessionId, { signal: options.signal }),
      sessionsClient.getChildren(options.token, options.sessionId, { signal: options.signal }),
      sessionsClient.getTasks(options.token, options.sessionId, { signal: options.signal }),
      permissionsClient.listPending(options.token, options.sessionId, { signal: options.signal }),
    ]);

  const childPermissionResults =
    childrenResult.status === 'fulfilled'
      ? await Promise.allSettled(
          childrenResult.value.map((childSession) =>
            permissionsClient.listPending(options.token, childSession.id, {
              signal: options.signal,
            }),
          ),
        )
      : [];

  const fulfilledPermissionBuckets = [
    currentPendingPermissionsResult,
    ...childPermissionResults,
  ].flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
  const pendingPermissionsResult: PromiseSettledResult<PendingPermissionRequest[]> =
    fulfilledPermissionBuckets.length > 0
      ? {
          status: 'fulfilled',
          value: fulfilledPermissionBuckets.flat().sort((left, right) => {
            if (left.status !== right.status) {
              return left.status === 'pending' ? -1 : 1;
            }

            if (left.sessionId !== right.sessionId) {
              return left.sessionId.localeCompare(right.sessionId, 'en-US');
            }

            return left.createdAt.localeCompare(right.createdAt, 'en-US');
          }),
        }
      : currentPendingPermissionsResult;

  return {
    childrenResult,
    pendingPermissionsResult,
    tasksResult,
    todoLanesResult,
  };
}

/**
 * 轮询快照的引用稳定化。
 *
 * 会话运行时快照每 3s 拉一次，但绝大多数拍的内容与上一拍完全一致。合并函数
 * 若无条件返回新数组/新对象，React 只认 `Object.is`，于是每拍都会：
 *   1. 触发 ChatPage 整体重渲染；
 *   2. 让 `taskToolRuntimeLookup` 换新引用，进而击穿消息列表里所有
 *      `ChatGroupBlock` 的 `React.memo`（空闲会话也在每 3s 重渲染整张列表）。
 *
 * 下面的辅助函数把「内容等价」折叠成「引用相同」，使无变化的拍次对下游完全透明。
 */
function shallowEqualRecord(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) {
    return false;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  if (leftKeys.length !== Object.keys(rightRecord).length) {
    return false;
  }
  return leftKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(rightRecord, key) &&
      Object.is(leftRecord[key], rightRecord[key]),
  );
}

/**
 * 逐项复用 previous 中「语义未变」的引用：命中判定返回 false 时仍保守地返回
 * `next`，因此这是纯优化，不改变任何输出语义。
 */
function reuseStableItems<T>(
  previous: readonly T[],
  next: readonly T[],
  isSame: (a: T, b: T) => boolean,
): T[] {
  const reused: T[] = next.map((nextItem, index) => {
    const previousItem = previous[index];
    return previousItem !== undefined && isSame(previousItem, nextItem) ? previousItem : nextItem;
  });

  // 只有当每一项都复用了 previous 的引用时才整体沿用旧数组；否则返回逐项复用后的
  // 新数组。`Object.is` 与 React 的 state 判定一致，因此「返回 previous」能让
  // setState 直接短路，不触发重渲染。
  for (let index = 0; index < reused.length; index += 1) {
    if (!Object.is(reused[index], previous[index])) {
      return reused;
    }
  }
  return previous as T[];
}

/**
 * 子会话「无变化」判定。
 *
 * 必须显式比对 `state_status` 与 `title`，不能只看 `updatedAt`：
 * - 网关写 `state_status` 时确实同步写 `updated_at`（12 条 UPDATE 全部带
 *   `datetime('now')`），但那是**秒级精度**——同一秒内 `running → paused` 时
 *   字符串不变，只看时间戳会漏掉这次状态翻转；
 * - `routes/sessions.ts` 与 `session-shared-read-routes.ts` 的读路径还有一层内存兜底，
 *   查不到 DB 行时直接返回 `{...session, state_status}` 而不动时间戳；
 * - 两者都被 `sub-agent-status` / `sub-agent-run-list` / `sub-session-detail-panel` 渲染。
 */
function isSameSessionRevision(left: Session, right: Session): boolean {
  return (
    left.id === right.id &&
    left.state_status === right.state_status &&
    left.title === right.title &&
    left.substate === right.substate &&
    left.role_layer === right.role_layer &&
    left.updatedAt === right.updatedAt
  );
}

/**
 * 任务「无变化」判定。
 *
 * `completedSubtaskCount` / `readySubtaskCount` / `unmetDependencyCount` 是
 * **读时派生值**（`session-task-projection.ts` 由子任务状态实时计算），子任务状态
 * 变化只 bump 子任务自己的 `updatedAt`，父任务的 `status` 与 `updatedAt` 都不变。
 * 因此这三个计数必须参与判定，否则右栏任务计数会永久停在旧值。
 */
function isSameSessionTaskRevision(left: SessionTask, right: SessionTask): boolean {
  return (
    left.id === right.id &&
    left.status === right.status &&
    left.title === right.title &&
    left.result === right.result &&
    left.errorMessage === right.errorMessage &&
    left.terminalReason === right.terminalReason &&
    left.timeoutSource === right.timeoutSource &&
    left.assignedAgent === right.assignedAgent &&
    left.completedAt === right.completedAt &&
    left.startedAt === right.startedAt &&
    left.completedSubtaskCount === right.completedSubtaskCount &&
    left.readySubtaskCount === right.readySubtaskCount &&
    left.unmetDependencyCount === right.unmetDependencyCount &&
    left.subtaskCount === right.subtaskCount &&
    left.updatedAt === right.updatedAt
  );
}

function isSameSessionTodo(left: SessionTodoItem, right: SessionTodoItem): boolean {
  return shallowEqualRecord(left, right);
}

export function mergeChildSessions(previous: Session[], next: Session[]): Session[] {
  const merged = new Map<string, Session>();
  next.forEach((session) => {
    merged.set(session.id, session);
  });
  previous.forEach((session) => {
    if (!merged.has(session.id)) {
      merged.set(session.id, session);
    }
  });
  return reuseStableItems(previous, Array.from(merged.values()), isSameSessionRevision);
}

export function mergeSessionTasks(previous: SessionTask[], next: SessionTask[]): SessionTask[] {
  const statusRank = (status: SessionTask['status']): number => {
    if (status === 'completed') return 5;
    if (status === 'failed') return 4;
    if (status === 'cancelled') return 3;
    if (status === 'running') return 2;
    return 1;
  };

  const merged = new Map<string, SessionTask>();
  next.forEach((task) => {
    merged.set(task.id, task);
  });
  previous.forEach((task) => {
    const current = merged.get(task.id);
    if (!current) {
      merged.set(task.id, task);
      return;
    }

    const shouldKeepPrevious =
      statusRank(task.status) > statusRank(current.status) ||
      (statusRank(task.status) === statusRank(current.status) &&
        task.updatedAt > current.updatedAt);

    if (shouldKeepPrevious) {
      merged.set(task.id, { ...current, ...task });
    }
  });
  return reuseStableItems(previous, Array.from(merged.values()), isSameSessionTaskRevision);
}

export function hasActiveSessionTasks(tasks: SessionTask[]): boolean {
  return tasks.some((task) => task.status === 'pending' || task.status === 'running');
}

export function shouldPollSessionRuntime(options: {
  pendingPermissions: PendingPermissionRequest[];
  sessionStateStatus: SessionStateStatus | null;
  sessionTasks: SessionTask[];
  streaming: boolean;
}): boolean {
  return (
    options.streaming ||
    options.sessionStateStatus === 'paused' ||
    options.sessionStateStatus === 'running' ||
    hasActiveSessionTasks(options.sessionTasks) ||
    options.pendingPermissions.some((permission) => permission.status === 'pending')
  );
}

export type SessionStopCapability = 'none' | 'precise' | 'best_effort' | 'observe_only';

/**
 * 主操作按钮的停止能力判定（chat 页的唯一裁决处）。
 *
 * 关键不变量：等待审批 / 等待回答的暂停（`remoteSessionBusyState === 'paused'`）
 * 一律返回 `'none'`——主按钮必须呈现专属等待态（「待处理」+ 时钟图标），不能
 * 退化成停止按钮，否则用户会误以为会话已停止。暂停时若想取消本次运行，走审批卡 /
 * 问题面板的拒绝入口，而不是把停止按钮当作默认动作。
 */
export function resolveSessionStopCapability(input: {
  canStopCurrentSessionStream: boolean;
  currentSessionId: string | null;
  remoteSessionBusyState: 'running' | 'paused' | null;
  sessionStateStatus: SessionStateStatus | null | undefined;
  streaming: boolean;
}): SessionStopCapability {
  if (input.streaming || input.canStopCurrentSessionStream) {
    return 'precise';
  }

  // 待审批 / 待回答优先于 status：`remoteSessionBusyState === 'paused'` 既覆盖
  // 「网关状态 paused」也覆盖「仍有 pending 交互」——后者可能伴随 status 仍是
  // running 的瞬态（如批量审批续跑中）。此时会话的主状态必须与状态条
  // 「等待审批 / 等待回答」保持一致，不能退化成停止按钮。
  if (input.remoteSessionBusyState === 'paused') {
    return 'none';
  }

  if (input.currentSessionId && input.sessionStateStatus === 'running') {
    return 'best_effort';
  }

  if (input.remoteSessionBusyState !== null) {
    return 'observe_only';
  }

  return 'none';
}

export function flattenSessionTodoLanes(todoLanes: SessionTodoLanes): SessionTodoItem[] {
  return [
    ...todoLanes.main.map((todo) => ({ ...todo, lane: 'main' as const })),
    ...todoLanes.temp.map((todo) => ({ ...todo, lane: 'temp' as const })),
  ];
}

/**
 * `flattenSessionTodoLanes` 的引用稳定化版本：待办无变化时返回 `previous`。
 * 待办列表是 3s 轮询的一部分，无条件造新对象会让 ChatPage 每拍重渲染。
 */
export function mergeSessionTodoLanes(
  previous: SessionTodoItem[],
  todoLanes: SessionTodoLanes,
): SessionTodoItem[] {
  return reuseStableItems(previous, flattenSessionTodoLanes(todoLanes), isSameSessionTodo);
}

/**
 * 深度等价（结构化比较），用于嵌套快照字段。
 *
 * `WorkflowRuntimeState` 的 `activePlan` / `activeLoop` / `evidence` 都是对象，
 * 每拍重新构造 → 浅比较永远判不等，这里对它们才有意义。轮询频率低（3s）且
 * 载荷是个位数字段的配置快照，深比较的成本可忽略。
 *
 * 深度等价 ⟹ 渲染结果相同，因此**不会**漏更新；数组顺序敏感（`artifactRefs` 这类
 * 列表的顺序本身参与渲染）。
 */
function deepEqualRecord(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  const leftIsArray = Array.isArray(left);
  const rightIsArray = Array.isArray(right);
  if (leftIsArray || rightIsArray) {
    if (!leftIsArray || !rightIsArray) {
      return false;
    }
    if (left.length !== right.length) {
      return false;
    }
    // 显式循环而非 `every`：递归比较用 early-return 表达更直接，也避免在
    // 回调里嵌套短路调用。
    for (let index = 0; index < left.length; index += 1) {
      if (!deepEqualRecord(left[index], right[index])) {
        return false;
      }
    }
    return true;
  }

  if (left === null || right === null) {
    return false;
  }
  if (typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }

  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) {
    return false;
  }
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) {
      return false;
    }
    const leftValue = (left as Record<string, unknown>)[key];
    const rightValue = (right as Record<string, unknown>)[key];
    if (!deepEqualRecord(leftValue, rightValue)) {
      return false;
    }
  }
  return true;
}

/**
 * 值等则沿用 `previous` 引用的 setter 包装器。用于轮询里那些「结构相同但每拍
 * 都是新对象」的快照字段（活跃流、工作流运行时、待审批/待回答列表等）——
 * 引用不变即不会触发重渲染，也避免把不稳定的对象引用喂进依赖它的 effect。
 *
 * 默认按深度等价判定：这些字段都是配置/状态快照（结构化数据），浅比较要么永远
 * 判不等（嵌套对象）、要么漏掉嵌套字段变化，是错误的默认。
 */
export function preserveEqualValue<T>(
  previous: T,
  next: T,
  isEqual: (left: T, right: T) => boolean = deepEqualRecord as (left: T, right: T) => boolean,
): T {
  return isEqual(previous, next) ? previous : next;
}

export function preserveEqualList<T>(
  previous: readonly T[],
  next: readonly T[],
  isEqual: (left: T, right: T) => boolean = deepEqualRecord as (left: T, right: T) => boolean,
): T[] {
  return reuseStableItems(previous, next, isEqual);
}
