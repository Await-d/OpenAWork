// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  overviewCards: [],
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
