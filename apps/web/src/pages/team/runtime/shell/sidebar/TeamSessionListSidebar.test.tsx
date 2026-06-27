// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHandoffStore, useLayerStore } from '../../../../../stores/team/team-events.js';
import { publishSessionRunState } from '../../../../../utils/session/session-list-events.js';
import { TeamSessionListSidebar } from './TeamSessionListSidebar.js';

const copyTextToClipboardMock = vi.hoisted(() => vi.fn(async () => undefined));
const toastMock = vi.hoisted(() => vi.fn());

vi.mock('./SessionCard.js', () => ({
  SessionCard: ({
    session,
    onContextMenu,
    onSelect,
  }: {
    session: { id: string; title: string };
    onContextMenu: (event: React.MouseEvent, session: { id: string; title: string }) => void;
    onSelect: (sessionId: string) => void;
  }) => (
    <button
      type="button"
      aria-label={session.title}
      onClick={() => onSelect(session.id)}
      onContextMenu={(event) => onContextMenu(event, session)}
    >
      {session.title}
    </button>
  ),
}));

vi.mock('../../shared/TeamRunStatePill.js', () => ({
  TeamRunStatePill: () => <div data-testid="team-run-state-pill" />,
}));

vi.mock('../../../../../components/common/feedback/ToastNotification.js', () => ({
  toast: toastMock,
}));

vi.mock('../../../../../components/layout/file-tree/file-tree-actions.js', () => ({
  copyTextToClipboard: copyTextToClipboardMock,
}));

vi.mock('../modals/NewTeamSessionModal.js', () => ({
  NewTeamSessionModal: () => null,
}));

function createSession(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'session-1',
    isSharedSession: false,
    status: 'running' as const,
    subtitle: '运行中',
    title: '运行会话',
    updatedAt: '2026-06-04T09:00:00.000Z',
    ...overrides,
  };
}

function renderSidebar(props: Partial<React.ComponentProps<typeof TeamSessionListSidebar>> = {}) {
  const workspaceGroups = [
    {
      sessions: [createSession()],
      workspaceLabel: 'workspace/demo',
      workspacePath: '/workspace/demo',
    },
  ];

  return render(
    <TeamSessionListSidebar
      collapsed={false}
      onToggleCollapsed={() => {}}
      workspaceGroups={workspaceGroups}
      selectedTeamId=""
      onSelectTeam={() => {}}
      {...props}
    />,
  );
}

beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
  copyTextToClipboardMock.mockReset().mockResolvedValue(undefined);
  toastMock.mockReset();
});

afterEach(() => {
  cleanup();
  useHandoffStore.setState({ handoffs: new Map() });
  useLayerStore.setState({ nodes: new Map() });
  vi.restoreAllMocks();
});

describe('TeamSessionListSidebar', () => {
  it('运行中会话的右键菜单走真实重命名与暂停链路，且不再显示置顶假入口', async () => {
    const onRenameSession = vi.fn(async () => true);
    const onToggleSessionState = vi.fn(async () => true);
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('新的会话标题');

    renderSidebar({
      onRenameSession,
      onToggleSessionState,
    });

    fireEvent.contextMenu(screen.getByRole('button', { name: '运行会话' }));

    expect(screen.getByRole('menu', { name: '会话操作菜单' })).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: '重命名' })).not.toBeNull();
    expect(screen.queryByRole('menuitem', { name: '📌 置顶' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: '⏸ 暂停会话' })).not.toBeNull();

    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }));

    await waitFor(() => {
      expect(onRenameSession).toHaveBeenCalledWith('session-1', '新的会话标题');
    });
    expect(promptSpy).toHaveBeenCalledWith('重命名「运行会话」为：', '运行会话');

    fireEvent.contextMenu(screen.getByRole('button', { name: '运行会话' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '⏸ 暂停会话' }));

    await waitFor(() => {
      expect(onToggleSessionState).toHaveBeenCalledWith('session-1', 'running');
    });
  });

  it('共享会话不暴露重命名、恢复和删除等危险入口', () => {
    renderSidebar({
      workspaceGroups: [
        {
          sessions: [
            createSession({
              id: 'shared-1',
              isSharedSession: true,
              status: 'paused',
              subtitle: '已暂停',
              title: '共享会话',
            }),
          ],
          workspaceLabel: 'workspace/demo',
          workspacePath: '/workspace/demo',
        },
      ],
      onDeleteSession: vi.fn(),
      onRenameSession: vi.fn(async () => true),
      onToggleSessionState: vi.fn(async () => true),
    });

    fireEvent.contextMenu(screen.getByRole('button', { name: '共享会话' }));

    expect(screen.getByRole('menuitem', { name: '📋 复制 ID' })).not.toBeNull();
    expect(screen.queryByRole('menuitem', { name: '重命名' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: '▶ 恢复会话' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: '🔴 删除会话' })).toBeNull();
  });

  it('复制会话 ID 后会显示成功反馈', async () => {
    renderSidebar();

    fireEvent.contextMenu(screen.getByRole('button', { name: '运行会话' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '📋 复制 ID' }));

    await waitFor(() => {
      expect(copyTextToClipboardMock).toHaveBeenCalledWith('session-1');
    });
    expect(toastMock).toHaveBeenCalledWith('已复制会话 ID', 'success');
  });

  it('删除左侧根会话时展示完整下游层级影响范围', () => {
    renderSidebar({
      onDeleteSession: vi.fn(),
      workspaceGroups: [
        {
          sessions: [
            createSession({
              id: 'root-session',
              parentSessionId: null,
              roleLayer: 'reception',
              title: '根接待会话',
            }),
            createSession({
              id: 'pm1-session',
              parentSessionId: 'root-session',
              roleLayer: 'pm1',
              title: '规划层会话',
            }),
            createSession({
              id: 'pm2-session',
              parentSessionId: 'pm1-session',
              roleLayer: 'pm2',
              title: '管控层会话',
            }),
            createSession({
              id: 'executor-session',
              parentSessionId: 'pm2-session',
              roleLayer: 'executor',
              title: '执行层会话',
            }),
          ],
          workspaceLabel: 'workspace/demo',
          workspacePath: '/workspace/demo',
        },
      ],
    });

    fireEvent.contextMenu(screen.getByRole('button', { name: '根接待会话' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '🔴 删除会话' }));

    expect(screen.getByRole('alertdialog', { name: '确认删除会话' })).not.toBeNull();
    expect(screen.getByText('删除影响层级')).not.toBeNull();
    expect(screen.getByText(/当前层级：接待层/)).not.toBeNull();
    expect(screen.getByText(/将同时移除 3 个下游层级会话，共 4 个会话节点/)).not.toBeNull();

    const impactList = screen.getByLabelText('将被删除的会话层级');
    const rows = within(impactList).getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(rows[0]?.textContent).toContain('接待层');
    expect(rows[0]?.textContent).toContain('根接待会话');
    expect(rows[1]?.textContent).toContain('PM1 规划层');
    expect(rows[1]?.textContent).toContain('规划层会话');
    expect(rows[2]?.textContent).toContain('PM2 管控层');
    expect(rows[2]?.textContent).toContain('管控层会话');
    expect(rows[3]?.textContent).toContain('执行层');
    expect(rows[3]?.textContent).toContain('执行层会话');
  });

  it('没有会话管理权限时禁用新建入口，且右键菜单不暴露重命名/暂停/删除动作', () => {
    renderSidebar({
      canManageSessionEntries: false,
      onDeleteSession: vi.fn(),
      onRenameSession: vi.fn(async () => true),
      onToggleSessionState: vi.fn(async () => true),
      onSubmitDraft: vi.fn(async () => true),
      teamWorkspaceId: 'workspace-1',
    });

    expect(screen.getByRole('button', { name: '新建会话' }).hasAttribute('disabled')).toBe(true);

    fireEvent.contextMenu(screen.getByRole('button', { name: '运行会话' }));

    expect(screen.getByRole('menuitem', { name: '📋 复制 ID' })).not.toBeNull();
    expect(screen.queryByRole('menuitem', { name: '重命名' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: '⏸ 暂停会话' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: '🔴 删除会话' })).toBeNull();
  });

  it('没有 teamWorkspaceId 时也会禁用新建入口，避免出现可点但无效的假入口', () => {
    renderSidebar({
      canManageSessionEntries: true,
      onSubmitDraft: vi.fn(async () => true),
      teamWorkspaceId: undefined,
    });

    const createButton = screen.getByRole('button', { name: '新建会话' });
    expect(createButton.hasAttribute('disabled')).toBe(true);
    expect(createButton.getAttribute('title')).toBe('请先选择工作空间');
  });

  it('收到 session 运行态事件后会立即用最新状态更新会话动作', async () => {
    renderSidebar({
      workspaceGroups: [
        {
          sessions: [
            createSession({
              id: 'session-1',
              status: 'running',
              subtitle: '运行中',
              title: '运行会话',
            }),
          ],
          workspaceLabel: 'workspace/demo',
          workspacePath: '/workspace/demo',
        },
      ],
      onToggleSessionState: vi.fn(async () => true),
    });

    fireEvent.contextMenu(screen.getByRole('button', { name: '运行会话' }));
    expect(screen.getByRole('menuitem', { name: '⏸ 暂停会话' })).not.toBeNull();

    publishSessionRunState('session-1', 'paused');

    await waitFor(() => {
      fireEvent.contextMenu(screen.getByRole('button', { name: '运行会话' }));
      expect(screen.getByRole('menuitem', { name: '▶ 恢复会话' })).not.toBeNull();
    });
  });

  it('收到 session idle 事件后，不再把会话误当作已完成或继续展示暂停动作', async () => {
    renderSidebar({
      workspaceGroups: [
        {
          sessions: [
            createSession({
              id: 'session-1',
              status: 'running',
              subtitle: '运行中',
              title: '运行会话',
            }),
          ],
          workspaceLabel: 'workspace/demo',
          workspacePath: '/workspace/demo',
        },
      ],
      onToggleSessionState: vi.fn(async () => true),
    });

    publishSessionRunState('session-1', 'idle');

    await waitFor(() => {
      fireEvent.contextMenu(screen.getByRole('button', { name: '运行会话' }));
      expect(screen.queryByRole('menuitem', { name: '▶ 恢复会话' })).toBeNull();
      expect(screen.queryByRole('menuitem', { name: '⏸ 暂停会话' })).toBeNull();
    });
  });

  it('服务端快照为 completed，但实时下游仍在运行时，仍按运行中展示会话动作', async () => {
    useLayerStore.setState({
      nodes: new Map([
        [
          'session-1',
          {
            sessionId: 'session-1',
            parentSessionId: null,
            roleLayer: 'reception',
            state: 'idle',
          },
        ],
        [
          'child-1',
          {
            sessionId: 'child-1',
            parentSessionId: 'session-1',
            roleLayer: 'executor',
            state: 'running',
          },
        ],
      ]),
    });

    renderSidebar({
      workspaceGroups: [
        {
          sessions: [
            createSession({
              id: 'session-1',
              status: 'completed',
              subtitle: '已完成',
              title: '运行会话',
            }),
          ],
          workspaceLabel: 'workspace/demo',
          workspacePath: '/workspace/demo',
        },
      ],
      onToggleSessionState: vi.fn(async () => true),
    });

    await waitFor(() => {
      fireEvent.contextMenu(screen.getByRole('button', { name: '运行会话' }));
      expect(screen.getByRole('menuitem', { name: '⏸ 暂停会话' })).not.toBeNull();
    });
  });

  it('当服务端新列表给出终态时会清除本地过期运行态覆盖', async () => {
    const rendered = renderSidebar({
      workspaceGroups: [
        {
          sessions: [
            createSession({
              id: 'session-1',
              status: 'running',
              subtitle: '运行中',
              title: '运行会话',
            }),
          ],
          workspaceLabel: 'workspace/demo',
          workspacePath: '/workspace/demo',
        },
      ],
      onToggleSessionState: vi.fn(async () => true),
    });

    publishSessionRunState('session-1', 'paused');

    await waitFor(() => {
      fireEvent.contextMenu(screen.getByRole('button', { name: '运行会话' }));
      expect(screen.getByRole('menuitem', { name: '▶ 恢复会话' })).not.toBeNull();
    });

    rendered.rerender(
      <TeamSessionListSidebar
        collapsed={false}
        onToggleCollapsed={() => {}}
        workspaceGroups={[
          {
            sessions: [
              createSession({
                id: 'session-1',
                status: 'completed',
                subtitle: '已完成',
                title: '运行会话',
              }),
            ],
            workspaceLabel: 'workspace/demo',
            workspacePath: '/workspace/demo',
          },
        ]}
        selectedTeamId=""
        onSelectTeam={() => {}}
        onToggleSessionState={vi.fn(async () => true)}
      />,
    );

    await waitFor(() => {
      fireEvent.contextMenu(screen.getByRole('button', { name: '运行会话' }));
      expect(screen.queryByRole('menuitem', { name: '▶ 恢复会话' })).toBeNull();
      expect(screen.queryByRole('menuitem', { name: '⏸ 暂停会话' })).toBeNull();
    });
  });
});
