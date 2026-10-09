/**
 * 子会话生命周期域(261009-tool-sandbox 拆分 P1 / T-05)。
 *
 * 由 `tool-sandbox.ts` 原样搬出,行为不变:子会话终态标记、首响应超时、
 * 父工具结果同步、任务更新事件与统一终止入口 `terminateChildSession`。
 *
 * 依赖方向:`tool-sandbox.ts` → 本模块(单向)。本模块**不**反向导入门面,
 * 因此不存在循环依赖;常量与类型由本模块定义并对外导出。
 */
import { AgentTaskManagerImpl } from '@openAwork/agent-core';
import type { RunEvent } from '@openAwork/shared';
import { sqliteGet, sqliteRun } from '../../infra/db.js';
import {
  appendSessionMessageV2 as appendSessionMessage,
  deleteSessionMessagesByRequestScope,
} from '../../message/message-v2-adapter.js';
import {
  DEFAULT_UPSTREAM_RETRY_MAX_RETRIES,
  normalizeUpstreamRetryMaxRetries,
  UPSTREAM_RETRY_MAX_RETRIES_KEY,
} from '../../provider/upstream-retry-policy.js';
import { stopAnyInFlightStreamRequestForSession } from '../../routes/stream-cancellation.js';
import { deleteRequestFileDiffs } from '../../session/session-file-diff-store.js';
import {
  deleteSessionRunEventsByRequest,
  publishSessionRunEvent,
} from '../../session/session-run-events.js';
import { deleteRequestSnapshots } from '../../session/session-snapshot-store.js';
import { parseSessionMetadataJson } from '../../session/session-workspace-metadata.js';
import { buildTaskToolTerminalMessage } from '../../task/delegated-task-display.js';
import { resolveTaskGraphProjectRoot } from '../../task/task-graph-root.js';
import { buildTaskJobNotificationId, deliverTaskCompletion } from '../../task/task-job-delivery.js';
import { settle as settleTaskJob } from '../../task/task-job.js';
import { buildToolResultContent, buildToolResultRunEvent } from '../tool-result-contract.js';

export type TaskToolOutputStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

/** Terminal reason written to child session metadata and propagated through events. */
export type ChildSessionTerminalReason = 'timeout' | 'cancelled';

/** The only timeout source still emitted automatically by the current runtime. */
export type ChildSessionTimeoutSource = 'first_response';

export const CHILD_SESSION_TERMINAL_REASON_KEY = 'terminalReason';
const CHILD_SESSION_TIMEOUT_SOURCE_KEY = 'timeoutSource';
const DEFAULT_TASK_CHILD_FIRST_RESPONSE_TIMEOUT_MS = 30_000;

export interface TaskParentToolReference {
  clientRequestId: string;
  toolCallId: string;
}

export const TASK_PARENT_TOOL_CALL_ID_KEY = 'taskParentToolCallId';
export const TASK_PARENT_TOOL_REQUEST_ID_KEY = 'taskParentToolRequestId';

export async function loadTaskGraphForSession(
  taskManager: AgentTaskManagerImpl,
  graphSessionId: string,
) {
  return taskManager.loadOrCreate(resolveTaskGraphProjectRoot(graphSessionId), graphSessionId);
}

export function readChildSessionTerminalReason(
  metadata: Record<string, unknown>,
): ChildSessionTerminalReason | undefined {
  const value = metadata[CHILD_SESSION_TERMINAL_REASON_KEY];
  return value === 'timeout' || value === 'cancelled' ? value : undefined;
}

export function readChildSessionTimeoutSource(
  metadata: Record<string, unknown>,
): ChildSessionTimeoutSource | undefined {
  const value = metadata[CHILD_SESSION_TIMEOUT_SOURCE_KEY];
  return value === 'first_response' ? value : undefined;
}

export function writeChildSessionTerminalReason(input: {
  childSessionId: string;
  reason: ChildSessionTerminalReason;
  timeoutSource?: ChildSessionTimeoutSource;
  userId: string;
}): void {
  const childSession = sqliteGet<{ metadata_json: string }>(
    'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [input.childSessionId, input.userId],
  );
  const childMetadata = childSession ? parseSessionMetadataJson(childSession.metadata_json) : {};
  childMetadata[CHILD_SESSION_TERMINAL_REASON_KEY] = input.reason;
  if (input.reason === 'timeout') {
    if (input.timeoutSource) {
      childMetadata[CHILD_SESSION_TIMEOUT_SOURCE_KEY] = input.timeoutSource;
    }
  } else {
    delete childMetadata[CHILD_SESSION_TIMEOUT_SOURCE_KEY];
  }
  sqliteRun(
    "UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [JSON.stringify(childMetadata), input.childSessionId, input.userId],
  );
}

export function getTaskChildFirstResponseTimeoutMs(): number {
  const raw = process.env.OPENAWORK_TASK_CHILD_FIRST_RESPONSE_TIMEOUT_MS;
  if (!raw) {
    return DEFAULT_TASK_CHILD_FIRST_RESPONSE_TIMEOUT_MS;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TASK_CHILD_FIRST_RESPONSE_TIMEOUT_MS;
  }

  return Math.floor(parsed);
}

export function getTaskChildFirstResponseRetryMaxRetries(
  requestData: Record<string, unknown>,
): number {
  return (
    normalizeUpstreamRetryMaxRetries(requestData[UPSTREAM_RETRY_MAX_RETRIES_KEY]) ??
    DEFAULT_UPSTREAM_RETRY_MAX_RETRIES
  );
}

export function isChildSessionFirstResponseEvent(
  _event: RunEvent,
  timedOut: boolean,
  alreadyReceived: boolean,
): boolean {
  if (timedOut || alreadyReceived) {
    return false;
  }

  // task_update may be the first visible sign that a delegated child is actively
  // progressing through nested work. Treat it as first activity so nested task
  // execution does not trip the child response timeout prematurely.
  return true;
}

export function clearTimedOutChildSessionAttemptArtifacts(input: {
  childSessionId: string;
  clientRequestId?: string;
  userId: string;
}): void {
  if (!input.clientRequestId) {
    return;
  }

  deleteSessionMessagesByRequestScope({
    clientRequestId: input.clientRequestId,
    roles: ['assistant', 'tool', 'synthetic'],
    sessionId: input.childSessionId,
    userId: input.userId,
  });
  deleteRequestFileDiffs({
    clientRequestId: input.clientRequestId,
    sessionId: input.childSessionId,
    userId: input.userId,
  });
  deleteRequestSnapshots({
    clientRequestId: input.clientRequestId,
    sessionId: input.childSessionId,
    userId: input.userId,
  });
  deleteSessionRunEventsByRequest({
    sessionId: input.childSessionId,
    clientRequestId: input.clientRequestId,
  });
}

export function readTaskRequestedSkills(metadata: Record<string, unknown>): string[] | undefined {
  const candidate = metadata.requestedSkills;
  if (!Array.isArray(candidate)) {
    return undefined;
  }

  const skills = candidate.filter((value): value is string => typeof value === 'string');
  return skills.length > 0 ? skills : undefined;
}

export function readTaskParentToolReference(
  metadata: Record<string, unknown>,
): TaskParentToolReference | undefined {
  const clientRequestId = metadata[TASK_PARENT_TOOL_REQUEST_ID_KEY];
  const toolCallId = metadata[TASK_PARENT_TOOL_CALL_ID_KEY];
  if (typeof clientRequestId !== 'string' || typeof toolCallId !== 'string') {
    return undefined;
  }

  return { clientRequestId, toolCallId };
}

export function clearTaskParentToolReference(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  if (
    !(TASK_PARENT_TOOL_REQUEST_ID_KEY in metadata) &&
    !(TASK_PARENT_TOOL_CALL_ID_KEY in metadata)
  ) {
    return metadata;
  }

  const nextMetadata = { ...metadata };
  delete nextMetadata[TASK_PARENT_TOOL_REQUEST_ID_KEY];
  delete nextMetadata[TASK_PARENT_TOOL_CALL_ID_KEY];
  return nextMetadata;
}

export function mapTaskStatusToToolOutputStatus(status: string): TaskToolOutputStatus {
  switch (status) {
    case 'running':
      return 'running';
    case 'completed':
      return 'done';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'pending';
  }
}

function createTaskToolResultClientRequestId(clientRequestId: string, toolCallId: string): string {
  return `${clientRequestId}:tool:${toolCallId}`;
}

export function buildTaskToolOutput(input: {
  assignedAgent: string;
  category?: string;
  errorMessage?: string;
  message?: string;
  reason?: string;
  requestedSkills?: string[];
  result?: string;
  sessionId: string;
  status: TaskToolOutputStatus;
  taskId: string;
  timeoutSource?: ChildSessionTimeoutSource;
}) {
  return {
    taskId: input.taskId,
    sessionId: input.sessionId,
    status: input.status,
    assignedAgent: input.assignedAgent,
    ...(input.category ? { category: input.category } : {}),
    ...(input.requestedSkills && input.requestedSkills.length > 0
      ? { requestedSkills: input.requestedSkills }
      : {}),
    ...(input.result ? { result: input.result } : {}),
    ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
    ...(input.message ? { message: input.message } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.timeoutSource ? { timeoutSource: input.timeoutSource } : {}),
  };
}

export function syncParentTaskToolResult(input: {
  assignedAgent: string;
  category?: string;
  errorMessage?: string;
  parentSessionId: string;
  parentToolReference?: TaskParentToolReference;
  reason?: string;
  requestedSkills?: string[];
  result?: string;
  sessionId: string;
  status: TaskToolOutputStatus;
  taskId: string;
  timeoutSource?: ChildSessionTimeoutSource;
  userId: string;
}): void {
  if (!input.parentToolReference) {
    return;
  }

  const parentSession = sqliteGet<{ id: string }>(
    'SELECT id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [input.parentSessionId, input.userId],
  );
  if (!parentSession) {
    return;
  }

  const terminalMessage =
    input.status === 'done' || input.status === 'failed' || input.status === 'cancelled'
      ? buildTaskToolTerminalMessage({
          agent: input.assignedAgent,
          category: input.category,
          errorMessage: input.errorMessage,
          resultText: input.result,
          sessionId: input.sessionId,
          status: input.status,
        })
      : undefined;

  const output = buildTaskToolOutput({
    assignedAgent: input.assignedAgent,
    category: input.category,
    errorMessage: input.errorMessage,
    ...(terminalMessage ? { message: terminalMessage } : {}),
    reason: input.reason,
    requestedSkills: input.requestedSkills,
    result: input.result,
    sessionId: input.sessionId,
    status: input.status,
    taskId: input.taskId,
    timeoutSource: input.timeoutSource,
  });
  const parentToolResultClientRequestId = createTaskToolResultClientRequestId(
    input.parentToolReference.clientRequestId,
    input.parentToolReference.toolCallId,
  );
  appendSessionMessage({
    sessionId: input.parentSessionId,
    userId: input.userId,
    role: 'tool',
    content: [
      buildToolResultContent({
        toolCallId: input.parentToolReference.toolCallId,
        toolName: 'task',
        sessionId: input.parentSessionId,
        clientRequestId: parentToolResultClientRequestId,
        output,
        isError: input.status === 'failed',
        reason: input.reason,
      }),
    ],
    clientRequestId: parentToolResultClientRequestId,
    replaceExisting: true,
  });
  publishSessionRunEvent(
    input.parentSessionId,
    buildToolResultRunEvent({
      toolCallId: input.parentToolReference.toolCallId,
      toolName: 'task',
      clientRequestId: parentToolResultClientRequestId,
      output,
      isError: input.status === 'failed',
      reason: input.reason,
      eventMeta: {
        eventId: `${input.parentSessionId}:${input.parentToolReference.toolCallId}:tool_result`,
        runId: `task:${input.taskId}`,
        occurredAt: Date.now(),
      },
    }),
    { clientRequestId: parentToolResultClientRequestId },
  );
}

export function buildTaskUpdateEvent(input: {
  assignedAgent: string;
  category?: string;
  childSessionId: string;
  errorMessage?: string;
  parentSessionId: string;
  reason?: string;
  requestedSkills?: string[];
  result?: string;
  status: 'pending' | 'in_progress' | 'done' | 'failed' | 'cancelled';
  taskId: string;
  taskTitle: string;
  timeoutSource?: ChildSessionTimeoutSource;
}): Extract<RunEvent, { type: 'task_update' }> {
  return {
    type: 'task_update',
    taskId: input.taskId,
    label: input.taskTitle,
    status: input.status,
    assignedAgent: input.assignedAgent,
    ...(input.category ? { category: input.category } : {}),
    ...(input.requestedSkills && input.requestedSkills.length > 0
      ? { requestedSkills: input.requestedSkills }
      : {}),
    ...(input.result ? { result: input.result } : {}),
    ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.timeoutSource ? { timeoutSource: input.timeoutSource } : {}),
    sessionId: input.childSessionId,
    parentSessionId: input.parentSessionId,
    eventId: `${input.parentSessionId}:${input.taskId}:${input.status}`,
    runId: `task:${input.taskId}`,
    occurredAt: Date.now(),
  };
}

export async function settleChildTaskNotification(input: {
  agent: string;
  childSessionId: string;
  error: string;
  parentSessionId: string;
  status: 'failed' | 'cancelled';
  taskTitle: string;
  taskUpdatedAt: number;
  userId: string;
}): Promise<void> {
  const notificationId = buildTaskJobNotificationId({
    childSessionId: input.childSessionId,
    taskUpdatedAt: input.taskUpdatedAt,
  });
  settleTaskJob(input.childSessionId, {
    notificationId,
    status: input.status === 'cancelled' ? 'cancelled' : 'error',
    error: input.error,
  });
  await deliverTaskCompletion({
    agent: input.agent,
    childSessionId: input.childSessionId,
    description: input.taskTitle,
    notificationId,
    parentSessionId: input.parentSessionId,
    ...(input.status === 'cancelled' ? { resume: false } : {}),
    state: input.status,
    text: input.error,
    userId: input.userId,
  });
}

/**
 * Unified termination entry point for a child session.
 * Handles: abort stream → mark task failed/cancelled → sync parent tool result → publish event → propagate to parent chain.
 * Uses `failed + terminalReason=timeout` for timeout; `cancelled` for explicit cancel.
 */
export async function terminateChildSession(input: {
  childSessionId: string;
  graphSessionId: string;
  reason: ChildSessionTerminalReason;
  taskId: string;
  timeoutSource?: ChildSessionTimeoutSource;
  userId: string;
}): Promise<{ stopped: boolean; terminated: boolean }> {
  const taskManager = new AgentTaskManagerImpl();
  const graph = await loadTaskGraphForSession(taskManager, input.graphSessionId);
  const taskEntry = graph.tasks[input.taskId];
  if (!taskEntry) {
    return { stopped: false, terminated: false };
  }

  if (
    taskEntry.status === 'completed' ||
    taskEntry.status === 'failed' ||
    taskEntry.status === 'cancelled'
  ) {
    return { stopped: false, terminated: false };
  }

  const taskStatus = input.reason === 'timeout' ? 'failed' : 'cancelled';
  const terminalErrorMessage =
    input.reason === 'timeout' ? '子代理执行已超时,已被终止。' : '子代理已被取消。';

  graph.tasks[input.taskId] = {
    ...taskEntry,
    status: taskStatus,
    errorMessage: terminalErrorMessage,
    completedAt: Date.now(),
    updatedAt: Date.now(),
  };
  await taskManager.save(graph);

  sqliteRun(
    "UPDATE sessions SET state_status = 'idle', updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [input.childSessionId, input.userId],
  );

  const childSession = sqliteGet<{ metadata_json: string }>(
    'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [input.childSessionId, input.userId],
  );
  const childMetadata = childSession ? parseSessionMetadataJson(childSession.metadata_json) : {};
  childMetadata[CHILD_SESSION_TERMINAL_REASON_KEY] = input.reason;
  if (input.reason === 'timeout') {
    if (input.timeoutSource) {
      childMetadata[CHILD_SESSION_TIMEOUT_SOURCE_KEY] = input.timeoutSource;
    }
  } else {
    delete childMetadata[CHILD_SESSION_TIMEOUT_SOURCE_KEY];
  }
  sqliteRun(
    "UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [JSON.stringify(childMetadata), input.childSessionId, input.userId],
  );

  const stopped = await stopAnyInFlightStreamRequestForSession({
    sessionId: input.childSessionId,
    userId: input.userId,
  });

  const assignedAgent =
    taskEntry.assignedAgent ??
    (typeof childMetadata.subagentType === 'string' ? childMetadata.subagentType : 'task');
  const category =
    typeof childMetadata.taskCategory === 'string' ? childMetadata.taskCategory : undefined;
  const requestedSkills = readTaskRequestedSkills(childMetadata);
  const parentToolReference = readTaskParentToolReference(childMetadata);
  const toolOutputStatus: TaskToolOutputStatus =
    input.reason === 'timeout' ? 'failed' : 'cancelled';

  syncParentTaskToolResult({
    assignedAgent,
    category,
    errorMessage: terminalErrorMessage,
    parentSessionId: input.graphSessionId,
    parentToolReference,
    reason: input.reason,
    requestedSkills,
    sessionId: input.childSessionId,
    status: toolOutputStatus,
    taskId: taskEntry.id,
    timeoutSource: input.timeoutSource,
    userId: input.userId,
  });

  await settleChildTaskNotification({
    agent: taskEntry.assignedAgent ?? 'task',
    childSessionId: input.childSessionId,
    error: terminalErrorMessage,
    parentSessionId: input.graphSessionId,
    status: taskStatus,
    taskTitle: taskEntry.title ?? taskEntry.id,
    taskUpdatedAt: graph.tasks[input.taskId]?.updatedAt ?? Date.now(),
    userId: input.userId,
  });

  publishSessionRunEvent(
    input.graphSessionId,
    buildTaskUpdateEvent({
      assignedAgent,
      category,
      childSessionId: input.childSessionId,
      errorMessage: terminalErrorMessage,
      parentSessionId: input.graphSessionId,
      reason: input.reason,
      requestedSkills,
      status: input.reason === 'timeout' ? 'failed' : 'cancelled',
      taskId: taskEntry.id,
      taskTitle: taskEntry.title,
      timeoutSource: input.timeoutSource,
    }),
  );

  return { stopped, terminated: true };
}
