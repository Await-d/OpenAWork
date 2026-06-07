// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AgentTeamsReviewCard } from '../../data/team-runtime-types.js';

const state = vi.hoisted(() => ({
  canManageSessionEntries: true,
  reviewCards: [
    {
      id: 'review-1',
      title: '权限审批 · bash',
      summary: '需要确认是否允许执行 bash',
      assignee: '共享运行',
      assigneeAccent: 'var(--accent)',
      priority: 'medium' as const,
      status: 'pending' as const,
      type: 'security' as const,
      actionable: true,
      requestId: 'req-1',
      sessionId: 'shared-session-1',
    },
  ] as AgentTeamsReviewCard[],
  selectedSharedSession: {
    comments: [
      {
        id: 'comment-1',
        content: '[review-1] 已同步上下文',
      },
    ],
    pendingPermissions: [],
    pendingQuestions: [],
    presence: [],
    share: {
      sessionId: 'shared-session-1',
      title: '共享会话 A',
      stateStatus: 'running',
      sharedByEmail: 'alice@example.com',
    },
  } as {
    comments: Array<{ content: string; id: string }>;
    pendingPermissions: unknown[];
    pendingQuestions: unknown[];
    presence: unknown[];
    share: {
      sessionId: string;
      title: string | null;
      stateStatus: string;
      sharedByEmail: string;
    };
  } | null,
  activeSharedSession: null as {
    comments: Array<{ content: string; id: string }>;
    pendingPermissions: unknown[];
    pendingQuestions: unknown[];
    presence: unknown[];
    share: {
      sessionId: string;
      title: string | null;
      stateStatus: string;
      sharedByEmail: string;
    };
  } | null,
  sharedSessionLoading: false,
}));

const replyReviewMock = vi.fn(async () => true);
const submitReviewCommentMock = vi.fn(async () => true);

vi.mock('../../data/team-runtime-reference-data.js', () => ({
  useTeamRuntimeReferenceViewData: () => ({
    activeSharedSession: state.activeSharedSession,
    canManageSessionEntries: state.canManageSessionEntries,
    replyReview: replyReviewMock,
    reviewBusy: false,
    reviewCards: state.reviewCards,
    selectedSharedSession: state.selectedSharedSession,
    sharedSessionLoading: state.sharedSessionLoading,
    submitReviewComment: submitReviewCommentMock,
  }),
}));

import { ReviewTab } from './ReviewTab.js';

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.canManageSessionEntries = true;
  state.reviewCards = [
    {
      id: 'review-1',
      title: '权限审批 · bash',
      summary: '需要确认是否允许执行 bash',
      assignee: '共享运行',
      assigneeAccent: 'var(--accent)',
      priority: 'medium',
      status: 'pending',
      type: 'security',
      actionable: true,
      requestId: 'req-1',
      sessionId: 'shared-session-1',
    },
  ];
  state.selectedSharedSession = {
    comments: [
      {
        id: 'comment-1',
        content: '[review-1] 已同步上下文',
      },
    ],
    pendingPermissions: [],
    pendingQuestions: [],
    presence: [],
    share: {
      sessionId: 'shared-session-1',
      title: '共享会话 A',
      stateStatus: 'running',
      sharedByEmail: 'alice@example.com',
    },
  };
  state.activeSharedSession = state.selectedSharedSession;
  state.sharedSessionLoading = false;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ReviewTab', () => {
  it('支持通过，并且不再暴露本地“撤回”假动作', async () => {
    render(<ReviewTab />);

    fireEvent.click(screen.getByRole('button', { name: /通过/i }));
    await waitFor(() => {
      expect(replyReviewMock).toHaveBeenCalledWith('review-1', 'approved');
    });

    expect(screen.queryByRole('button', { name: /撤回/i })).toBeNull();
  });

  it('支持驳回', async () => {
    render(<ReviewTab />);

    fireEvent.click(screen.getByRole('button', { name: /驳回/i }));
    await waitFor(() => {
      expect(replyReviewMock).toHaveBeenCalledWith('review-1', 'rejected');
    });
  });

  it('头部优先展示当前共享会话信息', () => {
    render(<ReviewTab />);

    expect(screen.queryByText('共享会话 A')).not.toBeNull();
    expect(screen.queryByText('alice@example.com')).not.toBeNull();
    expect(screen.queryByText('运行中')).not.toBeNull();
  });

  it('共享会话切换后会重置评论输入并刷新头部上下文', () => {
    const { rerender } = render(<ReviewTab />);

    fireEvent.click(screen.getByRole('button', { name: /评论/i }));
    fireEvent.change(screen.getByPlaceholderText('添加评论...'), {
      target: { value: '待发送评论' },
    });

    state.selectedSharedSession = {
      comments: [],
      pendingPermissions: [],
      pendingQuestions: [],
      presence: [],
      share: {
        sessionId: 'shared-session-2',
        title: '共享会话 B',
        stateStatus: 'paused',
        sharedByEmail: 'bob@example.com',
      },
    };
    state.activeSharedSession = state.selectedSharedSession;
    rerender(<ReviewTab />);

    expect(screen.queryByPlaceholderText('添加评论...')).toBeNull();
    expect(screen.queryByText('共享会话 B')).not.toBeNull();
    expect(screen.queryByText('bob@example.com')).not.toBeNull();
    expect(screen.queryByText('待处理')).not.toBeNull();
  });

  it('切回普通 team session 时不会回退显示旧共享会话头部', () => {
    state.activeSharedSession = null;
    render(
      <ReviewTab
        selectedTeam={{
          id: 'runtime-session-1',
          title: '普通团队会话',
          subtitle: 'PM2 执行链',
          status: 'running',
        }}
      />,
    );

    expect(screen.queryByText('共享会话 A')).toBeNull();
    expect(screen.queryByText('alice@example.com')).toBeNull();
    expect(screen.queryByText('普通团队会话')).not.toBeNull();
    expect(screen.queryByText('PM2 执行链')).not.toBeNull();
  });

  it('共享详情加载中时展示明确 loading 态，而不是误判为暂无待审项', () => {
    state.activeSharedSession = null;
    state.selectedSharedSession = null;
    state.sharedSessionLoading = true;

    render(<ReviewTab />);

    expect(screen.getByText('正在同步共享评审队列')).toBeTruthy();
    expect(screen.queryByText('权限审批 · bash')).toBeNull();
  });

  it('共享会话已选中但详情不可用时，展示明确空态而不是误用占位评审卡片', () => {
    state.activeSharedSession = null;
    state.selectedSharedSession = null;
    state.sharedSessionLoading = false;

    render(
      <ReviewTab
        selectedTeam={{
          id: 'shared-session-1',
          isSharedSession: true,
          title: '共享会话 A',
          subtitle: '共享运行',
          status: 'running',
        }}
      />,
    );

    expect(screen.getByText('共享评审详情暂不可用')).toBeTruthy();
    expect(screen.queryByText('权限审批 · bash')).toBeNull();
  });

  it('没有写入权限时禁用评论和评审动作', async () => {
    state.canManageSessionEntries = false;

    render(<ReviewTab />);

    expect(screen.getByText('当前工作区不可写，无法评论或处理评审项。')).toBeTruthy();

    const commentButton = screen.getByRole('button', { name: /评论/i });
    const approveButton = screen.getByRole('button', { name: /通过/i });
    const rejectButton = screen.getByRole('button', { name: /驳回/i });

    expect(commentButton.hasAttribute('disabled')).toBe(true);
    expect(approveButton.hasAttribute('disabled')).toBe(true);
    expect(rejectButton.hasAttribute('disabled')).toBe(true);

    fireEvent.click(commentButton);
    fireEvent.click(approveButton);
    fireEvent.click(rejectButton);

    expect(screen.queryByPlaceholderText('添加评论...')).toBeNull();
    expect(replyReviewMock).not.toHaveBeenCalled();
    expect(submitReviewCommentMock).not.toHaveBeenCalled();
  });

  it('下钻到当前会话时只展示 scoped reviewCards，而不会混入其他会话的审计项', () => {
    state.activeSharedSession = null;
    state.selectedSharedSession = null;
    state.reviewCards = [
      {
        id: 'audit-in',
        title: '当前会话审计',
        summary: '当前会话内的审计轨迹',
        assignee: '系统',
        assigneeAccent: 'var(--aux)',
        priority: 'low',
        status: 'approved',
        type: 'code',
        actionable: false,
      },
    ];

    render(
      <ReviewTab
        selectedTeam={{
          id: 'session-root',
          title: '根会话',
          subtitle: '当前下钻',
          status: 'running',
        }}
      />,
    );

    expect(screen.getByText('当前会话审计')).toBeTruthy();
    expect(screen.queryByText('权限审批 · bash')).toBeNull();
  });
});
