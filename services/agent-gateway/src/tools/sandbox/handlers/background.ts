/**
 * background 域 handler(261009-tool-sandbox 拆分 P2 / T-11)。
 *
 * 由 `tool-sandbox.ts::executeGatewayManagedToolImpl` 原位搬出,零行为变更:
 * background_output / background_cancel 分支体逐字保留。
 * 派发顺序仍由门面的 if 链决定(本模块不参与顺序决策)。
 */

import { AgentTaskManagerImpl, type ToolCallResult } from '@openAwork/agent-core';
import { listSessionMessagesV2 as listSessionMessages } from '../../../message/message-v2-adapter.js';
import { reconcileSessionStateStatus } from '../../../session/session-runtime-state.js';
import {
  buildBackgroundCancelAllMessage,
  buildBackgroundCancelSingleMessage,
  buildBackgroundTaskResultMessage,
  buildBackgroundTaskStatusMessage,
  extractLatestDelegatedSessionMessage,
} from '../../../task/delegated-task-display.js';
import {
  backgroundCancelToolDefinition,
  backgroundOutputToolDefinition,
} from '../../background-task-tools.js';
import {
  buildTaskToolOutput,
  loadTaskGraphForSession,
  mapTaskStatusToToolOutputStatus,
  readChildSessionTerminalReason,
  readChildSessionTimeoutSource,
} from '../child-session.js';
import { findTaskBySessionId } from '../task-reference.js';
import type { SandboxHandlerContext } from '../context.js';
import { getSessionMetadata, getSessionOwnerUserId } from '../session-context.js';
import {
  BACKGROUND_OUTPUT_MESSAGES_MAX_CHARS,
  cancelBackgroundTaskEntry,
  formatBackgroundOutputMessages,
  formatValidationIssues,
  getChildSessionSummary,
  reconcileResumedTaskChildSession,
  waitForTaskTerminalState,
} from '../task-background.js';

export type BackgroundTaskGraph = Awaited<ReturnType<typeof loadTaskGraphForSession>>;
export type BackgroundTaskEntry = BackgroundTaskGraph['tasks'][string];

/** 单条任务在「找不到」提示里展示的字段，保持可读且不泄漏无关元数据。 */
function describeBackgroundTaskForRecovery(task: BackgroundTaskEntry): string {
  const agent = task.assignedAgent ?? 'task';
  const sessionId = task.sessionId ?? '-';
  return `- task_id=${task.id} | status=${task.status} | agent=${agent} | sessionId=${sessionId}`;
}

/**
 * 解析 `background_output` 的任务引用。
 *
 * 模型手里通常只有**子会话 ID**——子代理完成通知 `<subagent sessionID state …>`
 * 暴露的就是它，而不是 task 图主键。只按 `task_id` 主键查会必然 miss，并把模型
 * 逼进「换一个 ID 再盲试」的循环（同一子会话反复试 4 次仍全部失败）。
 * 因此先按主键精确命中，未命中再按子会话 ID 反查（与 delegation / task-background
 * 复用同一个 `findTaskBySessionId`）。
 */
export function resolveBackgroundTask(
  graph: BackgroundTaskGraph,
  reference: string,
): BackgroundTaskEntry | null {
  return graph.tasks[reference] ?? findTaskBySessionId(graph, reference);
}

/**
 * 任务引用解析失败时的诊断文案。
 *
 * 必须回答模型的两个问题：**我传错了什么**（多半是 sessionID 当 taskId）、
 * **正确的值是什么**（列出当前会话真实可用的 task_id）。只回一句
 * "was not found" 不含任何可操作信息，模型只能继续盲试。
 */
export function buildBackgroundTaskNotFoundMessage(input: {
  graph: BackgroundTaskGraph;
  reference: string;
  sessionId: string;
}): string {
  const tasks = Object.values(input.graph.tasks).sort(
    (left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0),
  );
  const lines = [
    `后台任务 ${input.reference} 在会话 ${input.sessionId} 中不存在。`,
    `注意：${input.reference} 看起来是子会话 ID。task_id / taskId / runId 必须传任务图主键（task.id）；子会话 ID（sessionID）只用于关联，不能直接当 task_id 使用。`,
  ];

  if (tasks.length === 0) {
    lines.push(
      '当前会话没有任何后台任务记录。若只是想查看子代理结果，请等待子代理完成通知，或直接读取子会话内容，不要用子会话 ID 调 background_output。',
    );
    return lines.join('\n');
  }

  lines.push('当前会话可用的后台任务：');
  for (const task of tasks.slice(0, 20)) {
    lines.push(describeBackgroundTaskForRecovery(task));
  }
  if (tasks.length > 20) {
    lines.push(`（仅列出最近 20 个，共 ${tasks.length} 个）`);
  }
  return lines.join('\n');
}

export async function handleBackgroundOutputTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput, signal } = ctx;
  const userId = getSessionOwnerUserId(sessionId);
  if (!userId) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: `Session owner not found for session ${sessionId}`,
      isError: true,
      durationMs: 0,
    };
  }

  const parsed = backgroundOutputToolDefinition.inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: formatValidationIssues(parsed.error.issues),
      isError: true,
      durationMs: 0,
    };
  }

  const taskManager = new AgentTaskManagerImpl();
  let graph = await loadTaskGraphForSession(taskManager, sessionId);
  let task = resolveBackgroundTask(graph, parsed.data.task_id);
  if (!task) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: buildBackgroundTaskNotFoundMessage({
        graph,
        reference: parsed.data.task_id,
        sessionId,
      }),
      isError: true,
      durationMs: 0,
    };
  }

  let waitTimedOut = false;
  if (parsed.data.block) {
    const waitResult = await waitForTaskTerminalState({
      sessionId,
      // 传已解析出的任务主键：调用方可能给的是子会话 ID，而等待逻辑按主键查图。
      taskId: task.id,
      timeoutMs: parsed.data.timeout,
      signal,
    });
    // 等待逻辑按主键查图，未命中时返回 undefined；归一化为 null 保持单一空值语义。
    task = waitResult.task ?? null;
    waitTimedOut = waitResult.timedOut;
    graph = await loadTaskGraphForSession(taskManager, sessionId);
  }

  if (!task) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: buildBackgroundTaskNotFoundMessage({
        graph,
        reference: parsed.data.task_id,
        sessionId,
      }),
      isError: true,
      durationMs: 0,
    };
  }

  const childSessionId = task.sessionId;
  if (!childSessionId) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: `后台任务 ${task.id} 没有关联的子会话，无法读取其输出。`,
      isError: true,
      durationMs: 0,
    };
  }

  const runtimeReconciliation = reconcileSessionStateStatus({
    sessionId: childSessionId,
    userId,
  });
  if (runtimeReconciliation.wasReset) {
    await reconcileResumedTaskChildSession({
      childSessionId,
      pendingInteraction: false,
      statusCode: 500,
      userId,
    });
    graph = await loadTaskGraphForSession(taskManager, sessionId);
    task = resolveBackgroundTask(graph, parsed.data.task_id);
    if (!task) {
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: buildBackgroundTaskNotFoundMessage({
          graph,
          reference: parsed.data.task_id,
          sessionId,
        }),
        isError: true,
        durationMs: 0,
      };
    }
  }

  const childMessages = listSessionMessages({
    sessionId: childSessionId,
    userId,
  });
  // 默认只回摘要（对齐参考库 `SubagentCompletion.text` 口径：子代理最后
  // 一条最终 assistant 文本），不再把整个子会话文本 + 工具输出拼进父会话
  // 工具结果。需要逐条消息时显式传 full_session: true。
  const childSummary = getChildSessionSummary(childSessionId, userId) || task.result || '';
  const latestChildMessage = extractLatestDelegatedSessionMessage(childMessages);
  const taskMessage =
    task.status === 'completed'
      ? buildBackgroundTaskResultMessage({
          agent: task.assignedAgent ?? 'task',
          completedAt: task.completedAt,
          description: task.title ?? task.id,
          resultText: childSummary,
          sessionId: childSessionId,
          startedAt: task.startedAt,
          taskId: task.id,
        })
      : buildBackgroundTaskStatusMessage({
          agent: task.assignedAgent ?? 'task',
          description: task.title ?? task.id,
          lastMessage: latestChildMessage?.text,
          lastMessageAt: latestChildMessage?.createdAt,
          prompt: task.description ?? '',
          queuedAt: task.createdAt,
          sessionId: childSessionId,
          startedAt: task.startedAt,
          status: task.status,
          taskId: task.id,
        });
  const baseOutput = buildTaskToolOutput({
    assignedAgent: task.assignedAgent ?? 'task',
    errorMessage: task.errorMessage,
    message: taskMessage,
    reason: readChildSessionTerminalReason(getSessionMetadata(childSessionId)),
    result: childSummary,
    sessionId: childSessionId,
    status: mapTaskStatusToToolOutputStatus(task.status),
    taskId: task.id,
    timeoutSource: readChildSessionTimeoutSource(getSessionMetadata(childSessionId)),
  });
  const formattedMessages = parsed.data.full_session
    ? formatBackgroundOutputMessages({
        includeThinking: parsed.data.include_thinking,
        includeToolResults: parsed.data.include_tool_results,
        limit: parsed.data.message_limit,
        sinceMessageId: parsed.data.since_message_id,
        thinkingMaxChars: parsed.data.thinking_max_chars,
        userId,
        sessionId: childSessionId,
      })
    : null;
  const output = formattedMessages
    ? {
        ...baseOutput,
        ...(waitTimedOut ? { timedOut: true } : {}),
        ...(formattedMessages.omittedCount > 0
          ? {
              messagesTruncated: true,
              omittedMessages: formattedMessages.omittedCount,
              note: `仅返回最近的消息（受 ${BACKGROUND_OUTPUT_MESSAGES_MAX_CHARS} 字符预算约束，更早的 ${formattedMessages.omittedCount} 条已省略）。`,
            }
          : {}),
        messages: formattedMessages.messages,
      }
    : waitTimedOut
      ? `Timeout exceeded (${parsed.data.timeout}ms). Task still ${task.status}.\n\n${taskMessage}`
      : taskMessage;

  return {
    toolCallId: request.toolCallId,
    toolName: request.toolName,
    output,
    isError: false,
    durationMs: 0,
  };
}

export async function handleBackgroundCancelTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput } = ctx;
  const userId = getSessionOwnerUserId(sessionId);
  if (!userId) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: `Session owner not found for session ${sessionId}`,
      isError: true,
      durationMs: 0,
    };
  }

  const parsed = backgroundCancelToolDefinition.inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: formatValidationIssues(parsed.error.issues),
      isError: true,
      durationMs: 0,
    };
  }

  const taskManager = new AgentTaskManagerImpl();
  const graph = await loadTaskGraphForSession(taskManager, sessionId);
  // 与 background_output 保持同一套引用解析：模型可能直接传子会话 ID。
  const resolvedTaskId = parsed.data.taskId
    ? (resolveBackgroundTask(graph, parsed.data.taskId)?.id ?? parsed.data.taskId)
    : undefined;
  const targetTaskIds = parsed.data.all
    ? Object.values(graph.tasks)
        .filter(
          (task) => task.sessionId && (task.status === 'pending' || task.status === 'running'),
        )
        .map((task) => task.id)
    : resolvedTaskId
      ? [resolvedTaskId]
      : [];

  if (targetTaskIds.length === 0) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: parsed.data.all
        ? 'No running or pending background tasks to cancel.'
        : buildBackgroundTaskNotFoundMessage({
            graph,
            reference: parsed.data.taskId ?? '',
            sessionId,
          }),
      isError: parsed.data.all !== true,
      durationMs: 0,
    };
  }

  const cancelled = [] as Array<{
    agent: string;
    description: string;
    previousStatus: string;
    requestedSkills: string[];
    taskId: string;
    sessionId?: string;
    status: string;
    stopped: boolean;
  }>;
  for (const taskId of targetTaskIds) {
    const result = await cancelBackgroundTaskEntry({
      graph,
      graphSessionId: sessionId,
      taskManager,
      taskId,
      userId,
    });
    if (result) {
      cancelled.push(result);
    }
  }
  await taskManager.save(graph);

  if (!parsed.data.all) {
    const target = cancelled[0];
    if (!target) {
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: buildBackgroundTaskNotFoundMessage({
          graph,
          reference: resolvedTaskId ?? parsed.data.taskId ?? '',
          sessionId,
        }),
        isError: true,
        durationMs: 0,
      };
    }

    if (target.previousStatus !== 'pending' && target.previousStatus !== 'running') {
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: `[ERROR] 无法取消任务：当前状态为 "${target.previousStatus}"。只有 pending 或 running 状态的任务可以取消。`,
        isError: true,
        durationMs: 0,
      };
    }

    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: buildBackgroundCancelSingleMessage({
        description: target.description,
        sessionId: target.sessionId,
        status: target.status,
        taskId: target.taskId,
      }),
      isError: false,
      durationMs: 0,
    };
  }

  return {
    toolCallId: request.toolCallId,
    toolName: request.toolName,
    output: buildBackgroundCancelAllMessage({
      tasks: cancelled.map((task) => ({
        agent: task.agent,
        description: task.description,
        requestedSkills: task.requestedSkills,
        sessionId: task.sessionId,
        status: task.previousStatus,
        taskId: task.taskId,
      })),
    }),
    isError: false,
    durationMs: 0,
  };
}
