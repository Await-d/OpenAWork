/**
 * 后台子任务生命周期域(261009-tool-sandbox 拆分 P1 / T-06)。
 *
 * 由 `tool-sandbox.ts` 原样搬出,行为不变:子任务后台运行、终结算器
 * (`finalizeChildTaskRun*`)、取消 / 等待终态、后台输出格式化、恢复重建
 * (`reconcileResumedTaskChildSession`)与任务状态映射辅助。
 */

import { AgentTaskManagerImpl } from '@openAwork/agent-core';
import type { RunEvent } from '@openAwork/shared';
import { sqliteGet, sqliteRun } from '../../infra/db.js';
import { listSessionMessagesV2 as listSessionMessages } from '../../message/message-v2-adapter.js';
import { stopAnyInFlightStreamRequestForSession } from '../../routes/stream-cancellation.js';
import { publishSessionRunEvent } from '../../session/session-run-events.js';
import { parseSessionMetadataJson } from '../../session/session-workspace-metadata.js';
import {
  get as getTaskJob,
  settle as settleTaskJob,
  startBackground as startBackgroundTaskJob,
} from '../../task/task-job.js';
import { clearTaskParentContext } from '../../task/task-parent-context-store.js';
import {
  buildTaskJobNoticeText,
  buildTaskJobNotificationId,
  deliverTaskCompletion,
} from '../../task/task-job-delivery.js';
import { isTaskCreatedSessionMetadata } from '../../task/subagent-limits.js';
import { tryResolveTaskPendingInteractionWithParent } from '../../task/task-parent-auto-decision.js';
import { extractLatestChildSessionSummary } from '../../task/task-result-extraction.js';
import {
  buildTaskUpdateEvent,
  clearTimedOutChildSessionAttemptArtifacts,
  getTaskChildFirstResponseRetryMaxRetries,
  getTaskChildFirstResponseTimeoutMs,
  isChildSessionFirstResponseEvent,
  loadTaskGraphForSession,
  mapTaskStatusToToolOutputStatus,
  readChildSessionTerminalReason,
  readChildSessionTimeoutSource,
  readTaskParentToolReference,
  readTaskRequestedSkills,
  settleChildTaskNotification,
  syncParentTaskToolResult,
  type ChildSessionTerminalReason,
  type TaskParentToolReference,
  writeChildSessionTerminalReason,
} from './child-session.js';
import {
  getSessionMetadata,
  getSessionOwnerUserId,
  type TaskBackgroundRunResult,
} from './session-context.js';
import { findTaskBySessionId, readTaskCategory } from './task-reference.js';

function mapTaskStatusToUpdateStatus(
  status: string,
): 'pending' | 'in_progress' | 'done' | 'failed' | 'cancelled' {
  switch (status) {
    case 'running':
      return 'in_progress';
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
export async function reconcileResumedTaskChildSession(input: {
  childSessionId: string;
  pendingInteraction: boolean;
  statusCode: number;
  userId: string;
}): Promise<void> {
  const childSession = sqliteGet<{ metadata_json: string }>(
    'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [input.childSessionId, input.userId],
  );
  if (!childSession) {
    return;
  }

  const metadata = parseSessionMetadataJson(childSession.metadata_json);
  if (!isTaskCreatedSessionMetadata(metadata)) {
    return;
  }

  const parentSessionId =
    typeof metadata.parentSessionId === 'string' ? metadata.parentSessionId : null;
  if (!parentSessionId) {
    return;
  }

  const taskManager = new AgentTaskManagerImpl();
  const graph = await loadTaskGraphForSession(taskManager, parentSessionId);
  const task = findTaskBySessionId(graph, input.childSessionId);
  if (!task) {
    return;
  }

  await finalizeChildTaskRun({
    assignedAgent:
      task.assignedAgent ??
      (typeof metadata.subagentType === 'string' ? metadata.subagentType : 'task'),
    childSessionId: input.childSessionId,
    childTaskId: task.id,
    parentToolReference: readTaskParentToolReference(metadata),
    parentSessionId,
    requestedSkills: readTaskRequestedSkills(metadata),
    result: {
      pendingInteraction: input.pendingInteraction,
      statusCode: input.statusCode,
      summary: getChildSessionSummary(input.childSessionId, input.userId),
    },
    taskCategory: readTaskCategory(metadata),
    taskManager,
    taskTitle: task.title,
    userId: input.userId,
  });
}

export function formatValidationIssues(
  issues: Array<{
    message: string;
    path: PropertyKey[];
  }>,
): string {
  return issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : null;
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join(', ');
}

export function getChildSessionSummary(sessionId: string, userId: string): string {
  // 对齐参考库：只在**已完成**的 assistant 消息里找最终文本
  //（`subagent-job.ts` 的 `message.error === undefined` 判定 → 这里用 statuses 过滤）。
  return extractLatestChildSessionSummary(
    listSessionMessages({ sessionId, userId, statuses: ['final'] }),
  );
}

function stripThinkingBlocks(value: string): string {
  return value.replace(/`{3,}thinking\n[\s\S]*?`{3,}\n*/g, '').trim();
}

/**
 * `background_output(full_session: true)` 的消息正文总字符预算。
 *
 * full_session 是显式 opt-in 的排查入口，但仍要有上限：历史上出现过单次
 * 约 20 万字符的返回被父会话整段吃掉。超出预算时保留最近的消息并从最早
 * 处淘汰，同时回传 `omittedMessages` 计数供模型判断是否还需要更早上下文。
 */
export const BACKGROUND_OUTPUT_MESSAGES_MAX_CHARS = 50_000;

/**
 * `background_output(full_session: true)` 单条消息正文的字符上限。
 *
 * 总预算只能淘汰“更早”的消息；如果最新一条消息本身极大（例如子代理把整个
 * 文件贴进回复），预算守卫会因“至少保留最新一条”而失效。这里对每条文本
 * 再设硬上限，保证单条消息也不会失控。
 */
const BACKGROUND_OUTPUT_MESSAGE_MAX_TEXT_CHARS = 20_000;

export function formatBackgroundOutputMessages(input: {
  includeThinking: boolean;
  includeToolResults: boolean;
  limit: number;
  sinceMessageId?: string;
  thinkingMaxChars: number;
  userId: string;
  sessionId: string;
}): { messages: unknown[]; omittedCount: number } {
  const maxTextChars = Math.max(input.thinkingMaxChars, BACKGROUND_OUTPUT_MESSAGE_MAX_TEXT_CHARS);
  const messages = listSessionMessages({
    sessionId: input.sessionId,
    userId: input.userId,
  });
  const startIndex = input.sinceMessageId
    ? messages.findIndex((message) => message.id === input.sinceMessageId)
    : -1;
  const sliced = startIndex >= 0 ? messages.slice(startIndex + 1) : messages;
  const filtered = sliced
    .map((message) => ({
      ...message,
      content: input.includeToolResults
        ? message.content
        : message.content.filter((part) => part.type !== 'tool_result'),
    }))
    .filter((message) => message.content.length > 0);
  const formatted = filtered.slice(-input.limit).map((message) => ({
    id: message.id,
    role: message.role,
    createdAt: message.createdAt,
    content: message.content.map((part) => {
      if (part.type !== 'text') {
        return part;
      }
      const stripped = input.includeThinking ? part.text : stripThinkingBlocks(part.text);
      return {
        ...part,
        text:
          stripped.length > maxTextChars
            ? `${stripped.slice(0, maxTextChars)}\n…[消息文本已截断，完整内容见子会话 sessionID: ${input.sessionId}]`
            : stripped,
      };
    }),
  }));

  // 从最新一条往前保留，直到预算用尽；至少保留最新一条。
  const kept: typeof formatted = [];
  let totalChars = 0;
  for (let index = formatted.length - 1; index >= 0; index -= 1) {
    const entry = formatted[index];
    if (!entry) continue;
    const entryChars = JSON.stringify(entry).length;
    if (kept.length > 0 && totalChars + entryChars > BACKGROUND_OUTPUT_MESSAGES_MAX_CHARS) {
      break;
    }
    kept.unshift(entry);
    totalChars += entryChars;
  }

  return { messages: kept, omittedCount: formatted.length - kept.length };
}

export async function waitForTaskTerminalState(input: {
  sessionId: string;
  taskId: string;
  timeoutMs: number;
  signal: AbortSignal;
}) {
  const taskManager = new AgentTaskManagerImpl();
  const deadline = Date.now() + input.timeoutMs;
  while (true) {
    if (input.signal.aborted) {
      throw new Error('Background task wait aborted');
    }
    const graph = await loadTaskGraphForSession(taskManager, input.sessionId);
    const task = graph.tasks[input.taskId];
    if (!task || (task.status !== 'running' && task.status !== 'pending')) {
      return { task, timedOut: false };
    }
    if (Date.now() >= deadline) {
      return { task, timedOut: true };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

export async function cancelBackgroundTaskEntry(input: {
  graph: Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>;
  graphSessionId: string;
  reason?: ChildSessionTerminalReason;
  taskManager: AgentTaskManagerImpl;
  taskId: string;
  userId: string;
}): Promise<{
  agent: string;
  description: string;
  previousStatus: string;
  requestedSkills: string[];
  taskId: string;
  sessionId?: string;
  status: string;
  stopped: boolean;
} | null> {
  const taskEntry = input.graph.tasks[input.taskId];
  if (!taskEntry) {
    return null;
  }

  if (
    taskEntry.status === 'completed' ||
    taskEntry.status === 'failed' ||
    taskEntry.status === 'cancelled'
  ) {
    return {
      agent: taskEntry.assignedAgent ?? 'task',
      description: taskEntry.title ?? taskEntry.id,
      previousStatus: taskEntry.status,
      requestedSkills: [],
      taskId: taskEntry.id,
      sessionId: taskEntry.sessionId,
      status: taskEntry.status,
      stopped: false,
    };
  }

  const reason = input.reason ?? 'cancelled';
  const previousStatus = taskEntry.status;

  input.graph.tasks[input.taskId] = {
    ...taskEntry,
    status: 'cancelled',
    completedAt: Date.now(),
    updatedAt: Date.now(),
  };

  const childSessionId = taskEntry.sessionId;
  if (!childSessionId) {
    return {
      agent: taskEntry.assignedAgent ?? 'task',
      description: taskEntry.title ?? taskEntry.id,
      previousStatus,
      requestedSkills: [],
      taskId: taskEntry.id,
      sessionId: undefined,
      status: 'cancelled',
      stopped: false,
    };
  }

  await input.taskManager.save(input.graph);

  sqliteRun(
    "UPDATE sessions SET state_status = 'idle', updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [childSessionId, input.userId],
  );
  const stopped = await stopAnyInFlightStreamRequestForSession({
    sessionId: childSessionId,
    userId: input.userId,
  });
  const childSession = sqliteGet<{ metadata_json: string }>(
    'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [childSessionId, input.userId],
  );
  const childMetadata = childSession ? parseSessionMetadataJson(childSession.metadata_json) : {};
  const assignedAgent =
    taskEntry.assignedAgent ??
    (typeof childMetadata.subagentType === 'string' ? childMetadata.subagentType : 'task');
  const category =
    typeof childMetadata.taskCategory === 'string' ? childMetadata.taskCategory : undefined;
  const requestedSkills = readTaskRequestedSkills(childMetadata) ?? [];
  syncParentTaskToolResult({
    assignedAgent,
    category,
    parentSessionId: input.graphSessionId,
    parentToolReference: readTaskParentToolReference(childMetadata),
    reason,
    requestedSkills,
    sessionId: childSessionId,
    status: 'cancelled',
    taskId: taskEntry.id,
    userId: input.userId,
  });
  await settleChildTaskNotification({
    agent: taskEntry.assignedAgent ?? 'task',
    childSessionId,
    error: '子代理已被取消。',
    parentSessionId: input.graphSessionId,
    status: 'cancelled',
    taskTitle: taskEntry.title ?? taskEntry.id,
    taskUpdatedAt: input.graph.tasks[input.taskId]?.updatedAt ?? Date.now(),
    userId: input.userId,
  });
  publishSessionRunEvent(
    input.graphSessionId,
    buildTaskUpdateEvent({
      assignedAgent,
      category,
      childSessionId,
      parentSessionId: input.graphSessionId,
      reason,
      requestedSkills,
      status: 'cancelled',
      taskId: taskEntry.id,
      taskTitle: taskEntry.title ?? taskEntry.id,
    }),
  );

  return {
    agent: assignedAgent,
    description: taskEntry.title ?? taskEntry.id,
    previousStatus,
    requestedSkills,
    taskId: taskEntry.id,
    sessionId: childSessionId,
    status: 'cancelled',
    stopped,
  };
}

export function registerBackgroundChildTask(input: {
  assignedAgent: string;
  childSessionId: string;
  parentSessionId: string;
  taskTitle: string;
}): void {
  startBackgroundTaskJob({
    id: input.childSessionId,
    title: input.taskTitle,
    recovery: {
      kind: 'subagent',
      parentSessionId: input.parentSessionId,
      childSessionId: input.childSessionId,
      agent: input.assignedAgent,
      description: input.taskTitle,
    },
  });
}

export async function runChildTaskSessionInBackground(input: {
  assignedAgent: string;
  childSessionId: string;
  childTaskId: string;
  parentToolReference?: TaskParentToolReference;
  parentSessionId: string;
  requestData: Record<string, unknown>;
  requestedSkills?: string[];
  taskCategory?: string;
  taskTitle: string;
  userId: string;
}): Promise<void> {
  const taskManager = new AgentTaskManagerImpl();
  const requestClientRequestId =
    typeof input.requestData.clientRequestId === 'string'
      ? input.requestData.clientRequestId
      : undefined;
  const firstResponseTimeoutMs = getTaskChildFirstResponseTimeoutMs();
  const firstResponseRetryMaxRetries = getTaskChildFirstResponseRetryMaxRetries(input.requestData);

  const existingJob = getTaskJob(input.childSessionId);
  if (existingJob && existingJob.status !== 'running') {
    return;
  }
  // try 从「加载任务图」之前就生效：派发方（新建路径 / resume 路径）已先把子会话
  // 置为 `running`，此前的准备阶段一旦抛错逃出本函数，子会话会永久残留 `running`
  // —— 既不再有任何执行、也无 reconcile 触发点，持续占用任务树的活跃子代理名额
  // （后台路径还会额外产生 unhandled rejection）。
  try {
    const graph = await loadTaskGraphForSession(taskManager, input.parentSessionId);
    if (
      graph.tasks[input.childTaskId]?.status !== 'running' ||
      (existingJob && getTaskJob(input.childSessionId)?.status !== 'running')
    ) {
      return;
    }
    if (!existingJob) {
      registerBackgroundChildTask(input);
    }

    const { runSessionInBackground } = await import('../../routes/stream-runtime.js');
    let finalResult: TaskBackgroundRunResult | null = null;

    for (let attempt = 0; attempt <= firstResponseRetryMaxRetries; attempt += 1) {
      let pendingInteraction = false;
      let firstActivityReceived = false;
      let firstActivityTimedOut = false;
      const firstResponseTimer = setTimeout(() => {
        firstActivityTimedOut = true;
        void stopAnyInFlightStreamRequestForSession({
          sessionId: input.childSessionId,
          userId: input.userId,
        });
      }, firstResponseTimeoutMs);
      const markFirstActivityReceived = () => {
        if (firstActivityReceived) {
          return;
        }

        firstActivityReceived = true;
        clearTimeout(firstResponseTimer);
      };

      try {
        const result = await runSessionInBackground({
          onStarted: markFirstActivityReceived,
          requestData: input.requestData,
          sessionId: input.childSessionId,
          userId: input.userId,
          writeChunk: (chunk: RunEvent) => {
            if (
              isChildSessionFirstResponseEvent(chunk, firstActivityTimedOut, firstActivityReceived)
            ) {
              markFirstActivityReceived();
            }

            if (chunk.type === 'permission_asked') {
              pendingInteraction = true;
              return;
            }

            if (
              chunk.type === 'tool_result' &&
              typeof chunk.pendingPermissionRequestId === 'string'
            ) {
              pendingInteraction = true;
            }
          },
        });

        clearTimeout(firstResponseTimer);

        if (firstActivityTimedOut && !firstActivityReceived) {
          clearTimedOutChildSessionAttemptArtifacts({
            childSessionId: input.childSessionId,
            clientRequestId: requestClientRequestId,
            userId: input.userId,
          });

          if (attempt < firstResponseRetryMaxRetries) {
            continue;
          }

          writeChildSessionTerminalReason({
            childSessionId: input.childSessionId,
            reason: 'timeout',
            timeoutSource: 'first_response',
            userId: input.userId,
          });
          finalResult = {
            pendingInteraction: false,
            reason: 'timeout',
            statusCode: 504,
            summary: `子代理在 ${firstResponseTimeoutMs}ms 内未启动或返回可见活动，已重试 ${attempt} 次后停止。`,
          };
          break;
        }

        const statusCode =
          result.stopReason === 'error' && result.statusCode < 400 ? 500 : result.statusCode;
        const childSummary = getChildSessionSummary(input.childSessionId, input.userId);
        finalResult = {
          pendingInteraction,
          statusCode,
          summary:
            statusCode >= 400
              ? (result.errorSummary ?? (childSummary || '子代理执行失败：未产生可用结果。'))
              : childSummary,
        };
        break;
      } catch (error) {
        clearTimeout(firstResponseTimer);

        if (firstActivityTimedOut && !firstActivityReceived) {
          clearTimedOutChildSessionAttemptArtifacts({
            childSessionId: input.childSessionId,
            clientRequestId: requestClientRequestId,
            userId: input.userId,
          });

          if (attempt < firstResponseRetryMaxRetries) {
            continue;
          }

          writeChildSessionTerminalReason({
            childSessionId: input.childSessionId,
            reason: 'timeout',
            timeoutSource: 'first_response',
            userId: input.userId,
          });
          finalResult = {
            pendingInteraction: false,
            reason: 'timeout',
            statusCode: 504,
            summary: `子代理在 ${firstResponseTimeoutMs}ms 内未启动或返回可见活动，已重试 ${attempt} 次后停止。`,
          };
          break;
        }

        finalResult = {
          pendingInteraction: false,
          statusCode: 500,
          summary: error instanceof Error ? error.message : String(error),
        };
        break;
      }
    }

    await finalizeChildTaskRunSafely({
      childSessionId: input.childSessionId,
      childTaskId: input.childTaskId,
      assignedAgent: input.assignedAgent,
      parentToolReference: input.parentToolReference,
      parentSessionId: input.parentSessionId,
      requestedSkills: input.requestedSkills,
      result: finalResult ?? {
        pendingInteraction: false,
        statusCode: 500,
        summary: '子代理执行失败：未产生可用结果。',
      },
      taskCategory: input.taskCategory,
      taskManager,
      taskTitle: input.taskTitle,
      userId: input.userId,
    });
  } catch (error) {
    await finalizeChildTaskRunSafely({
      childSessionId: input.childSessionId,
      childTaskId: input.childTaskId,
      assignedAgent: input.assignedAgent,
      parentToolReference: input.parentToolReference,
      parentSessionId: input.parentSessionId,
      requestedSkills: input.requestedSkills,
      result: {
        pendingInteraction: false,
        statusCode: 500,
        summary: error instanceof Error ? error.message : String(error),
      },
      taskCategory: input.taskCategory,
      taskManager,
      taskTitle: input.taskTitle,
      userId: input.userId,
    });
  }
}

/**
 * 派发期失败回滚：把子会话从 `running` 归位为 `idle`，立即释放任务树的活跃名额。
 *
 * 只处理 `running` —— `idle` 无需动作，`paused` 表示子代理确实在等用户交互、
 * 仍可被恢复，不能在此被静默抹平。条件写在 SQL 里保证幂等：重复回滚无副作用。
 */
export function releaseChildSessionActiveSlot(input: {
  childSessionId: string;
  userId: string;
}): void {
  sqliteRun(
    `UPDATE sessions SET state_status = 'idle', updated_at = datetime('now')
     WHERE id = ? AND user_id = ? AND state_status = 'running'`,
    [input.childSessionId, input.userId],
  );
}

function isIgnorableChildFinalizeError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    // 关库竞态：后台终结算器可能晚于 `closeDb()` 执行（网关关停 / 验收脚本收尾）。
    // ⚠️ 各运行时的措辞不同，必须都覆盖——只匹配一种会让「容忍」在另一种运行时**形同虚设**：
    //   - `database is not open`：旧运行时（迁移前）的措辞，保留兼容；
    //   - `Cannot use a closed database`：**bun:sqlite 的实际措辞**（迁移后曾漏配，
    //     导致本该被吞掉的竞态照样以 unhandled rejection 抛出、进程退出码为 1）。
    error.message.includes('database is not open') ||
    error.message.includes('Cannot use a closed database') ||
    (typeof (error as { code?: unknown }).code === 'string' &&
      (error as { code?: string }).code === 'ERR_INVALID_STATE')
  );
}

export async function finalizeChildTaskRunSafely(
  input: Parameters<typeof finalizeChildTaskRun>[0],
): Promise<void> {
  try {
    await finalizeChildTaskRun(input);
  } catch (error) {
    if (isIgnorableChildFinalizeError(error)) {
      return;
    }
    throw error;
  }
}

async function finalizeChildTaskRun(input: {
  assignedAgent: string;
  childSessionId: string;
  childTaskId: string;
  parentToolReference?: TaskParentToolReference;
  parentSessionId: string;
  requestedSkills?: string[];
  result: TaskBackgroundRunResult;
  taskCategory?: string;
  taskManager: AgentTaskManagerImpl;
  taskTitle: string;
  userId: string;
}): Promise<void> {
  if (input.result.reason) {
    writeChildSessionTerminalReason({
      childSessionId: input.childSessionId,
      reason: input.result.reason,
      timeoutSource:
        input.result.reason === 'timeout'
          ? readChildSessionTimeoutSource(getSessionMetadata(input.childSessionId))
          : undefined,
      userId: input.userId,
    });
  }
  const summary = input.result.summary || '子代理执行已结束。';
  sqliteRun(
    "UPDATE sessions SET state_status = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [input.result.pendingInteraction ? 'paused' : 'idle', input.childSessionId, input.userId],
  );

  if (getSessionOwnerUserId(input.parentSessionId) !== input.userId) {
    return;
  }

  const graph = await loadTaskGraphForSession(input.taskManager, input.parentSessionId);
  const task = graph.tasks[input.childTaskId];
  if (!task) {
    return;
  }

  if (task.status === 'cancelled' || task.status === 'failed' || task.status === 'completed') {
    const assignedAgent = task.assignedAgent ?? input.assignedAgent;
    const terminalOutputStatus = mapTaskStatusToToolOutputStatus(task.status);
    const terminalUpdateStatus = mapTaskStatusToUpdateStatus(task.status);
    const notificationId = buildTaskJobNotificationId({
      childSessionId: input.childSessionId,
      taskUpdatedAt: task.updatedAt,
    });
    settleTaskJob(input.childSessionId, {
      notificationId,
      status:
        task.status === 'completed'
          ? 'completed'
          : task.status === 'failed'
            ? 'error'
            : 'cancelled',
      ...(task.result ? { output: task.result } : {}),
      ...(task.errorMessage ? { error: task.errorMessage } : {}),
    });
    await input.taskManager.save(graph);
    await deliverTaskCompletion({
      agent: assignedAgent,
      childSessionId: input.childSessionId,
      description: input.taskTitle,
      notificationId,
      parentSessionId: input.parentSessionId,
      ...(task.status === 'cancelled' ? { resume: false } : {}),
      state:
        task.status === 'completed' ? 'done' : task.status === 'failed' ? 'failed' : 'cancelled',
      text: buildTaskJobNoticeText({
        errorMessage: task.errorMessage,
        result: task.result,
        summary,
      }),
      userId: input.userId,
    });
    const childMetadata = getSessionMetadata(input.childSessionId);
    const terminalReason = input.result.reason ?? readChildSessionTerminalReason(childMetadata);
    const timeoutSource = readChildSessionTimeoutSource(childMetadata);
    syncParentTaskToolResult({
      assignedAgent,
      category: input.taskCategory,
      errorMessage: task.errorMessage,
      parentSessionId: input.parentSessionId,
      parentToolReference: input.parentToolReference,
      reason: terminalReason,
      requestedSkills: input.requestedSkills,
      result: task.result,
      sessionId: input.childSessionId,
      status: terminalOutputStatus,
      taskId: task.id,
      timeoutSource,
      userId: input.userId,
    });
    publishSessionRunEvent(
      input.parentSessionId,
      buildTaskUpdateEvent({
        assignedAgent,
        category: input.taskCategory,
        childSessionId: input.childSessionId,
        errorMessage: task.errorMessage,
        parentSessionId: input.parentSessionId,
        reason: terminalReason,
        requestedSkills: input.requestedSkills,
        result: task.result,
        status: terminalUpdateStatus,
        taskId: task.id,
        taskTitle: input.taskTitle,
        timeoutSource,
      }),
    );
    return;
  }

  if (input.result.pendingInteraction) {
    const resolvedByParent = await tryResolveTaskPendingInteractionWithParent({
      childSessionId: input.childSessionId,
      userId: input.userId,
    });
    if (resolvedByParent) {
      return;
    }

    input.taskManager.updateTask(graph, task.id, {
      result: summary,
    });
    await input.taskManager.save(graph);
    const nextTask = graph.tasks[input.childTaskId] ?? task;
    syncParentTaskToolResult({
      assignedAgent: nextTask.assignedAgent ?? input.assignedAgent,
      category: input.taskCategory,
      parentSessionId: input.parentSessionId,
      parentToolReference: input.parentToolReference,
      requestedSkills: input.requestedSkills,
      result: nextTask.result,
      sessionId: input.childSessionId,
      status: mapTaskStatusToToolOutputStatus(nextTask.status),
      taskId: task.id,
      userId: input.userId,
    });
    publishSessionRunEvent(
      input.parentSessionId,
      buildTaskUpdateEvent({
        assignedAgent: nextTask.assignedAgent ?? input.assignedAgent,
        category: input.taskCategory,
        childSessionId: input.childSessionId,
        parentSessionId: input.parentSessionId,
        requestedSkills: input.requestedSkills,
        result: nextTask.result,
        status: mapTaskStatusToUpdateStatus(nextTask.status),
        taskId: task.id,
        taskTitle: input.taskTitle,
      }),
    );
    return;
  }

  const didChildRunFail = input.result.statusCode >= 400;
  if (task.status === 'running') {
    if (didChildRunFail) {
      input.taskManager.failTask(graph, task.id, summary);
    } else {
      input.taskManager.completeTask(graph, task.id, summary);
    }
  } else {
    input.taskManager.updateTask(graph, task.id, {
      errorMessage: didChildRunFail ? summary : undefined,
      result: didChildRunFail ? task.result : summary,
    });
  }

  const nextTask = graph.tasks[input.childTaskId];
  const eventStatus = mapTaskStatusToUpdateStatus(nextTask?.status ?? task.status);
  const nextAssignedAgent = nextTask?.assignedAgent ?? input.assignedAgent;
  const terminalToolOutputStatus = mapTaskStatusToToolOutputStatus(nextTask?.status ?? task.status);
  const notificationId = buildTaskJobNotificationId({
    childSessionId: input.childSessionId,
    taskUpdatedAt: nextTask?.updatedAt ?? task.updatedAt,
  });
  if (
    terminalToolOutputStatus === 'done' ||
    terminalToolOutputStatus === 'failed' ||
    terminalToolOutputStatus === 'cancelled'
  ) {
    settleTaskJob(input.childSessionId, {
      notificationId,
      status:
        terminalToolOutputStatus === 'done'
          ? 'completed'
          : terminalToolOutputStatus === 'failed'
            ? 'error'
            : 'cancelled',
      ...(nextTask?.result ? { output: nextTask.result } : {}),
      ...(nextTask?.errorMessage ? { error: nextTask.errorMessage } : {}),
    });
  }
  await input.taskManager.save(graph);
  syncParentTaskToolResult({
    assignedAgent: nextAssignedAgent,
    category: input.taskCategory,
    errorMessage: nextTask?.errorMessage,
    parentSessionId: input.parentSessionId,
    parentToolReference: input.parentToolReference,
    reason: input.result.reason,
    requestedSkills: input.requestedSkills,
    result: nextTask?.result,
    sessionId: input.childSessionId,
    status: terminalToolOutputStatus,
    taskId: task.id,
    userId: input.userId,
  });
  if (
    terminalToolOutputStatus === 'done' ||
    terminalToolOutputStatus === 'failed' ||
    terminalToolOutputStatus === 'cancelled'
  ) {
    // ── 单通道交付（T-25）：合成通知（幂等）+ 唤醒决策 ──────────────────
    // 取代旧的「伪造用户请求 + 定时重试」路径；忙时由交付层留库待消费。
    // 取消任务只投递通知、不唤醒（与旧语义一致）。
    await deliverTaskCompletion({
      agent: nextAssignedAgent,
      childSessionId: input.childSessionId,
      description: input.taskTitle,
      notificationId,
      parentSessionId: input.parentSessionId,
      ...(terminalToolOutputStatus === 'cancelled' ? { resume: false } : {}),
      state:
        terminalToolOutputStatus === 'done'
          ? 'done'
          : terminalToolOutputStatus === 'failed'
            ? 'failed'
            : 'cancelled',
      text: buildTaskJobNoticeText({
        errorMessage: nextTask?.errorMessage,
        result: nextTask?.result,
        summary,
      }),
      userId: input.userId,
    });
    // 任务已终态：父会话上下文不再需要（自动决策只在子代理中途停顿时读取）。
    clearTaskParentContext({
      childSessionId: input.childSessionId,
      userId: input.userId,
    });
  }
  publishSessionRunEvent(
    input.parentSessionId,
    buildTaskUpdateEvent({
      assignedAgent: nextAssignedAgent,
      category: input.taskCategory,
      childSessionId: input.childSessionId,
      errorMessage: nextTask?.errorMessage,
      parentSessionId: input.parentSessionId,
      reason: input.result.reason,
      requestedSkills: input.requestedSkills,
      result: nextTask?.result,
      status: eventStatus,
      taskId: task.id,
      taskTitle: input.taskTitle,
    }),
  );
}
