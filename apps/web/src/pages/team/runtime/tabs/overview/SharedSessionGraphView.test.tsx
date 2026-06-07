// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeReferenceState = vi.hoisted(() => ({
  activeSharedSession: null as null | {
    comments: Array<{ content: string; createdAt: string; id: string; authorEmail: string }>;
    pendingPermissions: Array<{ requestId: string }>;
    pendingQuestions: Array<{ requestId: string }>;
    presence: Array<{ active: boolean }>;
    session: {
      fileChangesSummary?: { snapshotCount: number };
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
      sharedByEmail: string;
      workspacePath: string | null;
    };
  },
  selectedSharedSession: null,
  sharedSessionLoading: false,
  sharedSessions: [] as Array<{
    sessionId: string;
    sharedByEmail: string;
    title: string | null;
    workspacePath: string | null;
  }>,
}));

vi.mock('../../data/team-runtime-reference-data.js', () => ({
  useTeamRuntimeReferenceViewData: () => runtimeReferenceState,
}));

import { SharedSessionGraphView } from './SharedSessionGraphView.js';

beforeEach(() => {
  cleanup();
  runtimeReferenceState.activeSharedSession = null;
  runtimeReferenceState.selectedSharedSession = null;
  runtimeReferenceState.sharedSessionLoading = false;
  runtimeReferenceState.sharedSessions = [];
});

afterEach(() => {
  cleanup();
});

describe('SharedSessionGraphView', () => {
  it('展示共享来源、输出、快照和待处理项之间的关系', () => {
    runtimeReferenceState.activeSharedSession = {
      comments: [
        {
          authorEmail: 'owner@example.com',
          content: '请看这里',
          createdAt: '2026-06-06T10:10:00.000Z',
          id: 'comment-1',
        },
      ],
      pendingPermissions: [{ requestId: 'permission-1' }],
      pendingQuestions: [{ requestId: 'question-1' }],
      presence: [{ active: true }],
      session: {
        fileChangesSummary: { snapshotCount: 2 },
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
    runtimeReferenceState.sharedSessions = [
      {
        sessionId: 'shared-1',
        sharedByEmail: 'owner@example.com',
        title: '共享会话 A',
        workspacePath: '/workspace/shared',
      },
    ];

    render(
      <SharedSessionGraphView
        selectedTeam={{
          id: 'shared-1',
          isSharedSession: true,
          status: 'running',
          subtitle: '共享运行',
          title: '共享会话 A',
        }}
      />,
    );

    expect(screen.getByTestId('shared-graph-view')).toBeTruthy();
    expect(screen.getByText('共享来源')).toBeTruthy();
    expect(screen.getByText('工作区快照')).toBeTruthy();
    expect(screen.getAllByText('共享输出').length).toBeGreaterThan(0);
    expect(screen.getAllByText('待处理项').length).toBeGreaterThan(0);
  });
});
