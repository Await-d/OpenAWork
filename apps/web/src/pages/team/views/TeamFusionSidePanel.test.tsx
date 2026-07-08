// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TeamFusionSidePanel } from './TeamFusionSidePanel.js';

afterEach(() => {
  cleanup();
});

describe('TeamFusionSidePanel', () => {
  it('把主工作台切换渲染为可访问 tab，并保留当前上下文摘要', () => {
    const onPrimaryChange = vi.fn();

    render(
      <TeamFusionSidePanel
        activePrimary="overview"
        activeHandoffCount={2}
        clarificationPending={1}
        effectiveMode="running"
        failedTaskCount={0}
        middleTab="dashboard"
        onPrimaryChange={onPrimaryChange}
        selectedTeamSubtitle="正在执行登录改造"
        selectedTeamTitle="登录功能团队"
        unreadCount={3}
        workspaceLabel="默认工作区"
      >
        <div>运行概览内容</div>
      </TeamFusionSidePanel>,
    );

    expect(screen.getByRole('tab', { name: '概览视图' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getAllByText('登录功能团队')).toHaveLength(1);
    expect(screen.getAllByText('默认工作区')).toHaveLength(1);
    expect(screen.getByText('当前 仪表盘')).toBeTruthy();
    expect(
      screen
        .getByText('运行概览内容')
        .closest('.team-v2-fusion-side-panel')
        ?.getAttribute('data-active-primary'),
    ).toBe('overview');

    fireEvent.click(screen.getByRole('tab', { name: '任务视图' }));

    expect(onPrimaryChange).toHaveBeenCalledWith('tasks');
  });

  it('为当前对话视图保留 Fusion conversation-first 布局钩子', () => {
    render(
      <TeamFusionSidePanel
        activePrimary="conversation"
        activeHandoffCount={0}
        clarificationPending={0}
        effectiveMode="idle"
        failedTaskCount={0}
        middleTab="dashboard"
        onPrimaryChange={vi.fn()}
        selectedTeamSubtitle={null}
        selectedTeamTitle={null}
        unreadCount={0}
        workspaceLabel="默认工作区"
      >
        <div>当前对话工作台</div>
      </TeamFusionSidePanel>,
    );

    const root = screen.getByText('当前对话工作台').closest('.team-v2-fusion-side-panel');

    expect(root?.getAttribute('data-active-primary')).toBe('conversation');
    expect(root?.getAttribute('data-active-tab')).toBe('dashboard');
    expect(screen.getByText('当前 仪表盘')).toBeTruthy();
  });
});
