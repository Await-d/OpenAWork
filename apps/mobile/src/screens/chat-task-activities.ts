import type { SessionTask } from '@openAwork/web-client';
import type { AgentActivity } from '../components/AgentActivityPanel';
import type { SubagentMessage } from '../components/SubagentDetailModal';

export interface TaskActivityUpdate {
  assignedAgent?: string;
  id: string;
  name: string;
  output?: string;
  sessionId?: string;
  status: 'running' | 'done' | 'error';
}

function buildTaskSummaryMessages(update: TaskActivityUpdate): SubagentMessage[] {
  if (!update.output) {
    return [];
  }

  return [
    {
      id: `${update.id}:summary`,
      role: 'assistant',
      content: update.output,
      isError: update.status === 'error',
    },
  ];
}

export function formatTaskActivityName(input: { assignedAgent?: string; label: string }): string {
  return input.assignedAgent ? `@${input.assignedAgent} · ${input.label}` : input.label;
}

function createTaskActivity(update: TaskActivityUpdate): AgentActivity {
  return {
    id: update.id,
    kind: 'subagent',
    name: update.name,
    status: update.status,
    output: update.output,
    subagentDetail: {
      prompt: update.name,
      messages: buildTaskSummaryMessages(update),
    },
  };
}

function shouldTrackTaskActivity(task: SessionTask): boolean {
  return (
    task.tags.includes('task-tool') &&
    typeof task.sessionId === 'string' &&
    task.sessionId.length > 0
  );
}

export function upsertTaskActivity(
  activities: AgentActivity[],
  update: TaskActivityUpdate,
): AgentActivity[] {
  const existingIndex = activities.findIndex((activity) => activity.id === update.id);
  if (existingIndex === -1) {
    return [...activities, createTaskActivity(update)];
  }

  return activities.map((activity, index) => {
    if (index !== existingIndex) {
      return activity;
    }

    const nextOutput = update.output ?? activity.output;
    return {
      ...activity,
      kind: 'subagent',
      name: update.name,
      status: update.status,
      output: nextOutput,
      subagentDetail: {
        ...activity.subagentDetail,
        prompt: update.name,
        messages: buildTaskSummaryMessages({ ...update, output: nextOutput }),
      },
    };
  });
}

export function buildTaskActivityUpdateFromSessionTask(task: SessionTask): TaskActivityUpdate {
  const status =
    task.status === 'running' || task.status === 'pending'
      ? 'running'
      : task.status === 'completed'
        ? 'done'
        : 'error';
  const output =
    task.errorMessage ??
    task.result ??
    (task.status === 'cancelled' ? '子任务已取消。' : undefined);

  return {
    id: task.id,
    name: formatTaskActivityName({ assignedAgent: task.assignedAgent, label: task.title }),
    assignedAgent: task.assignedAgent,
    sessionId: task.sessionId,
    status,
    output,
  };
}

export function reconcileTaskActivities(
  activities: AgentActivity[],
  tasks: SessionTask[],
): AgentActivity[] {
  const preservedActivities = activities.filter((activity) => activity.kind !== 'subagent');
  const existingSubagentActivities = new Map(
    activities
      .filter((activity) => activity.kind === 'subagent')
      .map((activity) => [activity.id, activity] as const),
  );

  const reconciledSubagentActivities = tasks
    .filter(shouldTrackTaskActivity)
    .sort((left, right) => left.updatedAt - right.updatedAt)
    .map((task) => {
      const nextActivity = createTaskActivity(buildTaskActivityUpdateFromSessionTask(task));
      const existingActivity = existingSubagentActivities.get(task.id);
      if (!existingActivity) {
        return nextActivity;
      }

      const nextDetail = nextActivity.subagentDetail;
      const existingDetail = existingActivity.subagentDetail;

      return {
        ...existingActivity,
        ...nextActivity,
        subagentDetail: {
          messages: nextDetail?.messages ?? [],
          prompt: nextDetail?.prompt ?? existingDetail?.prompt,
          model: nextDetail?.model ?? existingDetail?.model,
          tokenCount: nextDetail?.tokenCount ?? existingDetail?.tokenCount,
          startedAt: nextDetail?.startedAt ?? existingDetail?.startedAt,
          finishedAt: nextDetail?.finishedAt ?? existingDetail?.finishedAt,
        },
      };
    });

  return [...preservedActivities, ...reconciledSubagentActivities];
}
