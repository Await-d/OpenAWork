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
  let task = graph.tasks[parsed.data.task_id];
  if (!task) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: `Background task ${parsed.data.task_id} was not found in session ${sessionId}`,
      isError: true,
      durationMs: 0,
    };
  }

  let waitTimedOut = false;
  if (parsed.data.block) {
    const waitResult = await waitForTaskTerminalState({
      sessionId,
      taskId: parsed.data.task_id,
      timeoutMs: parsed.data.timeout,
      signal,
    });
    task = waitResult.task;
    waitTimedOut = waitResult.timedOut;
    graph = await loadTaskGraphForSession(taskManager, sessionId);
  }

  if (!task) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: `Background task ${parsed.data.task_id} no longer exists`,
      isError: true,
      durationMs: 0,
    };
  }

  const childSessionId = task.sessionId;
  if (!childSessionId) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: `Background task ${parsed.data.task_id} has no child session`,
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
    task = graph.tasks[parsed.data.task_id];
    if (!task) {
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: `Background task ${parsed.data.task_id} no longer exists`,
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
  const targetTaskIds = parsed.data.all
    ? Object.values(graph.tasks)
        .filter(
          (task) => task.sessionId && (task.status === 'pending' || task.status === 'running'),
        )
        .map((task) => task.id)
    : parsed.data.taskId
      ? [parsed.data.taskId]
      : [];

  if (targetTaskIds.length === 0) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: parsed.data.all
        ? 'No running or pending background tasks to cancel.'
        : `[ERROR] Task not found: ${parsed.data.taskId}`,
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
        output: `[ERROR] Task not found: ${parsed.data.taskId}`,
        isError: true,
        durationMs: 0,
      };
    }

    if (target.previousStatus !== 'pending' && target.previousStatus !== 'running') {
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: `[ERROR] Cannot cancel task: current status is "${target.previousStatus}".\nOnly running or pending tasks can be cancelled.`,
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
