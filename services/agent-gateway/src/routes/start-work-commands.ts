import type { CommandExecutionResult, Message } from '@openAwork/shared';
import type { AgentTaskManagerImpl } from '@openAwork/agent-core';
import { WORKSPACE_ROOT, sqliteRun } from '../infra/db.js';
import { parseStringOption, parseCommandArgs } from './command-args.js';
import {
  appendCommandCardArtifacts,
  mergeMetadata,
  taskManager,
  type CommandTask,
  type CommandTaskGraph,
} from './command-executors.js';
import { resolveRequestedWorktree } from './command-loop-runtime.js';
import {
  applyStartWorkVerifierVerdict,
  buildStartWorkTaskTags,
  createTaskUpdateEvent,
  createWorkflowPlanSubtasks,
  findReusableStartWorkTask,
  listWorkflowPlanSubtasks,
  recordStartWorkDoneClaim,
  toTaskUpdateStatus,
  type StartWorkVerifierVerdict,
} from './start-work-subtasks.js';
import { findLatestWorkflowPlan } from './workflow-plan-context.js';

export async function executeStartWorkCommand(params: {
  args: string[];
  commandId: string;
  graph: Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>;
  messages: Message[];
  metadataJson: string;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStartWorkGateMetadata(task: CommandTask): Record<string, unknown> | null {
  const metadata = task.metadata;
  if (!isRecord(metadata)) {
    return null;
  }
  const gate = metadata['startWorkGate'];
  return isRecord(gate) ? gate : null;
}

export function parseStartWorkGateTaskId(parsedArgs: {
  readonly named: Record<string, string | boolean>;
}): string | undefined {
  return (
    parseStringOption(parsedArgs.named['task']) ?? parseStringOption(parsedArgs.named['task-id'])
  );
}

export function findStartWorkGateTask(input: {
  readonly graph: CommandTaskGraph;
  readonly mode: 'done-claim' | 'review';
  readonly sessionId: string;
  readonly taskId?: string;
}): CommandTask | null {
  if (input.taskId) {
    const task = input.graph.tasks[input.taskId];
    if (!task || task.sessionId !== input.sessionId || !readStartWorkGateMetadata(task)) {
      return null;
    }
    return task;
  }

  const candidates = Object.values(input.graph.tasks)
    .filter((task) => task.sessionId === input.sessionId && task.status === 'running')
    .filter((task) => {
      const gate = readStartWorkGateMetadata(task);
      if (!gate) {
        return false;
      }
      if (input.mode === 'review') {
        return gate['executorClaimStatus'] === 'submitted';
      }
      return true;
    })
    .sort((left, right) => right.updatedAt - left.updatedAt);

  return candidates[0] ?? null;
}

export function parseStartWorkVerifierVerdict(
  value: string | undefined,
): StartWorkVerifierVerdict | undefined {
  switch (value) {
    case 'confirmed':
    case 'needs-fix':
    case 'false-positive':
    case 'needs-human-review':
      return value;
    default:
      return undefined;
  }
}

export async function executeStartWorkDoneClaimCommand(params: {
  args: string[];
  commandId: string;
  graph: CommandTaskGraph;
  messages: Message[];
  metadataJson: string;
  rawInput?: string;
  sessionId: string;
  userId: string;
}): Promise<CommandExecutionResult> {
  const parsedArgs = parseCommandArgs(params.args);
  const task = findStartWorkGateTask({
    graph: params.graph,
    mode: 'done-claim',
    sessionId: params.sessionId,
    taskId: parseStartWorkGateTaskId(parsedArgs),
  });
  if (!task) {
    return {
      sessionId: params.sessionId,
      events: [],
      card: {
        type: 'status',
        title: '/start-work-done unavailable',
        message:
          '没有找到可提交完成声明的 running start-work 子任务。可使用 /start-work-done --task <任务ID> <说明> 指定目标。',
        tone: 'warning',
      },
    };
  }

  const positionalSummary = parsedArgs.positional.join(' ').trim();
  const summary =
    parseStringOption(parsedArgs.named['summary']) ??
    (positionalSummary.length > 0 ? positionalSummary : '执行者已声明完成，等待 reviewer 确认。');
  recordStartWorkDoneClaim({
    graph: params.graph,
    summary,
    taskId: task.id,
    taskManager,
  });
  await taskManager.save(params.graph);
  const updatedTask = params.graph.tasks[task.id] ?? task;

  return {
    sessionId: params.sessionId,
    events: [
      createTaskUpdateEvent({
        commandId: params.commandId,
        sessionId: params.sessionId,
        status: toTaskUpdateStatus(updatedTask.status),
        task: updatedTask,
      }),
    ],
    card: {
      type: 'status',
      title: '/start-work-done 已提交',
      message: `已提交完成声明，等待 reviewer verdict。\n任务：${updatedTask.title}\n任务 ID：${updatedTask.id}`,
      tone: 'info',
    },
  };
}

export async function executeStartWorkReviewCommand(params: {
  args: string[];
  commandId: string;
  graph: CommandTaskGraph;
  messages: Message[];
  metadataJson: string;
  rawInput?: string;
  sessionId: string;
  userId: string;
}): Promise<CommandExecutionResult> {
  const parsedArgs = parseCommandArgs(params.args);
  const explicitVerdict = parseStringOption(parsedArgs.named['verdict']);
  const verdict = parseStartWorkVerifierVerdict(explicitVerdict ?? parsedArgs.positional[0]);
  if (!verdict) {
    return {
      sessionId: params.sessionId,
      events: [],
      card: {
        type: 'status',
        title: '/start-work-review 参数无效',
        message:
          '请使用 /start-work-review --verdict confirmed|needs-fix|false-positive|needs-human-review [说明]。',
        tone: 'warning',
      },
    };
  }

  const task = findStartWorkGateTask({
    graph: params.graph,
    mode: 'review',
    sessionId: params.sessionId,
    taskId: parseStartWorkGateTaskId(parsedArgs),
  });
  if (!task) {
    return {
      sessionId: params.sessionId,
      events: [],
      card: {
        type: 'status',
        title: '/start-work-review unavailable',
        message:
          '没有找到已提交完成声明且可 review 的 running start-work 子任务。可使用 /start-work-review --task <任务ID> --verdict confirmed 指定目标。',
        tone: 'warning',
      },
    };
  }

  const positionalNote =
    explicitVerdict === undefined && parsedArgs.positional[0] === verdict
      ? parsedArgs.positional.slice(1).join(' ').trim()
      : parsedArgs.positional.join(' ').trim();
  const note =
    parseStringOption(parsedArgs.named['note']) ??
    (positionalNote.length > 0 ? positionalNote : undefined);
  applyStartWorkVerifierVerdict({
    graph: params.graph,
    ...(note ? { note } : {}),
    taskId: task.id,
    taskManager,
    verdict,
  });
  await taskManager.save(params.graph);
  const updatedTask = params.graph.tasks[task.id] ?? task;

  return {
    sessionId: params.sessionId,
    events: [
      createTaskUpdateEvent({
        commandId: params.commandId,
        sessionId: params.sessionId,
        status: toTaskUpdateStatus(updatedTask.status),
        task: updatedTask,
      }),
    ],
    card: {
      type: 'status',
      title: '/start-work-review 已提交',
      message: `Reviewer verdict: ${verdict}\n任务：${updatedTask.title}\n任务 ID：${updatedTask.id}`,
      tone: verdict === 'confirmed' ? 'info' : 'warning',
    },
  };
}
