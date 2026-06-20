// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AgentTeamsMessageCard } from '../../data/team-runtime-types.js';
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
  ] as AgentTeamsMessageCard[],
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
        sessionId: 'session-root',
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
      {
        id: 'msg-other-session',
        sessionId: 'session-other',
        memberId: 'member-executor',
        from: '执行代理',
        fromAccent: 'var(--success)',
        route: 'broadcast',
        summary: '其他会话消息',
        timestamp: '10:05',
        to: '全体成员',
        toAccent: 'var(--aux)',
        type: 'update',
      },
      {
        id: 'msg-legacy-global',
        memberId: 'member-reviewer',
        from: '评审代理',
        fromAccent: 'var(--warning)',
        route: 'broadcast',
        summary: '旧全局消息',
        timestamp: '10:10',
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
    expect(screen.queryByText('其他会话消息')).toBeNull();
    expect(screen.queryByText('旧全局消息')).toBeNull();
  });

  it('下钻会话时不会因为全局最近 8 条消息属于其他会话而把当前会话显示为空', () => {
    state.messageCards = [
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `msg-other-${index}`,
        sessionId: 'session-other',
        memberId: 'member-executor',
        from: '执行代理',
        fromAccent: 'var(--success)',
        route: 'broadcast' as const,
        summary: `其他会话较新消息 ${index}`,
        timestamp: `10:0${index}`,
        to: '全体成员',
        toAccent: 'var(--aux)',
        type: 'update' as const,
      })),
      {
        id: 'msg-scoped-old',
        sessionId: 'session-root',
        memberId: 'member-pm1',
        from: 'PM1',
        fromAccent: 'var(--accent)',
        route: 'broadcast',
        summary: '当前会话较旧消息',
        timestamp: '09:00',
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

    expect(screen.getAllByText('当前会话较旧消息').length).toBeGreaterThan(0);
    expect(screen.queryByText('其他会话较新消息 0')).toBeNull();
    expect(screen.queryByText('暂无团队消息')).toBeNull();
  });

  it('下钻到普通会话后发送广播会写入当前会话 sessionId', async () => {
    render(
      <MessagesTab
        selectedTeam={{
          id: 'session-child',
          title: '子会话',
          subtitle: '执行层',
          status: 'running',
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText('广播内容'), {
      target: { value: '只发给当前子会话' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送广播' }));

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith({
        content: '只发给当前子会话',
        sessionId: 'session-child',
        type: 'update',
      });
    });
  });

  it('下钻到普通会话后回复消息会写入当前会话 sessionId', async () => {
    state.messageCards = [
      {
        id: 'msg-child',
        sessionId: 'session-child',
        memberId: 'member-executor',
        from: '执行代理',
        fromAccent: 'var(--success)',
        route: 'broadcast',
        summary: '当前子会话消息',
        timestamp: '10:15',
        to: '全体成员',
        toAccent: 'var(--aux)',
        type: 'update',
      },
    ];

    render(
      <MessagesTab
        selectedTeam={{
          id: 'session-child',
          title: '子会话',
          subtitle: '执行层',
          status: 'running',
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '跟进 执行代理' }));
    fireEvent.change(screen.getByLabelText('跟进 执行代理'), {
      target: { value: '结果已同步' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送关于 执行代理 的跟进消息' }));

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith({
        content: '【跟进 执行代理 · 10:15】结果已同步',
        recipientMemberId: 'member-executor',
        replyToMessageId: 'msg-child',
        sessionId: 'session-child',
        type: 'result',
      });
    });
  });

  it('普通会话和共享会话之间切换时保持 hooks 调用顺序稳定', () => {
    state.activeSharedSession = {
      comments: [],
      pendingPermissions: [],
      pendingQuestions: [],
    };
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const { rerender } = render(
        <MessagesTab
          selectedTeam={{
            id: 'session-root',
            status: 'running',
            subtitle: '运行中',
            title: '普通会话',
          }}
        />,
      );

      rerender(
        <MessagesTab
          selectedTeam={{
            id: 'shared-1',
            isSharedSession: true,
            status: 'running',
            subtitle: '共享运行',
            title: '共享会话',
          }}
        />,
      );

      rerender(
        <MessagesTab
          selectedTeam={{
            id: 'session-child',
            status: 'running',
            subtitle: '执行层',
            title: '子会话',
          }}
        />,
      );

      const hookOrderWarnings = consoleErrorSpy.mock.calls.filter(
        ([message]) =>
          typeof message === 'string' &&
          message.includes('React has detected a change in the order of Hooks'),
      );

      expect(screen.getByText('消息总线')).toBeTruthy();
      expect(hookOrderWarnings).toHaveLength(0);
    } finally {
      consoleErrorSpy.mockRestore();
    }
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
