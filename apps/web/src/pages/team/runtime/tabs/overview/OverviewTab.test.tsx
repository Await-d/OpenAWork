// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentTeamsOverviewCard } from '../../data/team-runtime-types.js';

const runtimeReferenceState = vi.hoisted(() => ({
  activityStats: {
    assistant_message: 0,
    command_execute: 0,
    error: 0,
    file_create: 0,
    read: 0,
    task_complete: 0,
    thinking: 0,
    tool_use: 0,
    turn_complete: 0,
    user_input: 0,
    waiting_confirmation: 0,
    write: 0,
  },
  activeSharedSession: null as null | {
    comments: Array<{ authorEmail: string; content: string; createdAt: string; id: string }>;
    pendingPermissions: Array<{ requestId: string }>;
    pendingQuestions: Array<{ requestId: string }>;
    presence: Array<{ active: boolean }>;
    session: {
      messages: Array<{
        id: string;
        role: string;
        createdAt: number;
        content: Array<{ type: string; text?: string }>;
      }>;
    };
    share: {
      sessionId: string;
      title: string | null;
    };
  },
  auditLogs: [] as Array<{
    action: string;
    actorEmail: string | null;
    actorUserId: string | null;
    createdAt: string;
    detail: string | null;
    id: string;
    sessionId: string | null;
    summary: string;
  }>,
  overviewCards: new Array<AgentTeamsOverviewCard>(),
  selectedSharedSession: null as null | {
    comments: Array<{ authorEmail: string; content: string; createdAt: string; id: string }>;
    pendingPermissions: Array<{ requestId: string }>;
    pendingQuestions: Array<{ requestId: string }>;
    presence: Array<{ active: boolean }>;
    session: {
      messages: Array<{
        id: string;
        role: string;
        createdAt: number;
        content: Array<{ type: string; text?: string }>;
      }>;
    };
    share: {
      sessionId: string;
      title: string | null;
    };
  },
  sharedSessionLoading: false,
  sharedSessions: [] as Array<{ sessionId: string; title: string | null }>,
  timelineEvents: [],
}));

vi.mock('../../data/team-runtime-reference-data.js', () => ({
  useTeamRuntimeReferenceViewData: () => runtimeReferenceState,
}));

import { OverviewTab } from './OverviewTab.js';

beforeEach(() => {
  cleanup();
  runtimeReferenceState.activeSharedSession = null;
  runtimeReferenceState.auditLogs = [];
  runtimeReferenceState.overviewCards = [];
  runtimeReferenceState.selectedSharedSession = null;
  runtimeReferenceState.sharedSessionLoading = false;
  runtimeReferenceState.sharedSessions = [];
  runtimeReferenceState.timelineEvents = [];
});

afterEach(() => {
  cleanup();
});

describe('OverviewTab', () => {
  it('默认概览指标使用移动端紧凑样式 hook', () => {
    runtimeReferenceState.overviewCards = [
      {
        icon: 'members',
        id: 'active-members',
        label: '活跃角色',
        note: '参与层级 2 · 工作中成员 1 · 总成员 4',
        value: '4',
      },
      {
        icon: 'tasks',
        id: 'tasks',
        label: '办公室任务',
        note: '进行中 3 · 已完成 7 · 失败 0',
        trend: 'up',
        value: '10',
      },
    ];

    render(<OverviewTab />);

    expect(screen.getByText('运行概览')).toBeTruthy();
    expect(screen.getByLabelText('团队工作区概览')).toBeTruthy();
    expect(screen.getByText('全局指标 · 活动时间线')).toBeTruthy();
    const workbenchMap = screen.getByLabelText('Team 工作台层级导览');
    expect(workbenchMap).toBeTruthy();
    expect(screen.getByText('Team 页面结构')).toBeTruthy();
    expect(screen.getByText('5 个主域 · 18 个页内视图')).toBeTruthy();
    expect(workbenchMap.querySelectorAll('.team-v2-overview-workbench-card')).toHaveLength(5);
    expect(workbenchMap.textContent).toContain('概览');
    expect(workbenchMap.textContent).toContain('对话');
    expect(workbenchMap.textContent).toContain('任务');
    expect(workbenchMap.textContent).toContain('度量');
    expect(workbenchMap.textContent).toContain('治理');
    expect(workbenchMap.textContent).toContain('看板产物评审。');
    expect(workbenchMap.textContent).toContain('用量耗时工具。');
    expect(workbenchMap.textContent).toContain('模板共享审计。');
    expect(workbenchMap.textContent).toContain('任务看板');
    expect(workbenchMap.textContent).toContain('工具调用');
    expect(workbenchMap.textContent).toContain('审计');
    const metricGrid = screen.getByText('活跃角色').closest('.team-v2-overview-metrics');
    expect(metricGrid).toBeTruthy();
    const card = screen.getByText('活跃角色').closest('.team-v2-overview-card');
    expect(card).toBeTruthy();
    expect(screen.getByText('关键指标 + 活动时间线，按会话联动。')).toBeTruthy();
  });

  it('选中普通会话时使用紧凑会话上下文条', () => {
    runtimeReferenceState.overviewCards = [
      {
        icon: 'members',
        id: 'active-members',
        label: '活跃角色',
        note: '参与层级 2 · 工作中成员 1 · 总成员 4',
        value: '4',
      },
    ];

    render(
      <OverviewTab
        selectedTeam={{
          id: 'team-session-1',
          status: 'running',
          subtitle: '执行层正在同步文件变更',
          title: '工作区布局融合',
        }}
      />,
    );

    expect(
      screen.getByLabelText('当前团队会话').classList.contains('team-v2-session-context-strip'),
    ).toBe(true);
    expect(screen.getByText('工作区布局融合')).toBeTruthy();
    expect(screen.getByText('运行中').classList.contains('team-v2-session-context-status')).toBe(
      true,
    );
  });

  it('选中共享会话时渲染共享概览而不是默认 runtime 时间线', () => {
    runtimeReferenceState.sharedSessions = [{ sessionId: 'shared-1', title: '共享会话 A' }];
    runtimeReferenceState.activeSharedSession = {
      comments: [
        {
          authorEmail: 'owner@example.com',
          content: '补充共享说明',
          createdAt: '2026-06-06T10:10:00.000Z',
          id: 'comment-1',
        },
      ],
      pendingPermissions: [{ requestId: 'permission-1' }],
      pendingQuestions: [{ requestId: 'question-1' }],
      presence: [{ active: true }],
      session: {
        messages: [
          {
            id: 'assistant-1',
            role: 'assistant',
            createdAt: Date.parse('2026-06-06T10:00:00.000Z'),
            content: [{ type: 'text', text: '共享输出已更新' }],
          },
        ],
      },
      share: {
        sessionId: 'shared-1',
        title: '共享会话 A',
      },
    };
    runtimeReferenceState.auditLogs = [
      {
        action: 'shared_comment_created',
        actorEmail: 'owner@example.com',
        actorUserId: 'user-1',
        createdAt: '2026-06-06T10:12:00.000Z',
        detail: null,
        id: 'audit-1',
        sessionId: 'shared-1',
        summary: '新增共享评论',
      },
    ];

    render(
      <OverviewTab
        selectedTeam={{
          id: 'shared-1',
          isSharedSession: true,
          status: 'running',
          subtitle: '共享运行',
          title: '共享会话 A',
        }}
      />,
    );

    expect(screen.getByTestId('shared-overview-view')).toBeTruthy();
    expect(screen.getByText('共享活动时间线')).toBeTruthy();
    expect(screen.getByText('新增共享评论')).toBeTruthy();
    expect(screen.queryByText('活动类型分布')).toBeNull();
    expect(screen.queryByText('活动时间线')).toBeNull();
  });
});
