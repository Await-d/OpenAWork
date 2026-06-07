// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeReferenceState = vi.hoisted(() => ({
  activeSharedSession: null as null | {
    comments: Array<{ authorEmail: string; content: string; createdAt: string; id: string }>;
    pendingPermissions: Array<{ requestId: string }>;
    pendingQuestions: Array<{ requestId: string }>;
    presence: Array<{ active: boolean }>;
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
      sharedByEmail: string;
      workspacePath: string | null;
    };
  },
  auditLogs: [] as Array<{
    createdAt: string;
    detail: string | null;
    id: string;
    sessionId: string | null;
    summary: string;
  }>,
  selectedSharedSession: null,
  sharedSessionLoading: false,
  sharedSessions: [] as Array<{
    sessionId: string;
    title: string | null;
    sharedByEmail: string;
    workspacePath: string | null;
  }>,
}));

vi.mock('../../data/team-runtime-reference-data.js', () => ({
  useTeamRuntimeReferenceViewData: () => runtimeReferenceState,
}));

import { SharedSessionFlowView } from './shared-session-flow-view.js';

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

describe('SharedSessionFlowView', () => {
  it('展示共享来源到待处理项的协作流与最近事件', () => {
    runtimeReferenceState.activeSharedSession = {
      comments: [
        {
          authorEmail: 'owner@example.com',
          content: '新增共享评论',
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
        sharedByEmail: 'owner@example.com',
        workspacePath: '/workspace/shared',
      },
    };
    runtimeReferenceState.auditLogs = [
      {
        createdAt: '2026-06-06T10:12:00.000Z',
        detail: null,
        id: 'audit-1',
        sessionId: 'shared-1',
        summary: '新增共享评论',
      },
    ];
    runtimeReferenceState.sharedSessions = [
      {
        sessionId: 'shared-1',
        title: '共享会话 A',
        sharedByEmail: 'owner@example.com',
        workspacePath: '/workspace/shared',
      },
    ];

    render(
      <SharedSessionFlowView
        selectedTeam={{
          id: 'shared-1',
          isSharedSession: true,
          status: 'running',
          subtitle: '共享运行',
          title: '共享会话 A',
        }}
      />,
    );

    expect(screen.getByTestId('shared-flow-view')).toBeTruthy();
    expect(screen.getByText('共享来源')).toBeTruthy();
    expect(screen.getAllByText('待处理项').length).toBeGreaterThan(0);
    expect(screen.getByText('最近共享事件')).toBeTruthy();
    expect(screen.getAllByText('新增共享评论').length).toBeGreaterThan(0);
  });
});
