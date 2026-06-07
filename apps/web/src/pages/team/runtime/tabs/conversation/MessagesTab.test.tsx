// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagesTab } from './MessagesTab.js';

const state = vi.hoisted(() => ({
  activeSharedSession: null as null | {
    comments: Array<{
      authorEmail: string;
      content: string;
      createdAt: string;
      id: string;
      sessionId: string;
    }>;
    pendingPermissions: unknown[];
    pendingQuestions: unknown[];
  },
  busy: false,
  canManageSessionEntries: true,
  messageCards: [
    {
      id: 'msg-1',
      memberId: 'member-pm1',
      from: 'PM1',
      fromAccent: 'var(--accent)',
      route: 'broadcast' as const,
      summary: '同步设计稿调整',
      timestamp: '09:30',
      to: '全体成员',
      toAccent: 'var(--aux)',
      type: 'update' as const,
    },
    {
      id: 'msg-2',
      memberId: 'member-executor',
      from: '执行代理',
      fromAccent: 'var(--success)',
      route: 'followup' as const,
      recipientMemberId: 'member-pm1',
      replyToMessageId: 'msg-1',
      summary: '接口联调已完成',
      timestamp: '09:45',
      to: 'PM1',
      toAccent: 'var(--accent)',
      type: 'result' as const,
    },
  ],
  reviewBusy: false,
  selectedSharedSession: null as null | {
    comments: Array<{
      authorEmail: string;
      content: string;
      createdAt: string;
      id: string;
      sessionId: string;
    }>;
    pendingPermissions: unknown[];
    pendingQuestions: unknown[];
  },
  sharedSessionLoading: false,
}));

const sendMessageMock = vi.fn(async () => true);
const createSharedSessionCommentMock = vi.fn(async () => true);

vi.mock('../../data/team-runtime-reference-data.js', () => ({
  useTeamRuntimeReferenceViewData: () => ({
    activeSharedSession: state.activeSharedSession,
    busy: state.busy,
    canManageSessionEntries: state.canManageSessionEntries,
    createSharedSessionComment: createSharedSessionCommentMock,
    messageCards: state.messageCards,
    reviewBusy: state.reviewBusy,
    selectedSharedSession: state.selectedSharedSession,
    sendMessage: sendMessageMock,
    sharedSessionLoading: state.sharedSessionLoading,
  }),
}));

vi.mock('../../../../../components/chat/markdown/markdown-message-content.js', () => ({
  default: ({ content }: { content: string }) => <span>{content}</span>,
}));

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.activeSharedSession = null;
  state.busy = false;
  state.canManageSessionEntries = true;
  state.messageCards = [
    {
      id: 'msg-1',
      memberId: 'member-pm1',
      from: 'PM1',
      fromAccent: 'var(--accent)',
      route: 'broadcast',
      summary: '同步设计稿调整',
      timestamp: '09:30',
      to: '全体成员',
      toAccent: 'var(--aux)',
      type: 'update',
    },
    {
      id: 'msg-2',
      memberId: 'member-executor',
      from: '执行代理',
      fromAccent: 'var(--success)',
      route: 'followup',
      recipientMemberId: 'member-pm1',
      replyToMessageId: 'msg-1',
      summary: '接口联调已完成',
      timestamp: '09:45',
      to: 'PM1',
      toAccent: 'var(--accent)',
      type: 'result',
    },
  ];
  state.reviewBusy = false;
  state.selectedSharedSession = null;
  state.sharedSessionLoading = false;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('MessagesTab', () => {
  it('发送广播后只调用真实消息接口，不依赖本地广播缓存回显', async () => {
    const { rerender } = render(<MessagesTab selectedTeam={null} />);

    expect(screen.queryByText('最近广播')).not.toBeNull();
    expect(screen.queryAllByText('同步设计稿调整').length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText('广播内容'), {
      target: { value: '新增广播消息' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送广播' }));

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith({
        content: '新增广播消息',
        type: 'update',
      });
    });

    expect(screen.queryAllByText('新增广播消息')).toHaveLength(0);

    state.messageCards = [
      {
        id: 'msg-3',
        memberId: 'member-lead',
        from: '团队负责人',
        fromAccent: 'var(--accent)',
        route: 'broadcast',
        summary: '新增广播消息',
        timestamp: '10:00',
        to: '全体成员',
        toAccent: 'var(--aux)',
        type: 'update',
      },
      ...state.messageCards,
    ];
    rerender(<MessagesTab selectedTeam={null} />);

    expect(screen.getAllByText('新增广播消息').length).toBeGreaterThan(0);
  });

  it('回复消息时发送真实 result 消息，并在成功后关闭回复输入', async () => {
    render(<MessagesTab selectedTeam={null} />);

    fireEvent.click(screen.getByRole('button', { name: '跟进 PM1' }));
    fireEvent.change(screen.getByLabelText('跟进 PM1'), {
      target: { value: '结果已确认' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送关于 PM1 的跟进消息' }));

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith({
        content: '【跟进 PM1 · 09:30】结果已确认',
        recipientMemberId: 'member-pm1',
        replyToMessageId: 'msg-1',
        type: 'result',
      });
    });

    await waitFor(() => {
      expect(screen.queryByRole('textbox', { name: '跟进 PM1' })).toBeNull();
    });
  });

  it('没有真实消息时展示空状态，不把占位消息渲染成卡片', () => {
    state.messageCards = [
      {
        id: 'empty-message',
        memberId: 'member-runtime',
        from: 'Team Runtime',
        fromAccent: 'var(--accent)',
        route: 'broadcast',
        summary: '当前消息总线为空，发送广播后这里会开始显示真实消息。',
        timestamp: '刚刚',
        to: '全体成员',
        toAccent: 'var(--aux)',
        type: 'update',
      },
    ];

    render(<MessagesTab selectedTeam={null} />);

    expect(screen.queryByText('暂无团队消息')).not.toBeNull();
    expect(screen.queryByText('最近广播')).toBeNull();
    expect(screen.queryByText('0 条')).not.toBeNull();
  });

  it('没有会话写入权限时禁用广播和跟进入口', () => {
    state.canManageSessionEntries = false;

    render(<MessagesTab selectedTeam={null} />);

    expect(screen.getByLabelText('广播内容').hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '发送广播' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '跟进 PM1' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('当前工作区不可写，无法发送广播或跟进消息。')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '跟进 PM1' }));
    fireEvent.change(screen.getByLabelText('广播内容'), {
      target: { value: '不会发送' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送广播' }));

    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: '跟进 PM1' })).toBeNull();
  });

  it('下钻到当前会话时只展示 scoped messageCards，而不会混入其他会话的全局消息', () => {
    state.messageCards = [
      {
        id: 'msg-scoped',
        memberId: 'member-pm1',
        from: 'PM1',
        fromAccent: 'var(--accent)',
        route: 'broadcast',
        summary: '当前会话内消息',
        timestamp: '10:00',
        to: '全体成员',
        toAccent: 'var(--aux)',
        type: 'update',
      },
    ];

    render(
      <MessagesTab
        selectedTeam={{
          id: 'session-root',
          title: '根会话',
          subtitle: '运行中',
          status: 'running',
        }}
      />,
    );

    expect(screen.getAllByText('当前会话内消息').length).toBeGreaterThan(0);
    expect(screen.queryByText('同步设计稿调整')).toBeNull();
    expect(screen.queryByText('接口联调已完成')).toBeNull();
  });

  it('选中共享会话时展示共享评论流，并通过真实共享评论接口发送评论', async () => {
    state.activeSharedSession = {
      comments: [
        {
          authorEmail: 'owner@example.com',
          content: '共享会话的第一条评论',
          createdAt: '2026-06-06T09:30:00.000Z',
          id: 'comment-1',
          sessionId: 'shared-1',
        },
      ],
      pendingPermissions: [{}],
      pendingQuestions: [{}],
    };

    render(
      <MessagesTab
        selectedTeam={{
          id: 'shared-1',
          isSharedSession: true,
          status: 'running',
          subtitle: '共享运行',
          title: '共享会话 A',
        }}
      />,
    );

    expect(screen.getByText('共享协作流')).toBeTruthy();
    expect(screen.getByText('共享会话的第一条评论')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '发送广播' })).toBeNull();

    fireEvent.change(screen.getByLabelText('共享评论内容'), {
      target: { value: '新的共享评论' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送共享评论' }));

    await waitFor(() => {
      expect(createSharedSessionCommentMock).toHaveBeenCalledWith('新的共享评论');
    });
    expect(sendMessageMock).not.toHaveBeenCalled();
  });
});
