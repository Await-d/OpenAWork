import { randomUUID } from 'node:crypto';
import fs from 'fs/promises';
import path from 'path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { CommandExecutionResult, Message } from '@openAwork/shared';
import {
  AgentTaskManagerImpl,
  DirectoryAgentsInjectorImpl,
  RalphLoopImpl,
  SlashCommandRouterImpl,
  buildHandoffDocument,
  createContextCompactor,
  formatHandoffMarkdown,
} from '@openAwork/agent-core';
import { z } from 'zod';
import type { JwtPayload } from '../auth.js';
import { requireAuth } from '../auth.js';
import { WORKSPACE_ROOT, sqliteGet, sqliteRun } from '../db.js';
import { appendSessionMessage, listSessionMessages } from '../session-message-store.js';
import { startRequestWorkflow } from '../request-workflow.js';
import { parseUlwVerifyDecision } from './command-helpers.js';
import { buildCommandDescriptors } from './command-descriptors.js';
import {
  clearActiveLoopMetadata,
  clearPersistedLoopState,
  clearUlwLoopMetadata,
  hasPersistedLoopState,
  readActiveLoopState,
  readPersistedLoopStateForSession,
  readUlwVerificationPendingTaskId,
  resolveRequestedWorktree,
  scheduleLoopExecution,
  stopActiveLoopExecution,
} from './command-loop-runtime.js';
import {
  buildStartWorkTaskTags,
  createTaskUpdateEvent,
  createWorkflowPlanSubtasks,
  findReusableStartWorkTask,
  listWorkflowPlanSubtasks,
  toTaskUpdateStatus,
} from './start-work-subtasks.js';

const textContentSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

const toolCallContentSchema = z.object({
  type: z.literal('tool_call'),
  toolCallId: z.string(),
  toolName: z.string(),
  input: z.record(z.unknown()),
});

const toolResultContentSchema = z.object({
  type: z.literal('tool_result'),
  toolCallId: z.string(),
  output: z.unknown(),
  isError: z.boolean(),
});

const messageSnapshotSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'tool', 'system']),
  content: z.array(z.union([textContentSchema, toolCallContentSchema, toolResultContentSchema])),
  createdAt: z.number(),
});

const executeCommandSchema = z.object({
  commandId: z.string().min(1),
  messages: z.array(messageSnapshotSchema).optional(),
  rawInput: z.string().trim().min(1).optional(),
});

interface SessionRow {
  id: string;
  user_id: string;
  messages_json: string;
  metadata_json: string;
}

const taskManager = new AgentTaskManagerImpl();

export async function commandsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/commands',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'command.list');
      const commands = buildCommandDescriptors();
      step.succeed(undefined, { count: commands.length });
      return reply.send({ commands });
    },
  );

  app.post(
    '/sessions/:sessionId/commands/execute',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params as { sessionId: string };
      const { step } = startRequestWorkflow(request, 'command.execute', undefined, { sessionId });
      const body = executeCommandSchema.safeParse(request.body);

      if (!body.success) {
        step.fail('invalid input');
        return reply.status(400).send({ error: 'Invalid input', issues: body.error.issues });
      }

      const session = sqliteGet<SessionRow>(
        'SELECT id, user_id, messages_json, metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [sessionId, user.sub],
      );

      if (!session) {
        step.fail('session not found');
        return reply.status(404).send({ error: 'Session not found' });
      }

      const command = buildCommandDescriptors().find((item) => item.id === body.data.commandId);
      if (!command || command.execution !== 'server') {
        step.fail('unsupported command');
        return reply.status(400).send({ error: 'Unsupported command' });
      }

      const storedMessages = listSessionMessages({
        sessionId,
        userId: user.sub,
        legacyMessagesJson: session.messages_json,
      });
      const messages =
        storedMessages.length > 0
          ? storedMessages
          : body.data.messages
            ? normalizeMessageSnapshots(body.data.messages)
            : storedMessages;
      const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, sessionId);

      const cmdParams = {
        args: extractCommandArgs(body.data.rawInput, command.label),
        commandId: command.id,
        graph,
        messages,
        metadataJson: session.metadata_json,
        messagesJson: session.messages_json,
        rawInput: body.data.rawInput,
        sessionId,
        userId: user.sub,
      };

      let result: CommandExecutionResult;
      switch (command.action.kind) {
        case 'compact_session':
          result = await executeCompactCommand(cmdParams);
          break;
        case 'init_deep':
          result = await executeInitDeepCommand(cmdParams);
          break;
        case 'start_ralph_loop':
          result = await executeRalphLoopCommand(cmdParams);
          break;
        case 'start_ulw_loop':
          result = await executeUlwLoopCommand(cmdParams);
          break;
        case 'verify_ulw_loop':
          result = await executeUlwVerifyCommand(cmdParams);
          break;
        case 'cancel_ralph_loop':
          result = await executeCancelRalphCommand(cmdParams);
          break;
        case 'stop_continuation':
          result = await executeStopContinuationCommand(cmdParams);
          break;
        case 'refactor_session':
          result = await executeRefactorCommand(cmdParams);
          break;
        case 'start_work':
          result = await executeStartWorkCommand(cmdParams);
          break;
        case 'generate_handoff':
          result = await executeHandoffCommand(cmdParams);
          break;
        default:
          step.fail('unsupported action');
          return reply.status(400).send({ error: 'Unsupported command action' });
      }

      step.succeed(undefined, { commandId: command.id });
      return reply.send({ result });
    },
  );
}

async function executeCompactCommand(params: {
  args: string[];
  commandId: string;
  graph: Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>;
  messages: Message[];
  metadataJson: string;
  messagesJson: string;
  rawInput?: string;
  sessionId: string;
  userId: string;
}): Promise<CommandExecutionResult> {
  const task = taskManager.addTask(params.graph, {
    title: '压缩会话',
    description: '执行 /compact 命令并生成摘要卡片',
    status: 'pending',
    blockedBy: [],
    sessionId: params.sessionId,
    priority: 'medium',
    tags: ['command', 'compaction'],
  });
  taskManager.startTask(params.graph, task.id);
  const compactor = createContextCompactor({
    summarize: async (items) => summarizeMessages(items),
  });
  const compacted = await compactor.compact(params.messages, 'summarize');
  const summary = extractMessageText(compacted[0]) || '当前会话已压缩。';
  const metadata = mergeCompactionMetadata(params.metadataJson, summary);
  const card = {
    type: 'compaction' as const,
    title: '会话已压缩',
    summary,
    trigger: 'manual' as const,
  };
  const storedMessages = appendCommandCardArtifacts({
    sessionId: params.sessionId,
    userId: params.userId,
    messagesJson: params.messagesJson,
    card,
  });

  sqliteRun(
    "UPDATE sessions SET messages_json = ?, metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [JSON.stringify(storedMessages), JSON.stringify(metadata), params.sessionId, params.userId],
  );
  taskManager.completeTask(params.graph, task.id, summary);
  await taskManager.save(params.graph);

  return {
    sessionId: params.sessionId,
    events: [
      {
        type: 'task_update',
        taskId: task.id,
        label: task.title,
        status: 'done',
        sessionId: params.sessionId,
        parentTaskId: task.parentTaskId,
        eventId: `${params.sessionId}:${task.id}:task`,
        runId: `command:${params.sessionId}:${params.commandId}`,
        occurredAt: Date.now(),
      },
      {
        type: 'compaction',
        summary,
        trigger: 'manual',
        runId: `command:${params.sessionId}:${params.commandId}`,
        eventId: `${params.sessionId}:${params.commandId}:compaction`,
        occurredAt: Date.now(),
      },
    ],
    card,
  };
}

async function executeHandoffCommand(params: {
  args: string[];
  commandId: string;
  graph: Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>;
  messages: Message[];
  metadataJson: string;
  messagesJson: string;
  rawInput?: string;
  sessionId: string;
  userId: string;
}): Promise<CommandExecutionResult> {
  const tasks = Object.values(params.graph.tasks)
    .filter((task) => task.sessionId === params.sessionId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const workflowPlan = await findLatestWorkflowPlan(WORKSPACE_ROOT);

  if (!hasMeaningfulHandoffContext(params.messages, tasks, workflowPlan)) {
    return {
      sessionId: params.sessionId,
      events: [],
      card: {
        type: 'status',
        title: 'Handoff unavailable',
        message: '当前会话没有足够的有效上下文，暂时无需生成交接摘要。',
        tone: 'warning',
      },
    };
  }

  const completedTasks = tasks.filter((task) => task.status === 'completed');
  const activeTasks = tasks.filter(
    (task) => task.status === 'pending' || task.status === 'running',
  );
  const doc = buildHandoffDocument({
    sessionId: params.sessionId,
    title: 'Handoff Context',
    goal: extractLatestUserGoal(params.messages),
    summary: summarizeMessages(params.messages),
    currentState: [
      `会话任务：已完成 ${completedTasks.length} 项，进行中/待处理 ${activeTasks.length} 项。`,
      workflowPlan
        ? `工作计划：${workflowPlan.title}（${workflowPlan.completed}/${workflowPlan.total}）`
        : '当前没有检测到未完成的工作计划文件。',
    ],
    completedItems: completedTasks.map((task) => task.title),
    pendingItems: activeTasks.map((task) => task.title),
    keyFiles: workflowPlan ? [workflowPlan.relativePath] : [],
    keyDecisions: extractKeyDecisions(params.messages),
    continuationHints: buildHandoffContinuationHints(workflowPlan),
    nextSteps: extractNextSteps(tasks),
  });
  const markdown = formatHandoffMarkdown(doc);
  const metadata = mergeHandoffMetadata(params.metadataJson, markdown);
  const card = {
    type: 'status' as const,
    title: 'Handoff context ready（交接上下文已生成）',
    message: markdown,
    tone: 'info' as const,
  };
  const storedMessages = appendCommandCardArtifacts({
    sessionId: params.sessionId,
    userId: params.userId,
    messagesJson: params.messagesJson,
    card,
  });

  sqliteRun(
    "UPDATE sessions SET messages_json = ?, metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [JSON.stringify(storedMessages), JSON.stringify(metadata), params.sessionId, params.userId],
  );

  return {
    sessionId: params.sessionId,
    events: [
      {
        type: 'audit_ref',
        auditLogId: `${params.sessionId}:${params.commandId}:handoff`,
        eventId: `${params.sessionId}:${params.commandId}:handoff`,
        runId: `command:${params.sessionId}:${params.commandId}`,
        occurredAt: Date.now(),
      },
    ],
    card,
  };
}

async function executeInitDeepCommand(params: {
  args: string[];
  commandId: string;
  graph: Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>;
  messages: Message[];
  metadataJson: string;
  messagesJson: string;
  rawInput?: string;
  sessionId: string;
  userId: string;
}): Promise<CommandExecutionResult> {
  const injector = new DirectoryAgentsInjectorImpl();
  const entries = await injector.collectAllAgentsFiles(WORKSPACE_ROOT, WORKSPACE_ROOT);
  const injectionBlock = injector.buildInjectionBlock(entries);
  const fileCount = entries.length;
  const summary =
    fileCount > 0
      ? `已注入 ${fileCount} 个 AGENTS.md 上下文文件到会话。`
      : '未找到 AGENTS.md 文件，会话上下文未更新。';

  const metadata = mergeMetadata(params.metadataJson, {
    initDeepContext: injectionBlock,
    initDeepFileCount: fileCount,
    initDeepAt: Date.now(),
  });
  const card = {
    type: 'status' as const,
    title: '/init-deep 完成',
    message: `${summary}\n\n注入内容摘要（前 300 字符）：\n${injectionBlock.slice(0, 300)}${injectionBlock.length > 300 ? '…' : ''}`,
    tone: 'info' as const,
  };
  const storedMessages = appendCommandCardArtifacts({
    sessionId: params.sessionId,
    userId: params.userId,
    messagesJson: params.messagesJson,
    card,
  });
  sqliteRun(
    "UPDATE sessions SET messages_json = ?, metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [JSON.stringify(storedMessages), JSON.stringify(metadata), params.sessionId, params.userId],
  );
  return {
    sessionId: params.sessionId,
    events: [
      {
        type: 'audit_ref',
        auditLogId: `${params.sessionId}:${params.commandId}:init-deep`,
        eventId: `${params.sessionId}:${params.commandId}:init-deep`,
        runId: `command:${params.sessionId}:${params.commandId}`,
        occurredAt: Date.now(),
      },
    ],
    card,
  };
}

async function executeRalphLoopCommand(params: {
  args: string[];
  commandId: string;
  graph: Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>;
  messages: Message[];
  metadataJson: string;
  messagesJson: string;
  rawInput?: string;
  sessionId: string;
  userId: string;
}): Promise<CommandExecutionResult> {
  const existingLoop = readActiveLoopState(params.metadataJson);
  if (existingLoop) {
    return {
      sessionId: params.sessionId,
      events: [],
      card: {
        type: 'status',
        title: '/ralph-loop unavailable',
        message: `当前已有活动中的 ${existingLoop.kind} 循环（任务 ID：${existingLoop.taskId ?? '未知'}）。请先执行 /cancel-ralph。`,
        tone: 'warning',
      },
    };
  }

  const loop = new RalphLoopImpl();
  const startedAt = Date.now();
  const parsedArgs = parseCommandArgs(params.args);
  const completionPromise = parseStringOption(parsedArgs.named['completion-promise']) ?? 'DONE';
  const maxIterations = parsePositiveInteger(parsedArgs.named['max-iterations']) ?? 100;
  const strategy = parseLoopStrategy(parsedArgs.named['strategy']);
  const target = parsedArgs.positional.join(' ') || '当前会话任务';
  const metadata = mergeMetadata(params.metadataJson, {
    activeLoopKind: 'ralph',
    activeLoopTaskDescription: target,
    ralphLoopActive: true,
    ralphLoopStartedAt: startedAt,
    ralphLoopCompletionPromise: completionPromise,
    ralphLoopMaxIterations: maxIterations,
    ralphLoopStrategy: strategy,
  });
  const task = taskManager.addTask(params.graph, {
    title: 'Ralph Loop',
    description: `启动 Ralph 自指开发循环（最多 ${maxIterations} 轮）：${target}`,
    status: 'pending',
    blockedBy: [],
    sessionId: params.sessionId,
    priority: 'high',
    tags: ['ralph-loop', 'autonomous'],
  });
  taskManager.startTask(params.graph, task.id);
  await taskManager.save(params.graph);
  const status = loop.getStatus();
  metadata['activeLoopTaskId'] = task.id;
  metadata['ralphLoopTaskId'] = task.id;
  const card = {
    type: 'status' as const,
    title: '/ralph-loop 已启动',
    message: `Ralph Loop 已按参考语义登记。\n任务：${target}\n完成信号：<promise>${completionPromise}</promise>\n最大迭代：${maxIterations}\n策略：${strategy}\n当前状态：${status.running ? '运行中' : '待启动'}\n任务 ID：${task.id}`,
    tone: 'info' as const,
  };
  const storedMessages = appendCommandCardArtifacts({
    sessionId: params.sessionId,
    userId: params.userId,
    messagesJson: params.messagesJson,
    card,
  });
  sqliteRun(
    "UPDATE sessions SET messages_json = ?, metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [JSON.stringify(storedMessages), JSON.stringify(metadata), params.sessionId, params.userId],
  );
  scheduleLoopExecution({
    completionPromise,
    kind: 'ralph',
    maxIterations,
    sessionId: params.sessionId,
    strategy,
    target,
    taskId: task.id,
    taskTitle: task.title,
    userId: params.userId,
    workspaceRoot: WORKSPACE_ROOT,
    taskManager,
    summarizeMessages,
    extractLatestUserGoal,
    findLatestWorkflowPlan,
  });
  return {
    sessionId: params.sessionId,
    events: [
      {
        type: 'task_update',
        taskId: task.id,
        label: task.title,
        status: 'in_progress',
        sessionId: params.sessionId,
        parentTaskId: task.parentTaskId,
        eventId: `${params.sessionId}:${task.id}:task`,
        runId: `command:${params.sessionId}:${params.commandId}`,
        occurredAt: startedAt,
      },
    ],
    card,
  };
}

async function executeUlwLoopCommand(params: {
  args: string[];
  commandId: string;
  graph: Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>;
  messages: Message[];
  metadataJson: string;
  messagesJson: string;
  rawInput?: string;
  sessionId: string;
  userId: string;
}): Promise<CommandExecutionResult> {
  const existingLoop = readActiveLoopState(params.metadataJson);
  if (existingLoop) {
    return {
      sessionId: params.sessionId,
      events: [],
      card: {
        type: 'status',
        title: '/ulw-loop unavailable',
        message: `当前已有活动中的 ${existingLoop.kind} 循环（任务 ID：${existingLoop.taskId ?? '未知'}）。请先执行 /cancel-ralph。`,
        tone: 'warning',
      },
    };
  }

  const startedAt = Date.now();
  const parsedArgs = parseCommandArgs(params.args);
  const completionPromise = parseStringOption(parsedArgs.named['completion-promise']) ?? 'DONE';
  const strategy = parseLoopStrategy(parsedArgs.named['strategy']);
  const target = parsedArgs.positional.join(' ') || '当前会话任务';
  const metadata = mergeMetadata(params.metadataJson, {
    activeLoopKind: 'ulw',
    activeLoopTaskDescription: target,
    ulwLoopActive: true,
    ulwLoopStartedAt: startedAt,
    ultraworkMode: true,
    ulwLoopCompletionPromise: completionPromise,
    ulwLoopVerificationRequired: true,
    ulwLoopStrategy: strategy,
  });
  const task = taskManager.addTask(params.graph, {
    title: 'UltraWork Loop',
    description: `启动 UltraWork 循环（ultrawork 模式，持续执行至完成）：${target}`,
    status: 'pending',
    blockedBy: [],
    sessionId: params.sessionId,
    priority: 'high',
    tags: ['ulw-loop', 'ultrawork', 'autonomous'],
  });
  taskManager.startTask(params.graph, task.id);
  await taskManager.save(params.graph);
  metadata['activeLoopTaskId'] = task.id;
  metadata['ulwLoopTaskId'] = task.id;
  const card = {
    type: 'status' as const,
    title: '/ulw-loop 已启动',
    message: `UltraWork Loop 已按参考语义登记。\n任务：${target}\n阶段一完成信号：<promise>${completionPromise}</promise>\n阶段二验证信号：<promise>VERIFIED</promise>\n策略：${strategy}\n迭代上限：参考语义为 unbounded\n任务 ID：${task.id}`,
    tone: 'info' as const,
  };
  const storedMessages = appendCommandCardArtifacts({
    sessionId: params.sessionId,
    userId: params.userId,
    messagesJson: params.messagesJson,
    card,
  });
  sqliteRun(
    "UPDATE sessions SET messages_json = ?, metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [JSON.stringify(storedMessages), JSON.stringify(metadata), params.sessionId, params.userId],
  );
  scheduleLoopExecution({
    completionPromise,
    kind: 'ulw',
    maxIterations: Math.max(2, parsePositiveInteger(parsedArgs.named['max-iterations']) ?? 2),
    sessionId: params.sessionId,
    strategy,
    target,
    taskId: task.id,
    taskTitle: task.title,
    userId: params.userId,
    workspaceRoot: WORKSPACE_ROOT,
    taskManager,
    summarizeMessages,
    extractLatestUserGoal,
    findLatestWorkflowPlan,
  });
  return {
    sessionId: params.sessionId,
    events: [
      {
        type: 'task_update',
        taskId: task.id,
        label: task.title,
        status: 'in_progress',
        sessionId: params.sessionId,
        parentTaskId: task.parentTaskId,
        eventId: `${params.sessionId}:${task.id}:task`,
        runId: `command:${params.sessionId}:${params.commandId}`,
        occurredAt: startedAt,
      },
    ],
    card,
  };
}

async function executeCancelRalphCommand(params: {
  args: string[];
  commandId: string;
  graph: Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>;
  messages: Message[];
  metadataJson: string;
  messagesJson: string;
  rawInput?: string;
  sessionId: string;
  userId: string;
}): Promise<CommandExecutionResult> {
  const activeLoop = readActiveLoopState(params.metadataJson);
  if (!activeLoop) {
    if (hasPersistedLoopState(WORKSPACE_ROOT, params.sessionId)) {
      clearPersistedLoopState(WORKSPACE_ROOT, params.sessionId);
      return {
        sessionId: params.sessionId,
        events: [],
        card: {
          type: 'status',
          title: '/cancel-ralph 已执行',
          message: '未检测到活动 loop metadata，但已清理残留的 Ralph Loop state file。',
          tone: 'info',
        },
      };
    }

    return {
      sessionId: params.sessionId,
      events: [],
      card: {
        type: 'status',
        title: '/cancel-ralph 无操作',
        message: '当前会话没有活动中的 Ralph/ULW 循环。',
        tone: 'warning',
      },
    };
  }

  const loopTask = activeLoop.taskId ? params.graph.tasks[activeLoop.taskId] : undefined;
  stopActiveLoopExecution(params.sessionId);
  const didCancelTask = Boolean(
    loopTask &&
    loopTask.status !== 'completed' &&
    loopTask.status !== 'failed' &&
    loopTask.status !== 'cancelled',
  );
  if (
    loopTask &&
    loopTask.status !== 'completed' &&
    loopTask.status !== 'failed' &&
    loopTask.status !== 'cancelled'
  ) {
    taskManager.cancelTask(params.graph, loopTask.id);
    await taskManager.save(params.graph);
  }

  const metadata = clearUlwLoopMetadata(params.metadataJson);
  clearPersistedLoopState(WORKSPACE_ROOT, params.sessionId);
  const cardMessage = didCancelTask
    ? `已取消当前 ${activeLoop.kind} 循环。${activeLoop.taskId ? `\n任务 ID：${activeLoop.taskId}` : ''}`
    : `已清理当前 ${activeLoop.kind} 的活动标记，但没有正在运行的任务需要取消。${activeLoop.taskId ? `\n任务 ID：${activeLoop.taskId}` : ''}`;
  const card = {
    type: 'status' as const,
    title: '/cancel-ralph 已执行',
    message: cardMessage,
    tone: 'info' as const,
  };
  const storedMessages = appendCommandCardArtifacts({
    sessionId: params.sessionId,
    userId: params.userId,
    messagesJson: params.messagesJson,
    card,
  });
  sqliteRun(
    "UPDATE sessions SET messages_json = ?, metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [JSON.stringify(storedMessages), JSON.stringify(metadata), params.sessionId, params.userId],
  );

  return {
    sessionId: params.sessionId,
    events:
      didCancelTask && loopTask
        ? [
            {
              type: 'task_update',
              taskId: loopTask.id,
              label: loopTask.title,
              status: 'cancelled',
              sessionId: params.sessionId,
              parentTaskId: loopTask.parentTaskId,
              eventId: `${params.sessionId}:${loopTask.id}:cancelled`,
              runId: `command:${params.sessionId}:${params.commandId}`,
              occurredAt: Date.now(),
            },
          ]
        : [],
    card,
  };
}

async function executeStopContinuationCommand(params: {
  args: string[];
  commandId: string;
  graph: Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>;
  messages: Message[];
  metadataJson: string;
  messagesJson: string;
  rawInput?: string;
  sessionId: string;
  userId: string;
}): Promise<CommandExecutionResult> {
  const activeLoop = readActiveLoopState(params.metadataJson);
  stopActiveLoopExecution(params.sessionId);
  clearPersistedLoopState(WORKSPACE_ROOT, params.sessionId);
  const metadata =
    activeLoop?.kind === 'ULW Loop' || readUlwVerificationPendingTaskId(params.metadataJson)
      ? clearUlwLoopMetadata(params.metadataJson)
      : clearActiveLoopMetadata(params.metadataJson);
  const activeTask = activeLoop?.taskId ? params.graph.tasks[activeLoop.taskId] : undefined;
  let events: CommandExecutionResult['events'] = [];

  if (activeTask) {
    if (
      activeTask.status !== 'completed' &&
      activeTask.status !== 'failed' &&
      activeTask.status !== 'cancelled'
    ) {
      taskManager.cancelTask(params.graph, activeTask.id);
      await taskManager.save(params.graph);
      events = createCancelledTaskEvent(
        params.graph,
        activeTask.id,
        params.sessionId,
        params.commandId,
      );
    }
  }

  const card = {
    type: 'status' as const,
    title: '/stop-continuation 已执行',
    message: '已停止当前 continuation 机制（当前覆盖 Ralph/ULW loop），并清理相关状态。',
    tone: 'info' as const,
  };
  const storedMessages = appendCommandCardArtifacts({
    sessionId: params.sessionId,
    userId: params.userId,
    messagesJson: params.messagesJson,
    card,
  });
  sqliteRun(
    "UPDATE sessions SET messages_json = ?, metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [JSON.stringify(storedMessages), JSON.stringify(metadata), params.sessionId, params.userId],
  );

  return {
    sessionId: params.sessionId,
    events,
    card,
  };
}

async function executeUlwVerifyCommand(params: {
  args: string[];
  commandId: string;
  graph: Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>;
  messages: Message[];
  metadataJson: string;
  messagesJson: string;
  rawInput?: string;
  sessionId: string;
  userId: string;
}): Promise<CommandExecutionResult> {
  const parsedArgs = parseCommandArgs(params.args);
  const verifyDecision = parseUlwVerifyDecision(parsedArgs);
  const persistedState = readPersistedLoopStateForSession(WORKSPACE_ROOT, params.sessionId);
  const activeLoop = readActiveLoopState(params.metadataJson);
  const pendingVerificationTaskId = readUlwVerificationPendingTaskId(params.metadataJson);
  const persistedTaskId = persistedState?.task_id;
  const activeTaskId = activeLoop?.taskId;
  const recoverableState = resolveRecoverableUlwTask({
    activeTaskId,
    graph: params.graph,
    persistedTaskId,
    sessionId: params.sessionId,
  });
  const taskIdMismatch =
    activeTaskId !== undefined && persistedTaskId !== undefined && activeTaskId !== persistedTaskId;
  const loopTask = recoverableState.task;
  const effectivePersistedState =
    persistedState ??
    (pendingVerificationTaskId !== undefined &&
    loopTask &&
    pendingVerificationTaskId === loopTask.id
      ? buildFallbackUlwVerifyState(params.sessionId, loopTask)
      : undefined);

  if (!effectivePersistedState?.verification_pending || !effectivePersistedState.ultrawork) {
    if (activeLoop?.kind === 'ULW Loop' && recoverableState.reason === 'missing') {
      const cleanedMetadata = clearUlwLoopMetadata(params.metadataJson);
      clearPersistedLoopState(WORKSPACE_ROOT, params.sessionId);
      sqliteRun(
        "UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
        [JSON.stringify(cleanedMetadata), params.sessionId, params.userId],
      );
    }

    return {
      sessionId: params.sessionId,
      events: [],
      card: {
        type: 'status',
        title: '/ulw-verify unavailable',
        message: '当前会话没有等待验证的 ULW 状态。',
        tone: 'warning',
      },
    };
  }

  if (!loopTask) {
    if (recoverableState.reason === 'ambiguous') {
      return {
        sessionId: params.sessionId,
        events: [],
        card: {
          type: 'status',
          title: '/ulw-verify unavailable',
          message:
            '检测到多个可恢复的 ULW 任务，无法自动确定验证目标；请先清理多余 continuation 状态。',
          tone: 'warning',
        },
      };
    }

    const cleanedMetadata = clearUlwLoopMetadata(params.metadataJson);
    clearPersistedLoopState(WORKSPACE_ROOT, params.sessionId);
    sqliteRun(
      "UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
      [JSON.stringify(cleanedMetadata), params.sessionId, params.userId],
    );
    return {
      sessionId: params.sessionId,
      events: [],
      card: {
        type: 'status',
        title: '/ulw-verify unavailable',
        message: 'ULW 验证状态仍在，但关联任务已丢失；已清理残留状态。',
        tone: 'warning',
      },
    };
  }

  if (taskIdMismatch) {
    appendSessionMessage({
      sessionId: params.sessionId,
      userId: params.userId,
      role: 'system',
      content: [
        {
          type: 'text',
          text: `ULW verify recovered task selection. persisted=${persistedTaskId ?? 'none'}, metadata=${activeTaskId ?? 'none'}.`,
        },
      ],
      legacyMessagesJson: params.messagesJson,
      clientRequestId: `ulw-verify:${params.sessionId}:recovered-task-id`,
    });
  }

  if (!verifyDecision.decision) {
    return {
      sessionId: params.sessionId,
      events: [],
      card: {
        type: 'status',
        title: '/ulw-verify 参数无效',
        message: '请使用 /ulw-verify --pass [说明] 或 /ulw-verify --fail [原因]。',
        tone: 'warning',
      },
    };
  }

  const explanation = verifyDecision.note;

  const metadata = clearUlwLoopMetadata(params.metadataJson);
  let events: CommandExecutionResult['events'];
  let card: CommandExecutionResult['card'];

  if (verifyDecision.decision === 'pass') {
    const didTransition =
      loopTask.status !== 'completed' &&
      loopTask.status !== 'failed' &&
      loopTask.status !== 'cancelled';
    const resultText = [
      '<promise>VERIFIED</promise>',
      'ULW verification passed.',
      explanation ? `Review note: ${explanation}` : null,
      `Original task: ${effectivePersistedState.prompt}`,
    ]
      .filter((line): line is string => Boolean(line))
      .join('\n');

    if (didTransition) {
      taskManager.completeTask(params.graph, loopTask.id, resultText);
      await taskManager.save(params.graph);
    }

    card = {
      type: 'status',
      title: '/ulw-verify 已通过',
      message: explanation ? `ULW 验证已通过。\n说明：${explanation}` : 'ULW 验证已通过。',
      tone: 'info',
    };
    events = didTransition
      ? [
          {
            type: 'task_update',
            taskId: loopTask.id,
            label: loopTask.title,
            status: 'done',
            sessionId: params.sessionId,
            parentTaskId: loopTask.parentTaskId,
            eventId: `${params.sessionId}:${loopTask.id}:verified`,
            runId: `command:${params.sessionId}:${params.commandId}`,
            occurredAt: Date.now(),
          },
        ]
      : [];
  } else {
    const didTransition =
      loopTask.status !== 'completed' &&
      loopTask.status !== 'failed' &&
      loopTask.status !== 'cancelled';
    const failureText = explanation || 'ULW verification failed.';
    if (didTransition) {
      taskManager.failTask(params.graph, loopTask.id, failureText);
      await taskManager.save(params.graph);
    }

    card = {
      type: 'status',
      title: '/ulw-verify 未通过',
      message: explanation ? `ULW 验证未通过。\n原因：${explanation}` : 'ULW 验证未通过。',
      tone: 'warning',
    };
    events = didTransition
      ? [
          {
            type: 'task_update',
            taskId: loopTask.id,
            label: loopTask.title,
            status: 'failed',
            sessionId: params.sessionId,
            parentTaskId: loopTask.parentTaskId,
            eventId: `${params.sessionId}:${loopTask.id}:verification-failed`,
            runId: `command:${params.sessionId}:${params.commandId}`,
            occurredAt: Date.now(),
          },
        ]
      : [];
  }

  const storedMessages = appendCommandCardArtifacts({
    sessionId: params.sessionId,
    userId: params.userId,
    messagesJson: params.messagesJson,
    card,
  });
  clearPersistedLoopState(WORKSPACE_ROOT, params.sessionId);
  sqliteRun(
    "UPDATE sessions SET messages_json = ?, metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [JSON.stringify(storedMessages), JSON.stringify(metadata), params.sessionId, params.userId],
  );

  return {
    sessionId: params.sessionId,
    events,
    card,
  };
}

function buildFallbackUlwVerifyState(
  sessionId: string,
  task: Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>['tasks'][string],
): {
  completion_promise: string;
  initial_completion_promise: string;
  iteration: number;
  prompt: string;
  session_id: string;
  task_id: string;
  started_at: string;
  ultrawork: true;
  verification_pending: true;
} {
  return {
    completion_promise: 'VERIFIED',
    initial_completion_promise: 'DONE',
    iteration: 1,
    prompt: task.result ?? task.description ?? task.title,
    session_id: sessionId,
    task_id: task.id,
    started_at: new Date(task.updatedAt).toISOString(),
    ultrawork: true,
    verification_pending: true,
  };
}

function createCancelledTaskEvent(
  graph: Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>,
  taskId: string,
  sessionId: string,
  commandId: string,
): CommandExecutionResult['events'] {
  const task = graph.tasks[taskId];
  if (!task) {
    return [];
  }

  return [
    {
      type: 'task_update',
      taskId: task.id,
      label: task.title,
      status: 'cancelled',
      sessionId,
      parentTaskId: task.parentTaskId,
      eventId: `${sessionId}:${task.id}:cancelled`,
      runId: `command:${sessionId}:${commandId}`,
      occurredAt: Date.now(),
    },
  ];
}

function resolveRecoverableUlwTask(input: {
  activeTaskId?: string;
  graph: Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>;
  persistedTaskId?: string;
  sessionId: string;
}): {
  reason: 'resolved' | 'missing' | 'ambiguous';
  task?: Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>['tasks'][string];
} {
  const persistedTask =
    input.persistedTaskId !== undefined ? input.graph.tasks[input.persistedTaskId] : undefined;
  if (persistedTask && isVerifiableUlwTask(persistedTask, input.sessionId)) {
    return { reason: 'resolved', task: persistedTask };
  }

  const activeTask =
    input.activeTaskId !== undefined ? input.graph.tasks[input.activeTaskId] : undefined;
  if (activeTask && isVerifiableUlwTask(activeTask, input.sessionId)) {
    return { reason: 'resolved', task: activeTask };
  }

  const candidates = Object.values(input.graph.tasks).filter((task) =>
    isVerifiableUlwTask(task, input.sessionId),
  );
  if (candidates.length === 1) {
    return { reason: 'resolved', task: candidates[0] };
  }

  if (candidates.length > 1) {
    return { reason: 'ambiguous' };
  }

  return { reason: 'missing' };
}

function isVerifiableUlwTask(
  task: Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>['tasks'][string],
  sessionId: string,
): boolean {
  const isUlw = task.tags.includes('ulw-loop');
  const isActive = task.status === 'running';
  return task.sessionId === sessionId && isUlw && isActive;
}

async function executeRefactorCommand(params: {
  args: string[];
  commandId: string;
  graph: Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>;
  messages: Message[];
  metadataJson: string;
  messagesJson: string;
  rawInput?: string;
  sessionId: string;
  userId: string;
}): Promise<CommandExecutionResult> {
  const startedAt = Date.now();
  const parsedArgs = parseCommandArgs(params.args);
  const scope = parseRefactorScope(parsedArgs.named['scope']);
  const strategy = parseRefactorMode(parsedArgs.named['strategy']);
  const target = parsedArgs.positional.join(' ') || '当前会话上下文';
  const task = taskManager.addTask(params.graph, {
    title: 'LSP+重构',
    description: `基于 LSP 诊断结果执行智能重构任务：${target}`,
    status: 'pending',
    blockedBy: [],
    sessionId: params.sessionId,
    priority: 'high',
    tags: ['refactor', 'lsp'],
  });
  taskManager.startTask(params.graph, task.id);
  await taskManager.save(params.graph);
  const metadata = mergeMetadata(params.metadataJson, {
    refactorStartedAt: startedAt,
    refactorStrategy: strategy,
    refactorScope: scope,
    refactorTarget: target,
  });
  const card = {
    type: 'status' as const,
    title: '/refactor 已启动',
    message: `重构工作流已创建。\n目标：${target}\n范围：${scope}\n策略：${strategy}\n下一步：分析目标 → 建立影响面 → 执行并验证。\n任务：${task.title}\n任务 ID：${task.id}`,
    tone: 'info' as const,
  };
  const storedMessages = appendCommandCardArtifacts({
    sessionId: params.sessionId,
    userId: params.userId,
    messagesJson: params.messagesJson,
    card,
  });
  sqliteRun(
    "UPDATE sessions SET messages_json = ?, metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [JSON.stringify(storedMessages), JSON.stringify(metadata), params.sessionId, params.userId],
  );
  return {
    sessionId: params.sessionId,
    events: [
      {
        type: 'task_update',
        taskId: task.id,
        label: task.title,
        status: 'in_progress',
        sessionId: params.sessionId,
        parentTaskId: task.parentTaskId,
        eventId: `${params.sessionId}:${task.id}:task`,
        runId: `command:${params.sessionId}:${params.commandId}`,
        occurredAt: Date.now(),
      },
    ],
    card,
  };
}

async function executeStartWorkCommand(params: {
  args: string[];
  commandId: string;
  graph: Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>;
  messages: Message[];
  metadataJson: string;
  messagesJson: string;
  rawInput?: string;
  sessionId: string;
  userId: string;
}): Promise<CommandExecutionResult> {
  const parsedArgs = parseCommandArgs(params.args);
  const requestedPlan = parsedArgs.positional.join(' ').trim();
  const workflowPlan = await findLatestWorkflowPlan(WORKSPACE_ROOT, requestedPlan || undefined);
  const worktree = await resolveRequestedWorktree(parsedArgs.named['worktree']);
  const allTasks = Object.values(params.graph.tasks)
    .filter((t) => t.sessionId === params.sessionId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const pendingTask = allTasks.find((t) => t.status === 'pending');
  const startedAt = Date.now();

  const reusableTask = findReusableStartWorkTask({
    graph: params.graph,
    sessionId: params.sessionId,
    workflowPlan,
  });
  if (reusableTask) {
    taskManager.updateTask(params.graph, reusableTask.id, {
      title: `执行计划：${workflowPlan?.title ?? 'start-work'}`,
      description: workflowPlan
        ? `继续执行工作计划：${workflowPlan.title}`
        : reusableTask.description,
      priority: 'high',
      tags: buildStartWorkTaskTags(workflowPlan),
    });
  }
  const task =
    reusableTask ??
    taskManager.addTask(params.graph, {
      title: workflowPlan ? `执行计划：${workflowPlan.title}` : 'start-work',
      description: workflowPlan
        ? `继续执行工作计划：${workflowPlan.title}`
        : pendingTask
          ? `继续执行待处理任务：${pendingTask.title}`
          : '从会话任务图启动工作流',
      status: 'pending',
      blockedBy: [],
      sessionId: params.sessionId,
      priority: 'high',
      tags: buildStartWorkTaskTags(workflowPlan),
    });
  if (task.status === 'pending') {
    taskManager.startTask(params.graph, task.id);
  }
  const createdSubtasks = workflowPlan
    ? createWorkflowPlanSubtasks({
        graph: params.graph,
        sessionId: params.sessionId,
        parentTaskId: task.id,
        taskManager,
        workflowPlan,
      })
    : [];
  const subtasks = workflowPlan
    ? listWorkflowPlanSubtasks({
        graph: params.graph,
        sessionId: params.sessionId,
        parentTaskId: task.id,
        workflowPlan,
      })
    : [];
  await taskManager.save(params.graph);

  const metadata = mergeMetadata(params.metadataJson, {
    startWorkAt: startedAt,
    activeWorkflowPlanPath: workflowPlan?.relativePath,
    activeWorkflowPlanTitle: workflowPlan?.title,
    activeWorkflowPlanProgress: workflowPlan
      ? `${workflowPlan.completed}/${workflowPlan.total}`
      : undefined,
    activeWorkflowWorktreePath: worktree.path,
    requestedWorkflowWorktreePath: worktree.requestedPath,
  });

  const planRef = workflowPlan
    ? `已选计划：**${workflowPlan.title}**\n进度：${workflowPlan.completed}/${workflowPlan.total}\n路径：${workflowPlan.relativePath}\n下一项：${workflowPlan.pendingItems[0] ?? '读取完整计划并继续拆分执行。'}`
    : pendingTask
      ? `最近待处理任务：**${pendingTask.title}**`
      : requestedPlan
        ? `未找到匹配计划：**${requestedPlan}**，已回退到任务图入口。`
        : '当前无待处理任务，已创建新工作入口。';
  const card = {
    type: 'status' as const,
    title: '/start-work 已启动',
    message: `工作流已从任务图启动。\n${planRef}${reusableTask ? `\n已复用现有计划任务：${task.id}` : ''}${subtasks.length > 0 ? `\n已同步子任务：${subtasks.length} 项` : ''}${createdSubtasks.length > 0 ? `\n本次新增子任务：${createdSubtasks.length} 项` : ''}${worktree.note ? `\n${worktree.note}` : ''}\n\n任务 ID：${task.id}`,
    tone: 'info' as const,
  };
  const storedMessages = appendCommandCardArtifacts({
    sessionId: params.sessionId,
    userId: params.userId,
    messagesJson: params.messagesJson,
    card,
  });
  sqliteRun(
    "UPDATE sessions SET messages_json = ?, metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [JSON.stringify(storedMessages), JSON.stringify(metadata), params.sessionId, params.userId],
  );
  return {
    sessionId: params.sessionId,
    events: [
      createTaskUpdateEvent({
        task,
        status: 'in_progress',
        sessionId: params.sessionId,
        commandId: params.commandId,
      }),
      ...subtasks.map((subtask) =>
        createTaskUpdateEvent({
          task: subtask,
          status: toTaskUpdateStatus(subtask.status),
          sessionId: params.sessionId,
          commandId: params.commandId,
          eventIdSuffix: 'subtask',
        }),
      ),
    ],
    card,
  };
}

function mergeMetadata(
  metadataJson: string,
  updates: Record<string, unknown>,
): Record<string, unknown> {
  try {
    const metadata = JSON.parse(metadataJson) as Record<string, unknown>;
    return { ...metadata, ...updates };
  } catch {
    return { ...updates };
  }
}

function appendStoredCardMessage(
  messagesJson: string,
  card: CommandExecutionResult['card'],
): Array<Record<string, unknown>> {
  const existing = readStoredChatMessages(messagesJson);
  if (!card) return existing;

  return [
    ...existing,
    {
      id: `command-card-${Date.now()}`,
      role: 'assistant',
      content: JSON.stringify({ type: card.type, payload: card }),
      createdAt: Date.now(),
      status: 'completed',
    },
  ];
}

function appendCommandCardArtifacts(input: {
  sessionId: string;
  userId: string;
  messagesJson: string;
  card: CommandExecutionResult['card'];
}): Array<Record<string, unknown>> {
  const storedMessages = appendStoredCardMessage(input.messagesJson, input.card);
  if (!input.card) return storedMessages;

  appendSessionMessage({
    sessionId: input.sessionId,
    userId: input.userId,
    role: 'assistant',
    content: [
      { type: 'text', text: JSON.stringify({ type: input.card.type, payload: input.card }) },
    ],
    legacyMessagesJson: input.messagesJson,
    clientRequestId: `command-card:${randomUUID()}`,
  });

  return storedMessages;
}

function readStoredChatMessages(messagesJson: string): Array<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(messagesJson) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is Record<string, unknown> => typeof item === 'object' && item !== null,
        )
      : [];
  } catch {
    return [];
  }
}

function normalizeMessageSnapshots(
  messages: Array<z.infer<typeof messageSnapshotSchema>>,
): Message[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    createdAt: message.createdAt,
    content: message.content.map((content) => {
      if (content.type === 'text') {
        return content;
      }
      if (content.type === 'tool_call') {
        return content;
      }
      return {
        type: 'tool_result' as const,
        toolCallId: content.toolCallId,
        output: content.output,
        isError: content.isError,
      };
    }),
  }));
}

function extractMessageText(message: Message | undefined): string {
  if (!message) return '';
  return message.content
    .map((content) => {
      if (content.type === 'text') return content.text;
      if (content.type === 'tool_call')
        return `${content.toolName}: ${JSON.stringify(content.input)}`;
      if (content.type === 'tool_result') {
        return JSON.stringify(content.output);
      }
      return `${content.title}: ${content.summary}`;
    })
    .join('\n')
    .trim();
}

function summarizeMessages(messages: Message[]): string {
  const content = messages
    .slice(-8)
    .map((message) => {
      const prefix =
        message.role === 'user' ? '用户' : message.role === 'assistant' ? '助手' : '系统';
      const text = extractMessageText(message);
      return text ? `${prefix}：${text}` : null;
    })
    .filter((line): line is string => line !== null)
    .join('\n');

  if (!content) {
    return '当前会话没有足够的上下文可压缩。';
  }

  return content.length <= 240 ? content : `${content.slice(0, 239)}…`;
}

function mergeCompactionMetadata(metadataJson: string, summary: string): Record<string, unknown> {
  try {
    const metadata = JSON.parse(metadataJson) as Record<string, unknown>;
    return {
      ...metadata,
      lastCompactionAt: Date.now(),
      lastCompactionSummary: summary,
    };
  } catch {
    return {
      lastCompactionAt: Date.now(),
      lastCompactionSummary: summary,
    };
  }
}

function mergeHandoffMetadata(metadataJson: string, markdown: string): Record<string, unknown> {
  try {
    const metadata = JSON.parse(metadataJson) as Record<string, unknown>;
    return {
      ...metadata,
      lastHandoffAt: Date.now(),
      lastHandoffMarkdown: markdown,
    };
  } catch {
    return {
      lastHandoffAt: Date.now(),
      lastHandoffMarkdown: markdown,
    };
  }
}

function extractKeyDecisions(messages: Message[]): string[] {
  return messages
    .filter((message) => message.role === 'assistant')
    .map((message) => extractMessageText(message))
    .filter((text) => text.length > 0)
    .slice(-3);
}

function extractNextSteps(tasks: Array<{ title: string; status: string }>): string[] {
  const pending = tasks.filter((task) => task.status === 'pending' || task.status === 'running');
  if (pending.length > 0) {
    return pending.map((task) => task.title).slice(0, 5);
  }
  return ['继续从当前会话上下文推进下一步实现。'];
}

interface WorkflowPlanSummary {
  completed: number;
  filePath: string;
  modifiedAt: number;
  pendingItems: string[];
  relativePath: string;
  title: string;
  total: number;
}

function extractLatestUserGoal(messages: Message[]): string {
  const latestUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === 'user' && extractMessageText(message).length > 0);
  return extractMessageText(latestUserMessage) || '继续当前实现任务并保持上下文连续。';
}

function hasMeaningfulHandoffContext(
  messages: Message[],
  tasks: Array<{ title: string; status: string }>,
  workflowPlan: WorkflowPlanSummary | null,
): boolean {
  const textLength = messages.reduce((sum, message) => sum + extractMessageText(message).length, 0);
  return textLength >= 24 || tasks.length > 0 || workflowPlan !== null;
}

function buildHandoffContinuationHints(workflowPlan: WorkflowPlanSummary | null): string[] {
  if (workflowPlan) {
    return [
      `新开一个会话，并把这份 handoff 作为第一条消息粘贴进去。`,
      `优先继续计划文件 ${workflowPlan.relativePath}。`,
      `先处理下一项：${workflowPlan.pendingItems[0] ?? '读取完整计划后继续执行。'}`,
    ];
  }

  return [
    '新开一个会话。',
    '把这份 handoff 作为第一条消息粘贴进去。',
    '在后面补充你的下一步任务要求。',
  ];
}

async function findLatestWorkflowPlan(
  workspaceRoot: string,
  requestedPlan?: string,
): Promise<WorkflowPlanSummary | null> {
  const workflowDir = path.join(workspaceRoot, '.agentdocs', 'workflow');
  const files = await collectWorkflowMarkdownFiles(workflowDir);
  const summaries = (
    await Promise.all(files.map((filePath) => readWorkflowPlanSummary(filePath, workspaceRoot)))
  )
    .filter((item): item is WorkflowPlanSummary => item !== null)
    .filter((item) => item.total > 0 && item.completed < item.total)
    .sort((a, b) => b.modifiedAt - a.modifiedAt);

  if (requestedPlan) {
    const requested = requestedPlan.toLowerCase();
    const exactMatch = summaries.find((item) => item.title.toLowerCase() === requested);
    if (exactMatch) return exactMatch;
    const partialMatch = summaries.find((item) => item.title.toLowerCase().includes(requested));
    if (partialMatch) return partialMatch;
  }

  return summaries[0] ?? null;
}

function extractCommandArgs(rawInput: string | undefined, label: string): string[] {
  if (!rawInput) return [];
  const parsed = new SlashCommandRouterImpl().parse(rawInput);
  if (!parsed) return [];
  return `/${parsed.name}` === label ? parsed.args : [];
}

function parseCommandArgs(args: string[]): {
  named: Record<string, string | boolean>;
  positional: string[];
} {
  const named: Record<string, string | boolean> = {};
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index] ?? '';
    if (!current.startsWith('--')) {
      positional.push(current);
      continue;
    }

    const option = current.slice(2);
    const [key, inlineValue] = option.split('=', 2);
    if (!key) continue;
    if (inlineValue !== undefined) {
      named[key] = inlineValue;
      continue;
    }

    const next = args[index + 1];
    if (next && !next.startsWith('--')) {
      named[key] = next;
      index += 1;
      continue;
    }

    named[key] = true;
  }

  return { named, positional };
}

function parseStringOption(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parsePositiveInteger(value: string | boolean | undefined): number | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseLoopStrategy(value: string | boolean | undefined): 'continue' | 'reset' {
  return value === 'reset' ? 'reset' : 'continue';
}

function parseRefactorScope(value: string | boolean | undefined): 'file' | 'module' | 'project' {
  if (value === 'file' || value === 'project') return value;
  return 'module';
}

function parseRefactorMode(value: string | boolean | undefined): 'safe' | 'aggressive' {
  return value === 'aggressive' ? 'aggressive' : 'safe';
}

async function collectWorkflowMarkdownFiles(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const nested = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && entry.name !== 'done')
        .map((entry) => collectWorkflowMarkdownFiles(path.join(dirPath, entry.name))),
    );

    return [
      ...entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
        .map((entry) => path.join(dirPath, entry.name)),
      ...nested.flat(),
    ];
  } catch {
    return [];
  }
}

async function readWorkflowPlanSummary(
  filePath: string,
  workspaceRoot: string,
): Promise<WorkflowPlanSummary | null> {
  try {
    const [content, stats] = await Promise.all([fs.readFile(filePath, 'utf8'), fs.stat(filePath)]);
    const { completed, pendingItems, total } = parseMarkdownChecklist(content);

    return {
      completed,
      filePath,
      modifiedAt: stats.mtimeMs,
      pendingItems,
      relativePath: toWorkspaceRelativePath(filePath, workspaceRoot),
      title: extractMarkdownTitle(content, path.basename(filePath, '.md')),
      total,
    };
  } catch {
    return null;
  }
}

function parseMarkdownChecklist(content: string): {
  completed: number;
  pendingItems: string[];
  total: number;
} {
  const matches = [...content.matchAll(/^- \[( |x|X)\]\s+(.+)$/gm)];
  const pendingItems = matches
    .filter((match) => match[1] === ' ')
    .map((match) => match[2]?.trim() ?? '')
    .filter((item) => item.length > 0)
    .slice(0, 5);

  return {
    completed: matches.filter((match) => match[1]?.toLowerCase() === 'x').length,
    pendingItems,
    total: matches.length,
  };
}

function extractMarkdownTitle(content: string, fallback: string): string {
  const titleLine = content
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('# '));
  return titleLine ? titleLine.slice(2).trim() : fallback;
}

function toWorkspaceRelativePath(filePath: string, workspaceRoot: string): string {
  const relativePath = path.relative(workspaceRoot, filePath);
  return relativePath && !relativePath.startsWith('..') ? relativePath : filePath;
}
