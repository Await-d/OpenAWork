/**
 * delegation 域 handler(261009-tool-sandbox 拆分 P4 / T-15)。
 *
 * 由 `tool-sandbox.ts::executeGatewayManagedToolImpl` 原位搬出,零行为变更:
 * call_omo_agent 分支体与 `isTaskToolName(request.toolName)` 谓词块(含 task 生命周期
 * 派发 / resume / 后台注册 / 失败回滚)逐字保留。
 * 谓词调用点仍原位保留在门面 if 链(`if (isTaskToolName(request.toolName)) return
 * handleTaskTool(handlerContext);`),handler 内以 ctx 重算同一判定(flat MCP 同款手法)。
 * 派发顺序仍由门面的 if 链决定(本模块不参与顺序决策)。
 */

import {
  AgentTaskManagerImpl,
  resolveSessionPermissionMode,
  type ToolCallRequest,
  type ToolCallResult,
} from '@openAwork/agent-core';
import { randomUUID } from 'node:crypto';
import { sqliteGet, sqliteRun } from '../../../infra/db.js';
import { logGatewayWarn } from '../../../infra/gateway-logger.js';
import {
  appendSessionMessageV2 as appendSessionMessage,
  listSessionMessagesV2 as listSessionMessages,
  listSessionMessagesByRequestScope,
} from '../../../message/message-v2-adapter.js';
import {
  normalizeUpstreamRetryMaxRetries,
  UPSTREAM_RETRY_MAX_RETRIES_KEY,
} from '../../../provider/upstream-retry-policy.js';
import { publishSessionRunEvent } from '../../../session/session-run-events.js';
import {
  hasTeamDefinition,
  parseSessionMetadataJson,
} from '../../../session/session-workspace-metadata.js';
import { getEffectiveSkillsForSession } from '../../../skill/skill-selection-context.js';
import {
  buildTaskToolBackgroundMessage,
  buildTaskToolTerminalMessage,
} from '../../../task/delegated-task-display.js';
import { checkSubagentDepthAllowed } from '../../../task/subagent-depth.js';
import { getTaskSessionLimitError } from '../../../task/subagent-limits.js';
import {
  completeInheritedParentModel,
  resolveInheritedParentModel,
  resolveSubagentModelPolicyForUser,
} from '../../../task/subagent-model-policy.js';
import { resolveDelegatedAgent } from '../../../task/task-agent-resolution.js';
import { selectDelegatedModelForUser } from '../../../task/task-model-selection.js';
import { upsertTaskParentContext } from '../../../task/task-parent-context-store.js';
import { isTaskToolName, taskToolDefinition } from '../../../task/task-tools.js';
import {
  buildCallOmoAgentBackgroundOutput,
  buildCallOmoAgentSyncOutput,
  buildDelegatedChildClientRequestId,
} from '../../call-omo-agent-output.js';
import { CALL_OMO_ALLOWED_AGENTS, callOmoAgentToolDefinition } from '../../call-omo-agent-tools.js';
import {
  buildTaskToolOutput,
  loadTaskGraphForSession,
  mapTaskStatusToToolOutputStatus,
  readChildSessionTerminalReason,
  readChildSessionTimeoutSource,
  TASK_PARENT_TOOL_CALL_ID_KEY,
  TASK_PARENT_TOOL_REQUEST_ID_KEY,
} from '../child-session.js';
import type { SandboxHandlerContext } from '../context.js';
import { getSessionMetadata, getSessionOwnerUserId } from '../session-context.js';
import {
  finalizeChildTaskRunSafely,
  getChildSessionSummary,
  registerBackgroundChildTask,
  releaseChildSessionActiveSlot,
  runChildTaskSessionInBackground,
} from '../task-background.js';
import {
  buildDelegatedChildRequestData,
  buildTaskTags,
  findTaskBySessionId,
  findTeamRoleBindingForAgent,
  resolveTaskGraphTurnClientRequestId,
} from '../task-reference.js';
import { formatToolInputValidationOutput } from '../whitelist.js';

export async function handleCallOmoAgentTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, rawInput, executionContext, observability } = ctx;
  const parsed = callOmoAgentToolDefinition.inputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
      isError: true,
      durationMs: 0,
    };
  }

  const normalizedAgent = parsed.data.subagent_type.trim().toLowerCase();
  if (
    !CALL_OMO_ALLOWED_AGENTS.includes(normalizedAgent as (typeof CALL_OMO_ALLOWED_AGENTS)[number])
  ) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: `Error: Invalid agent type "${parsed.data.subagent_type}". Only ${CALL_OMO_ALLOWED_AGENTS.join(', ')} are allowed.`,
      isError: true,
      durationMs: 0,
    };
  }

  if (parsed.data.run_in_background && parsed.data.session_id) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output:
        'Error: session_id is not supported in background mode. Use run_in_background=false to continue an existing session.',
      isError: true,
      durationMs: 0,
    };
  }

  const delegatedRequest: ToolCallRequest = {
    ...request,
    toolName: taskToolDefinition.name,
    rawInput: {
      description: parsed.data.description ?? parsed.data.prompt.slice(0, 40),
      prompt: parsed.data.prompt,
      subagent_type: normalizedAgent,
      load_skills: [],
      run_in_background: parsed.data.run_in_background,
      ...(parsed.data.session_id ? { session_id: parsed.data.session_id } : {}),
    },
  };
  const taskResult = await ctx.executeGatewayManagedTool({
    executionContext,
    observability,
    request: delegatedRequest,
  });
  if (!taskResult) {
    return null;
  }
  if (
    taskResult.output &&
    typeof taskResult.output === 'object' &&
    !Array.isArray(taskResult.output) &&
    'sessionId' in taskResult.output &&
    'taskId' in taskResult.output
  ) {
    const taskOutput = taskResult.output as {
      errorMessage?: string;
      sessionId: string;
      taskId: string;
      status?: string;
      result?: string;
    };
    const childUserId = getSessionOwnerUserId(taskOutput.sessionId);
    const childClientRequestId = buildDelegatedChildClientRequestId({
      childSessionId: taskOutput.sessionId,
      parentClientRequestId: executionContext?.clientRequestId,
    });
    const childMessages =
      childUserId && executionContext?.clientRequestId
        ? listSessionMessagesByRequestScope({
            clientRequestId: childClientRequestId,
            sessionId: taskOutput.sessionId,
            userId: childUserId,
          })
        : childUserId
          ? listSessionMessages({
              sessionId: taskOutput.sessionId,
              userId: childUserId,
            })
          : [];
    const output = parsed.data.run_in_background
      ? buildCallOmoAgentBackgroundOutput({
          agent: normalizedAgent,
          description: parsed.data.description ?? parsed.data.prompt.slice(0, 40),
          sessionId: taskOutput.sessionId,
          status: taskOutput.status ?? 'pending',
          taskId: taskOutput.taskId,
        })
      : buildCallOmoAgentSyncOutput({
          fallbackText:
            taskOutput.errorMessage ??
            taskOutput.result ??
            `Completed ${normalizedAgent} session ${taskOutput.sessionId}.`,
          isError: taskResult.isError,
          messages: childMessages,
          sessionId: taskOutput.sessionId,
        });
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output,
      isError: taskResult.isError,
      durationMs: taskResult.durationMs,
    };
  }
  return {
    ...taskResult,
    toolName: request.toolName,
  };
}

export async function handleTaskTool(ctx: SandboxHandlerContext): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput, executionContext } = ctx;
  if (!isTaskToolName(request.toolName)) return null;
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

  const parsed = taskToolDefinition.inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
      isError: true,
      durationMs: 0,
    };
  }

  // `description` is now optional in the schema — models commonly
  // omit it since `prompt` already carries the full intent. We
  // derive a short fallback from the prompt's first 40 chars so
  // downstream consumers (task graph, session title, display
  // messages) always have a non-empty label.
  const effectiveTaskDescription = parsed.data.description ?? parsed.data.prompt.slice(0, 40);

  const taskManager = new AgentTaskManagerImpl();
  const graph = await loadTaskGraphForSession(taskManager, sessionId);
  const parentEffective = getEffectiveSkillsForSession(sessionId) ?? undefined;
  const resolvedAgent = resolveDelegatedAgent(userId, parsed.data, {
    parentEffective,
  });
  if (resolvedAgent.droppedSkills.length > 0) {
    // Audit only — do not block delegation. Spec calls for a single-line
    // visibility log so observability can spot mis-configured filters.
    console.warn(
      `[task-delegate] dropped skills outside effective set: parentSession=${sessionId} dropped=${resolvedAgent.droppedSkills.join(',')}`,
    );
  }
  const selectedDelegatedModel = selectDelegatedModelForUser(userId, resolvedAgent.modelEntries);
  const parentSessionRow = sqliteGet<{ metadata_json: string }>(
    'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [sessionId, userId],
  );
  const parentSessionMetadata = parentSessionRow
    ? parseSessionMetadataJson(parentSessionRow.metadata_json)
    : {};
  const teamRoleBinding = findTeamRoleBindingForAgent(parentSessionMetadata, resolvedAgent.agentId);
  const delegatedModel = teamRoleBinding
    ? {
        modelId:
          teamRoleBinding.modelId ??
          selectedDelegatedModel?.modelId ??
          resolvedAgent.modelEntries[0]?.modelId ??
          teamRoleBinding.agentId,
        ...(teamRoleBinding.providerId
          ? { providerId: teamRoleBinding.providerId }
          : selectedDelegatedModel?.providerId
            ? { providerId: selectedDelegatedModel.providerId }
            : {}),
        ...(teamRoleBinding.variant
          ? { variant: teamRoleBinding.variant }
          : resolvedAgent.modelVariant
            ? { variant: resolvedAgent.modelVariant }
            : selectedDelegatedModel?.variant
              ? { variant: selectedDelegatedModel.variant }
              : {}),
      }
    : selectedDelegatedModel
      ? {
          ...selectedDelegatedModel,
          ...(resolvedAgent.modelVariant ? { variant: resolvedAgent.modelVariant } : {}),
        }
      : undefined;
  // 「子代理模型来源」策略：inherit-main 时用主对话当前模型替换自动选出的模型；
  // thinking 仍由 category 自动决定（buildDelegatedChildRequestData 不变）。
  // 团队模板是权威来源：team role binding 命中、或父会话带 teamDefinition 时不参与本策略，
  // 本设置只治理普通聊天派生的子代理。
  const subagentModelPolicy = resolveSubagentModelPolicyForUser(userId);
  const inheritedParentModelCandidate =
    !teamRoleBinding &&
    !hasTeamDefinition(parentSessionMetadata) &&
    subagentModelPolicy.modelMode === 'inherit-main'
      ? resolveInheritedParentModel({
          requestData: executionContext?.requestData,
          parentSessionMetadata,
        })
      : undefined;
  // 父轮请求可能只带 model：反查模型归属 provider，否则子会话流式解析会静默回落到聊天模型。
  const inheritedParentModel = inheritedParentModelCandidate
    ? completeInheritedParentModel(inheritedParentModelCandidate, (modelId) =>
        selectDelegatedModelForUser(userId, [modelId]),
      )
    : undefined;
  const effectiveDelegatedModel = inheritedParentModel ?? delegatedModel;
  const requestedSkills = resolvedAgent.requestedSkills;
  const category = parsed.data.category?.trim();
  const taskTags = buildTaskTags({
    agentId: resolvedAgent.agentId,
    category,
    requestedSkills,
  });
  const requestedTaskId = parsed.data.task_id;
  const requestedSessionId = parsed.data.session_id;
  const existingTask = requestedTaskId ? graph.tasks[requestedTaskId] : null;
  const existingTaskBySession =
    existingTask?.sessionId || !requestedSessionId
      ? null
      : findTaskBySessionId(graph, requestedSessionId);
  const resumableTask = existingTask?.sessionId
    ? existingTask
    : existingTaskBySession?.sessionId
      ? existingTaskBySession
      : null;
  const childSessionId = resumableTask?.sessionId ?? requestedSessionId ?? randomUUID();
  // 子代理嵌套深度限制（对齐上游 `experimental.subagent_depth`，默认 1）。
  // 仅约束「新建子会话」；恢复既有子会话（session_id / task_id 命中）不受限，
  // 否则已完成的任务将无法被继续。
  const isResumingExistingChild = Boolean(resumableTask?.sessionId ?? requestedSessionId);
  if (!isResumingExistingChild) {
    const depthCheck = checkSubagentDepthAllowed({
      parentSessionId: sessionId,
      userId,
    });
    if (!depthCheck.allowed) {
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: depthCheck.message,
        isError: true,
        durationMs: 0,
      };
    }
  }
  const childSessionTitle = `${effectiveTaskDescription} (@${resolvedAgent.agentId})`;
  const childRequestData = buildDelegatedChildRequestData({
    agentId: resolvedAgent.agentId,
    ...(category ? { category } : {}),
    childSessionId,
    executionContext,
    modelSelection: effectiveDelegatedModel,
    prompt: parsed.data.prompt,
    systemPrompt: resolvedAgent.systemPrompt,
  });
  const canExecuteImmediately = childRequestData !== null;
  const shouldRunInBackground = canExecuteImmediately && parsed.data.run_in_background === true;
  const parentToolReference =
    executionContext?.clientRequestId !== undefined
      ? {
          clientRequestId: executionContext.clientRequestId,
          toolCallId: request.toolCallId,
        }
      : undefined;
  // 派发期兜底：子会话被置为 `running` 之后（resume / 新建两条分支），仍有
  // `appendSessionMessage` / `taskManager.save` / `publishSessionRunEvent` 等可抛错的
  // 操作，且整条 task 分支不在任何 try 内。一旦抛错逃出本分支，子会话会永久残留
  // `running`——无执行体、无 reconcile 触发点，持续占用任务树的活跃子代理名额；
  // 任务图里的 task 残留 `running` 还会让后续 resume 被 `isAlreadyRunning` 判成
  // 「仍在运行」而永远无法恢复。因此这里登记已置位的 task id，交由 catch 统一回滚。
  let dispatchedChildTaskId: string | null = null;
  try {
    const childSessionMetadata: Record<string, unknown> = {
      parentSessionId: sessionId,
      subagentType: resolvedAgent.agentId,
      createdByTool: 'task',
      delegatedPromptVersion: 'v2',
      delegatedSystemPrompt: resolvedAgent.systemPrompt,
      delegatedModelCandidates: resolvedAgent.modelCandidates,
      requestedSkills,
    };
    if (effectiveDelegatedModel?.modelId) {
      childSessionMetadata.modelId = effectiveDelegatedModel.modelId;
    }
    if (effectiveDelegatedModel?.providerId) {
      childSessionMetadata.providerId = effectiveDelegatedModel.providerId;
    }
    if (effectiveDelegatedModel?.variant) {
      childSessionMetadata.variant = effectiveDelegatedModel.variant;
    }
    if (parentToolReference) {
      childSessionMetadata[TASK_PARENT_TOOL_REQUEST_ID_KEY] = parentToolReference.clientRequestId;
      childSessionMetadata[TASK_PARENT_TOOL_CALL_ID_KEY] = parentToolReference.toolCallId;
    }
    if (category) {
      childSessionMetadata.taskCategory = category;
    }
    const inheritedWorkingDirectory = parentSessionMetadata.workingDirectory;
    if (typeof inheritedWorkingDirectory === 'string') {
      childSessionMetadata.workingDirectory = inheritedWorkingDirectory;
    }
    const inheritedDialogueMode = parentSessionMetadata.dialogueMode;
    if (typeof inheritedDialogueMode === 'string') {
      childSessionMetadata.dialogueMode = inheritedDialogueMode;
    }
    // 继承权限档位：子代理 session 在后台运行，无法与用户交互审批。
    // permissionMode 是规范键，仅在父会话确实表达过档位时才继承（已写规范键，
    // 或历史布尔 yoloMode === true）——auto-edit 父会话的子会话不得降级为 ask；
    // 父会话未表达时保持缺席（读取侧按 ask 兜底，不凭空写入）。
    // 旧布尔 yoloMode 同步保留，兼容仍直接读取它的历史消费方。
    if (
      parentSessionMetadata.permissionMode !== undefined ||
      parentSessionMetadata.yoloMode === true
    ) {
      childSessionMetadata.permissionMode = resolveSessionPermissionMode(parentSessionMetadata);
    }
    if (parentSessionMetadata.yoloMode === true) {
      childSessionMetadata.yoloMode = true;
    }
    const inheritedUpstreamRetryMaxRetries =
      normalizeUpstreamRetryMaxRetries(childRequestData?.[UPSTREAM_RETRY_MAX_RETRIES_KEY]) ??
      normalizeUpstreamRetryMaxRetries(parentSessionMetadata[UPSTREAM_RETRY_MAX_RETRIES_KEY]);
    if (inheritedUpstreamRetryMaxRetries !== undefined) {
      childSessionMetadata[UPSTREAM_RETRY_MAX_RETRIES_KEY] = inheritedUpstreamRetryMaxRetries;
    }
    const existingChildSession = sqliteGet<{
      id: string;
      metadata_json: string;
    }>('SELECT id, metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1', [
      childSessionId,
      userId,
    ]);
    if (resumableTask?.sessionId && !existingChildSession) {
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: `Existing child session ${childSessionId} was not found for task ${resumableTask.id}`,
        isError: true,
        durationMs: 0,
      };
    }

    const taskSessionLimitError = getTaskSessionLimitError({
      currentSessionId: sessionId,
      excludeActiveSessionId: resumableTask?.sessionId,
      userId,
    });
    if (taskSessionLimitError) {
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: taskSessionLimitError,
        isError: true,
        durationMs: 0,
      };
    }

    if (existingChildSession) {
      let mergedMetadata = childSessionMetadata;
      try {
        const parsedExistingMetadata = JSON.parse(existingChildSession.metadata_json) as Record<
          string,
          unknown
        >;
        mergedMetadata = {
          ...parsedExistingMetadata,
          ...childSessionMetadata,
        };
      } catch {
        mergedMetadata = childSessionMetadata;
      }
      sqliteRun(
        "UPDATE sessions SET metadata_json = ?, title = COALESCE(title, ?), updated_at = datetime('now') WHERE id = ? AND user_id = ?",
        [JSON.stringify(mergedMetadata), childSessionTitle, childSessionId, userId],
      );
    } else {
      sqliteRun(
        `INSERT INTO sessions (id, user_id, messages_json, metadata_json, title) VALUES (?, ?, '[]', ?, ?)`,
        [childSessionId, userId, JSON.stringify(childSessionMetadata), childSessionTitle],
      );
    }

    const buildCurrentTaskOutput = (taskState: {
      assignedAgent?: string;
      errorMessage?: string;
      message?: string;
      result?: string;
      status: string;
      taskId: string;
    }) =>
      buildTaskToolOutput({
        assignedAgent: taskState.assignedAgent ?? resolvedAgent.agentId,
        category,
        errorMessage: taskState.errorMessage,
        message: taskState.message,
        requestedSkills,
        reason: readChildSessionTerminalReason(getSessionMetadata(childSessionId)),
        result: taskState.result,
        sessionId: childSessionId,
        status: mapTaskStatusToToolOutputStatus(taskState.status),
        taskId: taskState.taskId,
        timeoutSource: readChildSessionTimeoutSource(getSessionMetadata(childSessionId)),
      });

    if (resumableTask?.sessionId) {
      const existingChildSessionState = sqliteGet<{ state_status: string }>(
        'SELECT state_status FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [childSessionId, userId],
      );
      const isAlreadyRunning =
        resumableTask.status === 'running' || existingChildSessionState?.state_status === 'running';

      if (isAlreadyRunning) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: buildCurrentTaskOutput({
            assignedAgent: resumableTask.assignedAgent,
            errorMessage: resumableTask.errorMessage,
            message: buildTaskToolBackgroundMessage({
              agent: resumableTask.assignedAgent ?? resolvedAgent.agentId,
              category,
              description: effectiveTaskDescription,
              sessionId: childSessionId,
              status: mapTaskStatusToToolOutputStatus(resumableTask.status),
              taskId: resumableTask.id,
            }),
            result: resumableTask.result,
            status: resumableTask.status,
            taskId: resumableTask.id,
          }),
          isError: false,
          durationMs: 0,
        };
      }

      sqliteRun(
        "UPDATE sessions SET state_status = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
        [canExecuteImmediately ? 'running' : 'idle', childSessionId, userId],
      );
      dispatchedChildTaskId = resumableTask.id;
      if (!childRequestData) {
        appendSessionMessage({
          sessionId: childSessionId,
          userId,
          role: 'user',
          content: [{ type: 'text', text: parsed.data.prompt }],
          clientRequestId: `task:${request.toolCallId}`,
        });
      }

      taskManager.updateTask(graph, resumableTask.id, {
        assignedAgent: resolvedAgent.agentId,
        completedAt: undefined,
        description: parsed.data.prompt,
        errorMessage: undefined,
        result: undefined,
        startedAt: canExecuteImmediately ? Date.now() : resumableTask.startedAt,
        status: canExecuteImmediately ? 'running' : 'pending',
        tags: taskTags,
        title: effectiveTaskDescription,
      });
      await taskManager.save(graph);
      // 写入父会话上下文：子代理中途停下（待批准 / 待回答）时，
      // `task/task-parent-auto-decision.ts` 需要父会话的原始请求数据来构造父级决策请求。
      if (
        shouldRunInBackground &&
        parentToolReference !== undefined &&
        executionContext?.requestData !== undefined
      ) {
        upsertTaskParentContext({
          childSessionId,
          parentSessionId: sessionId,
          requestData: executionContext.requestData,
          taskId: resumableTask.id,
          userId,
        });
      }

      publishSessionRunEvent(sessionId, {
        type: 'task_update',
        taskId: resumableTask.id,
        label: effectiveTaskDescription,
        status: shouldRunInBackground || canExecuteImmediately ? 'in_progress' : 'pending',
        assignedAgent: resolvedAgent.agentId,
        ...(category ? { category } : {}),
        ...(requestedSkills.length > 0 ? { requestedSkills } : {}),
        sessionId: childSessionId,
        parentSessionId: sessionId,
      });

      if (shouldRunInBackground && childRequestData) {
        registerBackgroundChildTask({
          assignedAgent: resolvedAgent.agentId,
          childSessionId,
          parentSessionId: sessionId,
          taskTitle: effectiveTaskDescription,
        });
        setTimeout(() => {
          void runChildTaskSessionInBackground({
            assignedAgent: resolvedAgent.agentId,
            childSessionId,
            childTaskId: resumableTask.id,
            parentToolReference,
            parentSessionId: sessionId,
            requestData: childRequestData,
            requestedSkills,
            taskCategory: category,
            taskTitle: effectiveTaskDescription,
            userId,
          });
        }, 0);
      }

      if (!shouldRunInBackground && childRequestData) {
        await runChildTaskSessionInBackground({
          assignedAgent: resolvedAgent.agentId,
          childSessionId,
          childTaskId: resumableTask.id,
          parentToolReference,
          parentSessionId: sessionId,
          requestData: childRequestData,
          requestedSkills,
          taskCategory: category,
          taskTitle: effectiveTaskDescription,
          userId,
        });
        const refreshedGraph = await loadTaskGraphForSession(taskManager, sessionId);
        const refreshedTask = refreshedGraph.tasks[resumableTask.id] ?? resumableTask;
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: buildCurrentTaskOutput({
            assignedAgent: refreshedTask.assignedAgent,
            errorMessage: refreshedTask.errorMessage,
            message: buildTaskToolTerminalMessage({
              agent: refreshedTask.assignedAgent ?? resolvedAgent.agentId,
              category,
              completedAt: refreshedTask.completedAt,
              errorMessage: refreshedTask.errorMessage,
              // 对齐参考库前台路径（`SubagentCompletion.text`）：只回传子代理最后一条
              // assistant 文本，不再把整个子会话的文本 + 工具输出全量拼进父会话。
              resultText: getChildSessionSummary(childSessionId, userId) || refreshedTask.result,
              sessionId: childSessionId,
              startedAt: refreshedTask.startedAt,
              status:
                refreshedTask.status === 'failed'
                  ? 'failed'
                  : refreshedTask.status === 'cancelled'
                    ? 'cancelled'
                    : 'done',
            }),
            result: refreshedTask.result,
            status: refreshedTask.status,
            taskId: refreshedTask.id,
          }),
          isError: refreshedTask.status === 'failed',
          durationMs: 0,
        };
      }

      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: buildCurrentTaskOutput({
          assignedAgent: resolvedAgent.agentId,
          message: buildTaskToolBackgroundMessage({
            agent: resolvedAgent.agentId,
            category,
            description: effectiveTaskDescription,
            sessionId: childSessionId,
            status: shouldRunInBackground || canExecuteImmediately ? 'running' : 'pending',
            taskId: resumableTask.id,
          }),
          status: shouldRunInBackground || canExecuteImmediately ? 'running' : 'pending',
          taskId: resumableTask.id,
        }),
        isError: false,
        durationMs: 0,
      };
    }

    sqliteRun(
      "UPDATE sessions SET state_status = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
      [canExecuteImmediately ? 'running' : 'idle', childSessionId, userId],
    );
    if (!childRequestData) {
      appendSessionMessage({
        sessionId: childSessionId,
        userId,
        role: 'user',
        content: [{ type: 'text', text: parsed.data.prompt }],
        clientRequestId: `task:${request.toolCallId}`,
      });
    }

    const childTask = taskManager.addTask(graph, {
      title: effectiveTaskDescription,
      description: parsed.data.prompt,
      status: 'pending',
      blockedBy: [],
      sessionId: childSessionId,
      assignedAgent: resolvedAgent.agentId,
      priority: 'medium',
      tags: taskTags,
      clientRequestId:
        resolveTaskGraphTurnClientRequestId(sessionId, executionContext) ?? undefined,
    });
    dispatchedChildTaskId = childTask.id;
    if (canExecuteImmediately) {
      taskManager.startTask(graph, childTask.id);
    }
    await taskManager.save(graph);
    // 同上前置条件：为父级决策路径留存父会话原始请求数据。
    if (
      shouldRunInBackground &&
      parentToolReference !== undefined &&
      executionContext?.requestData !== undefined
    ) {
      upsertTaskParentContext({
        childSessionId,
        parentSessionId: sessionId,
        requestData: executionContext.requestData,
        taskId: childTask.id,
        userId,
      });
    }

    publishSessionRunEvent(sessionId, {
      type: 'session_child',
      sessionId: childSessionId,
      parentSessionId: sessionId,
      title: childSessionTitle,
    });
    publishSessionRunEvent(sessionId, {
      type: 'task_update',
      taskId: childTask.id,
      label: effectiveTaskDescription,
      status: shouldRunInBackground ? 'in_progress' : 'pending',
      assignedAgent: resolvedAgent.agentId,
      ...(category ? { category } : {}),
      ...(requestedSkills.length > 0 ? { requestedSkills } : {}),
      sessionId: childSessionId,
      parentSessionId: sessionId,
    });

    if (shouldRunInBackground && childRequestData) {
      registerBackgroundChildTask({
        assignedAgent: resolvedAgent.agentId,
        childSessionId,
        parentSessionId: sessionId,
        taskTitle: effectiveTaskDescription,
      });
      setTimeout(() => {
        void runChildTaskSessionInBackground({
          assignedAgent: resolvedAgent.agentId,
          childSessionId,
          childTaskId: childTask.id,
          parentToolReference,
          parentSessionId: sessionId,
          requestData: childRequestData,
          requestedSkills,
          taskCategory: category,
          taskTitle: effectiveTaskDescription,
          userId,
        });
      }, 0);
    }

    if (!shouldRunInBackground && childRequestData) {
      await runChildTaskSessionInBackground({
        assignedAgent: resolvedAgent.agentId,
        childSessionId,
        childTaskId: childTask.id,
        parentToolReference,
        parentSessionId: sessionId,
        requestData: childRequestData,
        requestedSkills,
        taskCategory: category,
        taskTitle: effectiveTaskDescription,
        userId,
      });
      const refreshedGraph = await loadTaskGraphForSession(taskManager, sessionId);
      const refreshedTask = refreshedGraph.tasks[childTask.id] ?? childTask;
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: buildTaskToolOutput({
          assignedAgent: refreshedTask.assignedAgent ?? resolvedAgent.agentId,
          category,
          errorMessage: refreshedTask.errorMessage,
          message: buildTaskToolTerminalMessage({
            agent: refreshedTask.assignedAgent ?? resolvedAgent.agentId,
            category,
            completedAt: refreshedTask.completedAt,
            errorMessage: refreshedTask.errorMessage,
            // 对齐参考库前台路径：只回传子代理最后一条 assistant 文本，
            // 不再全量拼接子会话文本与工具输出（防父会话上下文膨胀）。
            resultText: getChildSessionSummary(childSessionId, userId) || refreshedTask.result,
            sessionId: childSessionId,
            startedAt: refreshedTask.startedAt,
            status:
              refreshedTask.status === 'failed'
                ? 'failed'
                : refreshedTask.status === 'cancelled'
                  ? 'cancelled'
                  : 'done',
          }),
          requestedSkills,
          reason: readChildSessionTerminalReason(getSessionMetadata(childSessionId)),
          result: refreshedTask.result,
          sessionId: childSessionId,
          status: mapTaskStatusToToolOutputStatus(refreshedTask.status),
          taskId: refreshedTask.id,
          timeoutSource: readChildSessionTimeoutSource(getSessionMetadata(childSessionId)),
        }),
        isError: refreshedTask.status === 'failed',
        durationMs: 0,
      };
    }

    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: buildTaskToolOutput({
        assignedAgent: resolvedAgent.agentId,
        category,
        message: buildTaskToolBackgroundMessage({
          agent: resolvedAgent.agentId,
          category,
          description: effectiveTaskDescription,
          sessionId: childSessionId,
          status: shouldRunInBackground ? 'running' : 'pending',
          taskId: childTask.id,
        }),
        requestedSkills,
        sessionId: childSessionId,
        status: shouldRunInBackground ? 'running' : 'pending',
        taskId: childTask.id,
      }),
      isError: false,
      durationMs: 0,
    };
  } catch (error) {
    // 回滚派发期残留：优先走 finalize 以同时归位子会话状态并结算 task；
    // 任务图本身读不了（可能正是本次失败原因）时，至少把子会话从 `running` 归位。
    try {
      if (dispatchedChildTaskId !== null) {
        await finalizeChildTaskRunSafely({
          assignedAgent: resolvedAgent.agentId,
          childSessionId,
          childTaskId: dispatchedChildTaskId,
          ...(parentToolReference ? { parentToolReference } : {}),
          parentSessionId: sessionId,
          ...(requestedSkills ? { requestedSkills } : {}),
          result: {
            pendingInteraction: false,
            statusCode: 500,
            summary: `子代理派发失败：${error instanceof Error ? error.message : String(error)}`,
          },
          ...(category ? { taskCategory: category } : {}),
          taskManager,
          taskTitle: effectiveTaskDescription,
          userId,
        });
      } else {
        releaseChildSessionActiveSlot({ childSessionId, userId });
      }
    } catch (rollbackError) {
      releaseChildSessionActiveSlot({ childSessionId, userId });
      logGatewayWarn(
        `[task] 子代理派发失败回滚未完成（childSessionId=${childSessionId}）：${
          rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
        }`,
      );
    }

    throw error;
  }
}
