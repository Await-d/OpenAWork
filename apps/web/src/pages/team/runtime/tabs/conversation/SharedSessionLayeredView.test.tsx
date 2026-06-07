// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../components/chat/markdown/markdown-message-content.js', () => ({
  default: ({ content }: { content: string }) => <div>{content}</div>,
}));

const runtimeReferenceState = vi.hoisted(() => ({
  activeSharedSession: null as null | {
    comments: Array<{ authorEmail: string; content: string; createdAt: string; id: string }>;
    pendingPermissions: Array<{
      createdAt: string;
      previewAction?: string;
      reason: string;
      requestId: string;
      scope: string;
      toolName: string;
    }>;
    pendingQuestions: Array<{
      createdAt: string;
      questions: Array<{ header: string; question: string }>;
      requestId: string;
      title: string;
      toolName: string;
    }>;
    session: {
      messages?: Array<{
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
  selectedSharedSession: null,
  sharedSessionLoading: false,
  sharedSessions: [] as Array<{ sessionId: string; title: string | null }>,
}));

vi.mock('../../data/team-runtime-reference-data.js', () => ({
  useTeamRuntimeReferenceViewData: () => runtimeReferenceState,
}));

import { SharedSessionLayeredView } from './shared-session-layered-view.js';

beforeEach(() => {
  cleanup();
  runtimeReferenceState.activeSharedSession = null;
  runtimeReferenceState.auditLogs = [];
  runtimeReferenceState.selectedSharedSession = null;
  runtimeReferenceState.sharedSessionLoading = false;
  runtimeReferenceState.sharedSessions = [];
});

afterEach(() => {
  cleanup();
});

describe('SharedSessionLayeredView', () => {
  it('支持在输出 / 评论 / 待办三种共享线程模式之间切换', () => {
    runtimeReferenceState.activeSharedSession = {
      comments: [
        {
          authorEmail: 'owner@example.com',
          content: '新增共享评论',
          createdAt: '2026-06-06T10:10:00.000Z',
          id: 'comment-1',
        },
      ],
      pendingPermissions: [
        {
          createdAt: '2026-06-06T10:12:00.000Z',
          previewAction: '写入 team page',
          reason: '需要更新共享页面',
          requestId: 'permission-1',
          scope: 'write team-page',
          toolName: 'write_file',
        },
      ],
      pendingQuestions: [
        {
          createdAt: '2026-06-06T10:13:00.000Z',
          questions: [{ header: '目标', question: '是否展示共享线程？' }],
          requestId: 'question-1',
          title: '确认共享线程方案',
          toolName: 'request_user_input',
        },
      ],
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
        createdAt: '2026-06-06T10:14:00.000Z',
        detail: null,
        id: 'audit-1',
        sessionId: 'shared-1',
        summary: '新增共享评论',
      },
    ];
    runtimeReferenceState.sharedSessions = [{ sessionId: 'shared-1', title: '共享会话 A' }];

    render(
      <SharedSessionLayeredView
        selectedTeam={{
          id: 'shared-1',
          isSharedSession: true,
          status: 'running',
          subtitle: '共享运行',
          title: '共享会话 A',
        }}
      />,
    );

    expect(screen.getByTestId('shared-layered-view')).toBeTruthy();
    expect(screen.getAllByText('共享输出 #1').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('tab', { name: /评论/i }));
    expect(screen.getByText('新增共享评论')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /待办/i }));
    expect(screen.getByText('权限请求 · write team-page')).toBeTruthy();
    expect(screen.getByText('问题请求 · request_user_input')).toBeTruthy();
  });
});
