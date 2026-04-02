import { describe, expect, it } from 'vitest';
import type { AgentActivity } from '../components/AgentActivityPanel.js';
import {
  buildTaskActivityUpdateFromSessionTask,
  formatTaskActivityName,
  reconcileTaskActivities,
  upsertTaskActivity,
} from '../screens/chat-task-activities.js';

describe('chat-task-activities', () => {
  it('formats task activity names with assigned agent prefix', () => {
    expect(formatTaskActivityName({ assignedAgent: 'explore', label: '分析目录结构' })).toBe(
      '@explore · 分析目录结构',
    );
    expect(formatTaskActivityName({ label: '分析目录结构' })).toBe('分析目录结构');
  });

  it('creates subagent activities from task updates', () => {
    const next = upsertTaskActivity([], {
      id: 'task-1',
      name: '@explore · 分析目录结构',
      status: 'running',
    });

    expect(next).toEqual([
      {
        id: 'task-1',
        kind: 'subagent',
        name: '@explore · 分析目录结构',
        status: 'running',
        output: undefined,
        subagentDetail: {
          prompt: '@explore · 分析目录结构',
          messages: [],
        },
      },
    ]);
  });

  it('reconciles running subagent activities with polled task snapshots', () => {
    const activities: AgentActivity[] = [
      {
        id: 'task-1',
        kind: 'subagent',
        name: '@explore · 分析目录结构',
        status: 'running',
        subagentDetail: { prompt: '@explore · 分析目录结构', messages: [] },
      },
      {
        id: 'tool-1',
        kind: 'tool',
        name: 'read',
        status: 'done',
      },
    ];

    const taskUpdate = buildTaskActivityUpdateFromSessionTask({
      id: 'task-1',
      title: '分析目录结构',
      status: 'completed',
      blockedBy: [],
      completedSubtaskCount: 0,
      readySubtaskCount: 0,
      priority: 'high',
      tags: ['task-tool'],
      createdAt: 1,
      updatedAt: 2,
      depth: 0,
      subtaskCount: 0,
      unmetDependencyCount: 0,
      assignedAgent: 'explore',
      sessionId: 'child-1',
      result: '目录结构已分析完成。',
    });

    const next = reconcileTaskActivities(activities, [
      {
        id: 'task-1',
        title: '分析目录结构',
        status: 'completed',
        blockedBy: [],
        completedSubtaskCount: 0,
        readySubtaskCount: 0,
        priority: 'high',
        tags: ['task-tool'],
        createdAt: 1,
        updatedAt: 2,
        depth: 0,
        subtaskCount: 0,
        unmetDependencyCount: 0,
        assignedAgent: 'explore',
        sessionId: 'child-1',
        result: '目录结构已分析完成。',
      },
    ]);

    expect(taskUpdate).toEqual({
      id: 'task-1',
      name: '@explore · 分析目录结构',
      assignedAgent: 'explore',
      sessionId: 'child-1',
      status: 'done',
      output: '目录结构已分析完成。',
    });
    expect(next).toEqual([
      {
        id: 'tool-1',
        kind: 'tool',
        name: 'read',
        status: 'done',
      },
      {
        id: 'task-1',
        kind: 'subagent',
        name: '@explore · 分析目录结构',
        status: 'done',
        output: '目录结构已分析完成。',
        subagentDetail: {
          prompt: '@explore · 分析目录结构',
          model: undefined,
          tokenCount: undefined,
          startedAt: undefined,
          finishedAt: undefined,
          messages: [
            {
              id: 'task-1:summary',
              role: 'assistant',
              content: '目录结构已分析完成。',
              isError: false,
            },
          ],
        },
      },
    ]);
  });

  it('bootstraps missing subagent activities from task snapshots while preserving tools', () => {
    const activities: AgentActivity[] = [
      {
        id: 'tool-1',
        kind: 'tool',
        name: 'read',
        status: 'running',
      },
    ];

    const next = reconcileTaskActivities(activities, [
      {
        id: 'task-1',
        title: '分析目录结构',
        status: 'running',
        blockedBy: [],
        completedSubtaskCount: 0,
        readySubtaskCount: 0,
        priority: 'high',
        tags: ['task-tool'],
        createdAt: 1,
        updatedAt: 2,
        depth: 0,
        subtaskCount: 0,
        unmetDependencyCount: 0,
        assignedAgent: 'explore',
        sessionId: 'child-1',
      },
      {
        id: 'task-no-session',
        title: '普通计划任务',
        status: 'running',
        blockedBy: [],
        completedSubtaskCount: 0,
        readySubtaskCount: 0,
        priority: 'medium',
        tags: ['root'],
        createdAt: 3,
        updatedAt: 4,
        depth: 0,
        subtaskCount: 0,
        unmetDependencyCount: 0,
        sessionId: 'main-session',
      },
    ]);

    expect(next).toEqual([
      {
        id: 'tool-1',
        kind: 'tool',
        name: 'read',
        status: 'running',
      },
      {
        id: 'task-1',
        kind: 'subagent',
        name: '@explore · 分析目录结构',
        status: 'running',
        output: undefined,
        subagentDetail: {
          prompt: '@explore · 分析目录结构',
          messages: [],
        },
      },
    ]);
  });

  it('ignores non task-tool tasks even when they have a session id', () => {
    const next = reconcileTaskActivities(
      [],
      [
        {
          id: 'task-plain',
          title: '普通计划任务',
          status: 'running',
          blockedBy: [],
          completedSubtaskCount: 0,
          readySubtaskCount: 0,
          priority: 'medium',
          tags: ['root'],
          createdAt: 1,
          updatedAt: 2,
          depth: 0,
          subtaskCount: 0,
          unmetDependencyCount: 0,
          sessionId: 'main-session',
        },
      ],
    );

    expect(next).toEqual([]);
  });
});
