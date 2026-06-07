// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const deleteSessionShareMock = vi.fn(async () => true);
const updateSessionShareMock = vi.fn(async () => true);
const setSelectedSharedSessionIdMock = vi.fn();
const createSessionShareMock = vi.fn(async () => true);
const state = vi.hoisted(() => ({
  canManageSessionEntries: true,
}));

function buildViewData(overrides: Record<string, unknown> = {}) {
  return {
    canManageSessionEntries: state.canManageSessionEntries,
    createSessionShare: createSessionShareMock,
    deleteSessionShare: deleteSessionShareMock,
    updateSessionShare: updateSessionShareMock,
    setSelectedSharedSessionId: setSelectedSharedSessionIdMock,
    selectedSharedSession: null,
    sharedSessionLoading: false,
    members: [
      {
        id: 'member-1',
        name: '林雾',
      },
      {
        id: 'member-2',
        name: '沈括',
      },
    ],
    workspaceGroups: [
      {
        workspaceLabel: '默认工作区',
        workspacePath: '/workspace/app',
        sessions: [
          {
            id: 'session-1',
            title: '需求评审会话',
          },
        ],
      },
    ],
    sessionShares: [
      {
        id: 'share-1',
        sessionId: 'session-1',
        sessionLabel: '需求评审会话',
        workspacePath: '/workspace/app',
        memberId: 'member-1',
        memberName: '林雾',
        memberEmail: 'linwu@example.com',
        permission: 'view' as const,
        createdAt: '2026-06-01T10:00:00.000Z',
        updatedAt: '2026-06-01T10:00:00.000Z',
      },
    ],
    sharedSessions: [
      {
        sessionId: 'incoming-1',
        title: '外部共享会话',
        workspacePath: '/workspace/shared',
        stateStatus: 'running',
        shareCreatedAt: '2026-06-01T10:00:00.000Z',
        shareUpdatedAt: '2026-06-01T10:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

let currentViewData = buildViewData();

vi.mock('../../data/team-runtime-reference-data.js', () => ({
  useTeamRuntimeReferenceViewData: () => currentViewData,
}));

import { SharesView } from './SharesView.js';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.canManageSessionEntries = true;
  currentViewData = buildViewData();
});

describe('SharesView', () => {
  it('没有任何共享记录时仍保留新建共享入口', () => {
    currentViewData = buildViewData({
      sessionShares: [],
      sharedSessions: [],
    });

    render(<SharesView />);

    expect(screen.getByTestId('shares-create-form')).toBeTruthy();
    expect(screen.getByText('你还没有共享任何会话。')).toBeTruthy();
    expect(screen.queryByText('暂无共享记录')).toBeNull();
  });

  it('支持切换到“共享给我的”并打开会话', () => {
    render(<SharesView />);

    fireEvent.click(screen.getByRole('button', { name: /共享给我的/i }));
    fireEvent.click(screen.getByRole('button', { name: '查看详情' }));

    expect(setSelectedSharedSessionIdMock).toHaveBeenCalledWith('incoming-1');
  });

  it('支持修改共享权限和取消共享', async () => {
    render(<SharesView />);

    fireEvent.click(screen.getByRole('button', { name: '切换 林雾 的共享权限' }));
    await waitFor(() => {
      expect(updateSessionShareMock).toHaveBeenCalledWith('share-1', { permission: 'comment' });
    });

    fireEvent.click(screen.getByRole('button', { name: '取消共享给 林雾' }));
    await waitFor(() => {
      expect(deleteSessionShareMock).toHaveBeenCalledWith('share-1');
    });
  });

  it('支持新建共享', async () => {
    render(<SharesView />);
    const forms = document.querySelectorAll('[data-testid="shares-create-form"]');
    const form = forms[forms.length - 1] as HTMLElement;

    fireEvent.change(within(form).getByLabelText('选择共享会话'), {
      target: { value: 'session-1' },
    });
    fireEvent.change(within(form).getByLabelText('选择共享成员'), {
      target: { value: 'member-2' },
    });
    fireEvent.change(within(form).getByLabelText('选择共享权限'), {
      target: { value: 'operate' },
    });
    fireEvent.click(within(form).getByRole('button', { name: '创建共享' }));

    await waitFor(() => {
      expect(createSessionShareMock).toHaveBeenCalledWith({
        sessionId: 'session-1',
        memberId: 'member-2',
        permission: 'operate',
      });
    });
  });

  it('没有写入权限时禁用新建共享和修改共享动作', () => {
    state.canManageSessionEntries = false;
    currentViewData = buildViewData();

    render(<SharesView />);

    expect(screen.getByText('当前工作区不可写，无法新建或修改共享。')).toBeTruthy();
    expect(screen.getByLabelText('选择共享会话').hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText('选择共享成员').hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText('选择共享权限').hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '创建共享' }).hasAttribute('disabled')).toBe(true);
    expect(
      screen.getByRole('button', { name: '切换 林雾 的共享权限' }).hasAttribute('disabled'),
    ).toBe(true);
    expect(screen.getByRole('button', { name: '取消共享给 林雾' }).hasAttribute('disabled')).toBe(
      true,
    );

    fireEvent.click(screen.getByRole('button', { name: '创建共享' }));
    fireEvent.click(screen.getByRole('button', { name: '切换 林雾 的共享权限' }));
    fireEvent.click(screen.getByRole('button', { name: '取消共享给 林雾' }));

    expect(createSessionShareMock).not.toHaveBeenCalled();
    expect(updateSessionShareMock).not.toHaveBeenCalled();
    expect(deleteSessionShareMock).not.toHaveBeenCalled();
  });
});
