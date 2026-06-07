import { describe, expect, it } from 'vitest';
import type { TeamRuntimeTaskGroupRecord, TeamTaskRecord } from '@openAwork/web-client';
import { resolveTaskRecordsForView } from './team-runtime-task-lanes.js';

function buildRuntimeTaskGroups(): TeamRuntimeTaskGroupRecord[] {
  return [
    {
      sessionIds: ['session-a'],
      tasks: [
        {
          id: 'runtime-a-1',
          title: 'A 会话任务',
          status: 'running',
          blockedBy: [],
          completedSubtaskCount: 0,
          readySubtaskCount: 0,
          sessionId: 'session-a',
          priority: 'high',
          tags: [],
          createdAt: 100,
          updatedAt: 200,
          depth: 0,
          subtaskCount: 0,
          unmetDependencyCount: 0,
        },
      ],
      updatedAt: 200,
      workspacePath: '/workspace-a',
    },
    {
      sessionIds: ['session-b'],
      tasks: [
        {
          id: 'runtime-b-1',
          title: 'B 会话任务',
          status: 'pending',
          blockedBy: [],
          completedSubtaskCount: 0,
          readySubtaskCount: 0,
          sessionId: 'session-b',
          priority: 'medium',
          tags: [],
          createdAt: 300,
          updatedAt: 350,
          depth: 0,
          subtaskCount: 0,
          unmetDependencyCount: 0,
        },
      ],
      updatedAt: 350,
      workspacePath: '/workspace-a',
    },
  ];
}

function buildTeamTasks(): TeamTaskRecord[] {
  return [
    {
      id: 'team-task-1',
      title: '工作区级任务',
      assigneeId: null,
      status: 'pending',
      priority: 'low',
      result: null,
      createdAt: '2026-06-04T00:00:00.000Z',
      updatedAt: '2026-06-04T00:10:00.000Z',
    },
  ];
}

describe('resolveTaskRecordsForView', () => {
  it('选中会话后只返回当前会话的 runtime task', () => {
    const records = resolveTaskRecordsForView({
      selectedSessionId: 'session-a',
      runtimeTaskGroups: buildRuntimeTaskGroups(),
      teamTasks: buildTeamTasks(),
      runtimeTaskRecords: [],
    });

    expect(records).toHaveLength(1);
    expect(records[0]?.id).toBe('runtime-a-1');
    expect(records[0]?.title).toBe('A 会话任务');
    expect(records[0]?.status).toBe('in_progress');
  });

  it('选中会话但没有匹配 runtime task 时，不回落到工作区级 team task', () => {
    const records = resolveTaskRecordsForView({
      selectedSessionId: 'session-missing',
      runtimeTaskGroups: buildRuntimeTaskGroups(),
      teamTasks: buildTeamTasks(),
      runtimeTaskRecords: [
        {
          id: 'runtime-fallback',
          title: '旧的工作区 runtime task',
          assigneeId: null,
          status: 'completed',
          priority: 'medium',
          result: null,
          createdAt: '2026-06-04T00:20:00.000Z',
          updatedAt: '2026-06-04T00:30:00.000Z',
        },
      ],
    });

    expect(records).toEqual([]);
  });

  it('未选中会话时仍保持旧的工作区回退策略', () => {
    const records = resolveTaskRecordsForView({
      selectedSessionId: null,
      runtimeTaskGroups: buildRuntimeTaskGroups(),
      teamTasks: buildTeamTasks(),
      runtimeTaskRecords: [
        {
          id: 'runtime-fallback',
          title: '旧的工作区 runtime task',
          assigneeId: null,
          status: 'completed',
          priority: 'medium',
          result: null,
          createdAt: '2026-06-04T00:20:00.000Z',
          updatedAt: '2026-06-04T00:30:00.000Z',
        },
      ],
    });

    expect(records).toHaveLength(1);
    expect(records[0]?.id).toBe('team-task-1');
  });
});
