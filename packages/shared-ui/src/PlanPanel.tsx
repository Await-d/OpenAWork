import type { CSSProperties } from 'react';
import type { StepRowProps } from './StepRow.js';

export interface PlanTask {
  id: string;
  label: string;
  status: 'pending' | 'in_progress' | 'done' | 'failed' | 'cancelled';
  parentTaskId?: string;
}

export interface PlanPanelProps {
  tasks: PlanTask[];
  steps?: StepRowProps[];
  style?: CSSProperties;
}

const statusIcon: Record<PlanTask['status'], string> = {
  pending: '○',
  in_progress: '◐',
  done: '●',
  failed: '✗',
  cancelled: '⊘',
};

const statusColor: Record<PlanTask['status'], string> = {
  pending: 'var(--color-muted, #94a3b8)',
  in_progress: '#fbbf24',
  done: '#34d399',
  failed: '#f87171',
  cancelled: '#f59e0b',
};

export function PlanPanel({ tasks, style }: PlanPanelProps) {
  if (tasks.length === 0) return null;

  const orderedTasks = buildOrderedTasks(tasks);
  return (
    <div
      style={{
        border: '1px solid var(--color-border, #334155)',
        borderRadius: 8,
        padding: '0.75rem 1rem',
        background: 'var(--color-surface, #1e293b)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        maxWidth: '75%',
        alignSelf: 'flex-start',
        ...style,
      }}
    >
      {orderedTasks.map(({ task, depth }) => (
        <div
          key={task.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12,
            paddingLeft: depth * 14,
          }}
        >
          <span style={{ color: statusColor[task.status], fontSize: 12, lineHeight: 1 }}>
            {statusIcon[task.status]}
          </span>
          <span
            style={{
              minWidth: depth > 0 ? 8 : 0,
              height: 1,
              background:
                depth > 0
                  ? 'color-mix(in srgb, var(--color-border, #334155) 88%, transparent)'
                  : 'transparent',
              flexShrink: 0,
            }}
          />
          <span
            style={{
              color:
                task.status === 'done' || task.status === 'cancelled'
                  ? 'var(--color-muted, #94a3b8)'
                  : 'var(--color-text, #f1f5f9)',
              textDecoration:
                task.status === 'done' || task.status === 'cancelled' ? 'line-through' : 'none',
            }}
          >
            {task.label}
          </span>
        </div>
      ))}
    </div>
  );
}

function buildOrderedTasks(tasks: PlanTask[]): Array<{ task: PlanTask; depth: number }> {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const orderById = new Map(tasks.map((task, index) => [task.id, index]));
  const childrenByParent = new Map<string, PlanTask[]>();

  for (const task of tasks) {
    if (!task.parentTaskId || !taskById.has(task.parentTaskId)) {
      continue;
    }
    const existingChildren = childrenByParent.get(task.parentTaskId) ?? [];
    existingChildren.push(task);
    childrenByParent.set(task.parentTaskId, existingChildren);
  }

  const sortTasks = (items: PlanTask[]): PlanTask[] =>
    [...items].sort(
      (left, right) => (orderById.get(left.id) ?? 0) - (orderById.get(right.id) ?? 0),
    );

  const orderedTasks: Array<{ task: PlanTask; depth: number }> = [];
  const visitedTaskIds = new Set<string>();

  const visitTask = (task: PlanTask, depth: number) => {
    if (visitedTaskIds.has(task.id)) {
      return;
    }

    visitedTaskIds.add(task.id);
    orderedTasks.push({ task, depth });
    for (const childTask of sortTasks(childrenByParent.get(task.id) ?? [])) {
      visitTask(childTask, depth + 1);
    }
  };

  const rootTasks = sortTasks(
    tasks.filter((task) => !task.parentTaskId || !taskById.has(task.parentTaskId)),
  );
  for (const rootTask of rootTasks) {
    visitTask(rootTask, 0);
  }

  for (const task of sortTasks(tasks.filter((item) => !visitedTaskIds.has(item.id)))) {
    visitTask(task, 0);
  }

  return orderedTasks;
}
