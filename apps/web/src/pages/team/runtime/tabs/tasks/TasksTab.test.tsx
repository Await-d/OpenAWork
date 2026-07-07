// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const createTaskMock = vi.fn(async () => true);
const moveTaskMock = vi.fn(async () => true);
const state = vi.hoisted(() => ({
  canManageSessionEntries: true,
}));

vi.mock('../../data/team-runtime-reference-data.js', () => ({
  useTeamRuntimeReferenceViewData: () => ({
    busy: false,
    canManageSessionEntries: state.canManageSessionEntries,
    createTask: createTaskMock,
    moveTask: moveTaskMock,
    taskLanes: [
      {
        id: 'todo',
        title: '待办',
        cards: [
          {
            id: 'task-1',
            title: '梳理需求',
            description: '确认边界',
            assignee: 'PM1',
            assigneeAccent: 'var(--accent)',
            priority: 'medium' as const,
            tags: ['待认领'],
            mutable: true,
          },
        ],
      },
      { id: 'doing', title: '进行中', cards: [] },
      { id: 'review', title: '待评审', cards: [] },
    ],
  }),
}));

import { TasksTab } from './TasksTab.js';
import type { AgentTeamsSidebarTeam } from '../../data/team-runtime-types.js';

const SELECTED_TEAM: AgentTeamsSidebarTeam = {
  id: 'session-1',
  title: '测试会话',
  subtitle: 'PM1',
  status: 'running',
};

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.canManageSessionEntries = true;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TasksTab', () => {
  it('推进按钮会把任务向右移动，而不是伪装成删除', async () => {
    render(<TasksTab selectedTeam={SELECTED_TEAM} />);

    fireEvent.click(screen.getByTitle('开始处理'));

    await waitFor(() => {
      expect(moveTaskMock).toHaveBeenCalledWith('task-1', 'right');
    });

    expect(screen.queryByTitle('删除')).toBeNull();
  });

  it('没有写入权限时禁用新增和推进任务入口', () => {
    state.canManageSessionEntries = false;

    render(<TasksTab selectedTeam={SELECTED_TEAM} />);

    expect(screen.getByText('当前工作区只读，无法新增或推进任务。')).toBeTruthy();
    expect(screen.getByText('只读')).toBeTruthy();
    expect(screen.getByTitle('开始处理').hasAttribute('disabled')).toBe(true);

    const addButtons = screen.getAllByRole('button', { name: /添加任务/i });
    expect(addButtons.length).toBeGreaterThan(0);
    expect(addButtons.every((button) => button.hasAttribute('disabled'))).toBe(true);

    fireEvent.click(screen.getByTitle('开始处理'));
    fireEvent.click(addButtons[0]!);

    expect(moveTaskMock).not.toHaveBeenCalled();
    expect(createTaskMock).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText('输入任务标题...')).toBeNull();
  });

  it('未选择会话时展示空状态', () => {
    render(<TasksTab />);

    expect(screen.getByText('先选择一个团队会话')).toBeTruthy();
  });

  it('展示统计概览和进度条', () => {
    render(<TasksTab selectedTeam={SELECTED_TEAM} />);

    expect(screen.getByRole('region', { name: '任务工作台摘要' })).toBeTruthy();
    expect(screen.getByText('任务编排面板')).toBeTruthy();
    expect(screen.getByText('完成/总数')).toBeTruthy();
    expect(screen.getByText('0/1')).toBeTruthy();
    expect(screen.getByLabelText('任务完成度 0%')).toBeTruthy();
  });
});
