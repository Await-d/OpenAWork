// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomeDashboardPanel } from './HomeDashboardPanel.js';
import { HomeProjectColumn } from './HomeProjectColumn.js';
import { HomeSessionList } from './HomeSessionList.js';
import type { HomeProjectSummary, HomeSessionLike } from './utils/session-grouping.js';

function createSession(input: {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly state: HomeSessionLike['state_status'];
  readonly workingDirectory: string;
}): HomeSessionLike {
  return {
    id: input.id,
    title: input.title,
    updated_at: input.updatedAt,
    state_status: input.state,
    metadata_json: JSON.stringify({ workingDirectory: input.workingDirectory }),
  };
}

afterEach(() => {
  cleanup();
});

describe('HomeDashboardPanel', () => {
  it('只展示前 4 条待继续任务，并把继续最近任务绑定到首条会话', () => {
    const onCreateSession = vi.fn();
    const onOpenRoute = vi.fn();
    const onOpenSession = vi.fn();
    const now = Date.now();
    const attentionSessions = [
      createSession({
        id: 'session-1',
        title: '任务 1',
        updatedAt: new Date(now - 1_000).toISOString(),
        state: 'running',
        workingDirectory: '/workspace/OpenAWork/apps/web',
      }),
      createSession({
        id: 'session-2',
        title: '任务 2',
        updatedAt: new Date(now - 2_000).toISOString(),
        state: 'paused',
        workingDirectory: '/workspace/OpenAWork/apps/web',
      }),
      createSession({
        id: 'session-3',
        title: '任务 3',
        updatedAt: new Date(now - 3_000).toISOString(),
        state: 'running',
        workingDirectory: '/workspace/OpenAWork/packages/shared-ui',
      }),
      createSession({
        id: 'session-4',
        title: '任务 4',
        updatedAt: new Date(now - 4_000).toISOString(),
        state: 'paused',
        workingDirectory: '/workspace/OpenAWork/services/agent-gateway',
      }),
      createSession({
        id: 'session-5',
        title: '任务 5',
        updatedAt: new Date(now - 5_000).toISOString(),
        state: 'idle',
        workingDirectory: '/workspace/OpenAWork/apps/mobile',
      }),
    ] as const;

    render(
      <HomeDashboardPanel
        activeProjectCount={2}
        attentionSessions={attentionSessions}
        pausedCount={2}
        projectCount={4}
        runningCount={2}
        selectedContextPath="/workspace/OpenAWork"
        selectedProjectLabel="OpenAWork"
        totalSessionCount={8}
        onCreateSession={onCreateSession}
        onOpenRoute={onOpenRoute}
        onOpenSession={onOpenSession}
      />,
    );

    expect(screen.getByText('优先 4/5')).toBeTruthy();
    expect(screen.getByText('任务 1')).toBeTruthy();
    expect(screen.getByText('任务 4')).toBeTruthy();
    expect(screen.queryByText('任务 5')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '继续最近任务' }));

    expect(onOpenSession).toHaveBeenCalledWith('session-1', '任务 1');
    expect(onOpenRoute).not.toHaveBeenCalled();
    expect(onCreateSession).not.toHaveBeenCalled();
  });

  it('没有待继续任务时，把次操作回退到工作流入口', () => {
    const onOpenRoute = vi.fn();

    render(
      <HomeDashboardPanel
        activeProjectCount={0}
        attentionSessions={[]}
        pausedCount={0}
        projectCount={0}
        runningCount={0}
        selectedContextPath={null}
        selectedProjectLabel={null}
        totalSessionCount={0}
        onCreateSession={vi.fn()}
        onOpenRoute={onOpenRoute}
        onOpenSession={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '打开工作流' }));

    expect(onOpenRoute).toHaveBeenCalledWith('/workflows');
    expect(screen.getByText('当前没有卡住的任务')).toBeTruthy();
  });
});

describe('HomeProjectColumn', () => {
  it('支持项目筛选和当前项目新建', () => {
    const onAddProjectSession = vi.fn();
    const onSelectProject = vi.fn();
    const projects: readonly HomeProjectSummary[] = [
      {
        key: 'web',
        label: 'web',
        path: '/workspace/OpenAWork/apps/web',
        sessionCount: 3,
        runningCount: 1,
      },
    ];

    render(
      <HomeProjectColumn
        projects={projects}
        selectedProjectKey="all"
        totalSessionCount={5}
        onAddProjectSession={onAddProjectSession}
        onOpenHelp={vi.fn()}
        onOpenSettings={vi.fn()}
        onSelectProject={onSelectProject}
      />,
    );

    fireEvent.click(screen.getByRole('option', { name: /全部项目/i }));
    fireEvent.click(screen.getByRole('option', { name: /web/i }));
    fireEvent.click(screen.getByRole('button', { name: '在当前项目中新建会话' }));

    expect(onSelectProject).toHaveBeenNthCalledWith(1, 'all');
    expect(onSelectProject).toHaveBeenNthCalledWith(2, 'web');
    expect(onAddProjectSession).toHaveBeenCalledTimes(1);
  });
});

describe('HomeSessionList', () => {
  it('渲染最近会话摘要、时间分组和会话点击', () => {
    const onCreateSession = vi.fn();
    const onOpenSession = vi.fn();
    const now = new Date();
    const sessions = [
      createSession({
        id: 'today-1',
        title: '今天的会话',
        updatedAt: now.toISOString(),
        state: 'running',
        workingDirectory: '/workspace/OpenAWork/apps/web',
      }),
      createSession({
        id: 'yesterday-1',
        title: '昨天的会话',
        updatedAt: new Date(now.getTime() - 86_400_000).toISOString(),
        state: 'paused',
        workingDirectory: '/workspace/OpenAWork/packages/shared-ui',
      }),
    ] as const;

    render(
      <HomeSessionList
        emptyDescription="空态文案"
        sessions={sessions}
        title="全部会话"
        onCreateSession={onCreateSession}
        onOpenSession={onOpenSession}
      >
        <div>搜索区域</div>
      </HomeSessionList>,
    );

    expect(screen.getByText('共 2 个会话，按最近更新时间排序')).toBeTruthy();
    expect(screen.getByText('今天')).toBeTruthy();
    expect(screen.getByText('昨天')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '新建会话' }));
    fireEvent.click(screen.getByRole('button', { name: /今天的会话/i }));

    expect(onCreateSession).toHaveBeenCalledTimes(1);
    expect(onOpenSession).toHaveBeenCalledWith('today-1', '今天的会话');
  });
});
