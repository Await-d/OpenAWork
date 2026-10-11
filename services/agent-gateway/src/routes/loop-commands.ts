import type { CommandExecutionResult, Message } from '@openAwork/shared';
import type { AgentTaskManagerImpl } from '@openAwork/agent-core';
import { RalphLoopImpl } from '@openAwork/agent-core';
import { WORKSPACE_ROOT, sqliteRun } from '../infra/db.js';
import {
  parseCommandArgs,
  parseLoopStrategy,
  parsePositiveInteger,
  parseStringOption,
} from './command-args.js';
import {
  scheduleLoopExecution,
  stopActiveLoopExecution,
  readActiveLoopState,
  readUlwVerificationPendingTaskId,
  clearPersistedLoopState,
  clearUlwLoopMetadata,
  clearActiveLoopMetadata,
  hasPersistedLoopState,
} from './command-loop-runtime.js';
import {
  appendCommandCardArtifacts,
  extractLatestUserGoal,
  mergeMetadata,
  taskManager,
} from './command-executors.js';
import { summarizeMessages } from './message-text-utils.js';
import { findLatestWorkflowPlan } from './workflow-plan-context.js';

export async function executeRalphLoopCommand(params: {
  args: string[];
  commandId: string;
  graph: Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>;
  messages: Message[];
  metadataJson: string;
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
  appendCommandCardArtifacts({
    sessionId: params.sessionId,
    userId: params.userId,
    card,
  });
  sqliteRun(
    "UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [JSON.stringify(metadata), params.sessionId, params.userId],
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

export async function executeUlwLoopCommand(params: {
  args: string[];
  commandId: string;
  graph: Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>;
  messages: Message[];
  metadataJson: string;
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
  appendCommandCardArtifacts({
    sessionId: params.sessionId,
    userId: params.userId,
    card,
  });
  sqliteRun(
    "UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [JSON.stringify(metadata), params.sessionId, params.userId],
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

export async function executeCancelRalphCommand(params: {
  args: string[];
  commandId: string;
  graph: Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>;
  messages: Message[];
  metadataJson: string;
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

  let metadata = clearUlwLoopMetadata(params.metadataJson);
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
  appendCommandCardArtifacts({
    sessionId: params.sessionId,
    userId: params.userId,
    card,
  });
  sqliteRun(
    "UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [JSON.stringify(metadata), params.sessionId, params.userId],
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

export async function executeStopContinuationCommand(params: {
  args: string[];
  commandId: string;
  graph: Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>;
  messages: Message[];
  metadataJson: string;
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
  appendCommandCardArtifacts({
    sessionId: params.sessionId,
    userId: params.userId,
    card,
  });
  sqliteRun(
    "UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [JSON.stringify(metadata), params.sessionId, params.userId],
  );

  return {
    sessionId: params.sessionId,
    events,
    card,
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
