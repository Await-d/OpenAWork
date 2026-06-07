// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeReferenceState = vi.hoisted(() => ({
  activeSharedSession: null as null | {
    comments: Array<{ id: string }>;
    pendingPermissions: Array<{ requestId: string }>;
    pendingQuestions: Array<{ requestId: string }>;
    session: {
      fileChangesSummary?: {
        latestSnapshotAt?: string;
        snapshotCount: number;
        sourceKinds: string[];
      };
      messages?: Array<{ role: string }>;
    };
    share: {
      sessionId: string;
      title: string | null;
      permission: string;
      shareCreatedAt: string;
      shareUpdatedAt: string;
      sharedByEmail: string;
      stateStatus: string;
      workspacePath: string | null;
    };
  },
  selectedSharedSession: null,
  sharedSessionLoading: false,
  sharedSessions: [] as Array<{
    sessionId: string;
    title: string | null;
    permission: string;
    shareCreatedAt: string;
    shareUpdatedAt: string;
    sharedByEmail: string;
    stateStatus: string;
    workspacePath: string | null;
  }>,
}));

vi.mock('../../data/team-runtime-reference-data.js', () => ({
  useTeamRuntimeReferenceViewData: () => runtimeReferenceState,
}));

import { SharedSessionInitView } from './SharedSessionInitView.js';

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

describe('SharedSessionInitView', () => {
  it('展示共享接入摘要和当前已知上下文', () => {
    runtimeReferenceState.activeSharedSession = {
      comments: [{ id: 'comment-1' }],
      pendingPermissions: [{ requestId: 'permission-1' }],
      pendingQuestions: [{ requestId: 'question-1' }],
      session: {
        fileChangesSummary: {
          latestSnapshotAt: '2026-06-06T10:10:00.000Z',
          snapshotCount: 2,
          sourceKinds: ['session_snapshot'],
        },
        messages: [{ role: 'assistant' }, { role: 'assistant' }],
      },
      share: {
        sessionId: 'shared-1',
        title: '共享会话 A',
        permission: 'operate',
        shareCreatedAt: '2026-06-06T10:00:00.000Z',
        shareUpdatedAt: '2026-06-06T10:12:00.000Z',
        sharedByEmail: 'owner@example.com',
        stateStatus: 'running',
        workspacePath: '/workspace/shared',
      },
    };
    runtimeReferenceState.sharedSessions = [
      {
        sessionId: 'shared-1',
        title: '共享会话 A',
        permission: 'operate',
        shareCreatedAt: '2026-06-06T10:00:00.000Z',
        shareUpdatedAt: '2026-06-06T10:12:00.000Z',
        sharedByEmail: 'owner@example.com',
        stateStatus: 'running',
        workspacePath: '/workspace/shared',
      },
    ];

    render(
      <SharedSessionInitView
        selectedTeam={{
          id: 'shared-1',
          isSharedSession: true,
          status: 'running',
          subtitle: '共享运行',
          title: '共享会话 A',
        }}
      />,
    );

    expect(screen.getByTestId('shared-init-view')).toBeTruthy();
    expect(screen.getByText('共享者')).toBeTruthy();
    expect(screen.getByText('工作区')).toBeTruthy();
    expect(screen.getByText('当前已知上下文')).toBeTruthy();
  });
});
