import type { Session, SessionTask } from '@openAwork/web-client';
import { resolveSubagentSessionIdFromToolOutput } from '@openAwork/shared-ui';

export type TaskToolRuntimeStatus =
  'pending' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled';

export interface TaskToolRuntimeSnapshot {
  assignedAgent?: string;
  errorMessage?: string;
  result?: string;
  sessionId?: string;
  status: TaskToolRuntimeStatus;
  taskId: string;
  timeoutSource?: SessionTask['timeoutSource'];
  terminalReason?: SessionTask['terminalReason'];
  title: string;
  updatedAt: number;
}

export interface TaskToolRuntimeLookup {
  bySessionId: Map<string, TaskToolRuntimeSnapshot>;
  byTaskId: Map<string, TaskToolRuntimeSnapshot>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function mapTaskStatusToRuntimeStatus(
  taskStatus: SessionTask['status'],
  sessionStateStatus: Session['state_status'] | undefined,
): TaskToolRuntimeStatus {
  if (taskStatus === 'completed') {
    return 'done';
  }

  if (taskStatus === 'failed') {
    return 'failed';
  }

  if (taskStatus === 'cancelled') {
    return 'cancelled';
  }

  if (sessionStateStatus === 'paused') {
    return 'paused';
  }

  if (taskStatus === 'running') {
    return 'running';
  }

  return 'pending';
}

/**
 * 影响 lookup 内容的全部输入签名。
 *
 * 只覆盖真正参与 snapshot 构造的字段：子会话只贡献 `state_status`（用于把
 * running 细化为 paused），其余字段变化不应让 lookup 换引用。
 */
function buildLookupSignature(
  childSessions: readonly Session[],
  sessionTasks: readonly SessionTask[],
): string {
  const childStateById = childSessions
    .map((session) => `${session.id}=${session.state_status ?? ''}`)
    .sort((left, right) => left.localeCompare(right, 'en-US'))
    .join(',');
  const taskPart = sessionTasks
    .map((task) =>
      [
        task.id,
        task.sessionId ?? '',
        task.status,
        task.assignedAgent ?? '',
        task.errorMessage ?? '',
        task.result ?? '',
        task.timeoutSource ?? '',
        task.terminalReason ?? '',
        task.title,
        task.updatedAt,
      ].join(''),
    )
    .sort((left, right) => left.localeCompare(right, 'en-US'))
    .join('');
  return `${childStateById}${taskPart}`;
}

let lastLookupSignature: string | null = null;
let lastLookup: TaskToolRuntimeLookup | null = null;

/**
 * 构造子代理任务运行时查找表。
 *
 * 返回值被 `renderContent` 闭包捕获并进入 `useChatRenderData` 的 memo 依赖，
 * 因此**引用稳定性直接决定消息列表是否重渲染**。会话运行时快照每 3s 轮询一次、
 * `loadCurrentSessionSnapshot` 也会直接写入 `childSessions` / `sessionTasks`，
 * 若每次都返回新对象，即使内容完全一致也会击穿所有 `ChatGroupBlock` 的
 * `React.memo`。这里按内容签名缓存上一次结果。
 */
export function buildTaskToolRuntimeLookup(
  childSessions: Session[],
  sessionTasks: SessionTask[],
): TaskToolRuntimeLookup {
  const signature = buildLookupSignature(childSessions, sessionTasks);
  if (lastLookup !== null && lastLookupSignature === signature) {
    return lastLookup;
  }

  const childSessionsById = new Map(childSessions.map((session) => [session.id, session]));
  const byTaskId = new Map<string, TaskToolRuntimeSnapshot>();
  const bySessionId = new Map<string, TaskToolRuntimeSnapshot>();

  for (const task of sessionTasks) {
    const childSession = task.sessionId ? childSessionsById.get(task.sessionId) : undefined;
    const snapshot: TaskToolRuntimeSnapshot = {
      assignedAgent: task.assignedAgent,
      errorMessage: task.errorMessage,
      result: task.result,
      sessionId: task.sessionId,
      status: mapTaskStatusToRuntimeStatus(task.status, childSession?.state_status),
      taskId: task.id,
      timeoutSource: task.timeoutSource,
      terminalReason: task.terminalReason,
      title: task.title,
      updatedAt: task.updatedAt,
    };

    byTaskId.set(task.id, snapshot);
    if (task.sessionId) {
      bySessionId.set(task.sessionId, snapshot);
    }
  }

  lastLookup = { bySessionId, byTaskId };
  lastLookupSignature = signature;
  return lastLookup;
}

export function resolveTaskToolRuntimeSnapshot(
  input: Record<string, unknown>,
  output: unknown,
  lookup: TaskToolRuntimeLookup | undefined,
): TaskToolRuntimeSnapshot | undefined {
  if (!lookup) {
    return undefined;
  }

  const outputRecord = asRecord(output);
  const candidateTaskIds = [
    readString(input['task_id']),
    readString(outputRecord?.['taskId']),
  ].filter((value): value is string => Boolean(value));

  for (const candidateTaskId of candidateTaskIds) {
    const snapshot = lookup.byTaskId.get(candidateTaskId);
    if (snapshot) {
      return snapshot;
    }
  }

  // 子会话 id 的解析顺序：输出对象字段 → 文本输出（`<subagent sessionID>` /
  // 「会话 ID：」两种网关文本形态）→ 输入侧 resume 目标（`session_id` /
  // 上游别名 `sessionID`）。任一步命中都允许卡片直接打开对应子代理预览。
  const candidateSessionIds = [
    readString(outputRecord?.['sessionId']),
    resolveSubagentSessionIdFromToolOutput(output),
    readString(input['session_id']),
    readString(input['sessionID']),
  ].filter((value): value is string => Boolean(value));

  for (const candidateSessionId of candidateSessionIds) {
    const snapshot = lookup.bySessionId.get(candidateSessionId);
    if (snapshot) {
      return snapshot;
    }
  }

  return undefined;
}

export function buildTerminalTaskSyncMarker(sessionTasks: SessionTask[]): string {
  return sessionTasks
    .filter(
      (task) =>
        task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled',
    )
    .sort((left, right) => left.id.localeCompare(right.id, 'en-US'))
    .map((task) =>
      [task.id, task.status, task.updatedAt, task.result ?? '', task.errorMessage ?? ''].join(':'),
    )
    .join('|');
}
