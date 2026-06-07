// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeReferenceState = vi.hoisted(() => ({
  activeSharedSession: null as null | {
    pendingPermissions: Array<{
      previewAction?: string;
      reason: string;
      requestId: string;
      riskLevel: string;
      scope: string;
      toolName: string;
    }>;
    pendingQuestions: Array<{
      questions: Array<{ header: string; question: string }>;
      requestId: string;
      title: string;
      toolName: string;
    }>;
  },
  canManageSessionEntries: true,
  replyReview: vi.fn(async () => true),
  reviewBusy: false,
  selectedSharedSession: null,
  sharedSessionLoading: false,
}));

vi.mock('../../data/team-runtime-reference-data.js', () => ({
  useTeamRuntimeReferenceViewData: () => runtimeReferenceState,
}));

import { SharedSessionMentionsView } from './shared-session-mentions-view.js';

beforeEach(() => {
  cleanup();
  runtimeReferenceState.activeSharedSession = null;
  runtimeReferenceState.canManageSessionEntries = true;
  runtimeReferenceState.replyReview.mockReset().mockResolvedValue(true);
  runtimeReferenceState.reviewBusy = false;
  runtimeReferenceState.selectedSharedSession = null;
  runtimeReferenceState.sharedSessionLoading = false;
});

afterEach(() => {
  cleanup();
});

describe('SharedSessionMentionsView', () => {
  it('共享会话下展示真实待办，并通过真实 replyReview 链路处理', async () => {
    runtimeReferenceState.activeSharedSession = {
      pendingPermissions: [
        {
          previewAction: '写入 team page',
          reason: '需要更新共享入口',
          requestId: 'permission-1',
          riskLevel: 'medium',
          scope: 'write team-page',
          toolName: 'write_file',
        },
      ],
      pendingQuestions: [
        {
          requestId: 'question-1',
          title: '确认共享需求',
          toolName: 'request_user_input',
          questions: [{ header: '目标', question: '是否要展示协作待办？' }],
        },
      ],
    };

    render(
      <SharedSessionMentionsView
        selectedTeam={{
          id: 'shared-1',
          isSharedSession: true,
          status: 'running',
          subtitle: '共享运行',
          title: '共享会话 A',
        }}
      />,
    );

    expect(screen.getByText('权限请求 · 写入 team page')).toBeTruthy();
    expect(screen.getByText('问题请求 · 确认共享需求')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '允许本会话' }));
    fireEvent.click(screen.getByRole('button', { name: '标记已答复' }));

    await waitFor(() => {
      expect(runtimeReferenceState.replyReview).toHaveBeenCalledWith(
        'permission-permission-1',
        'approved',
      );
    });
    await waitFor(() => {
      expect(runtimeReferenceState.replyReview).toHaveBeenCalledWith(
        'question-question-1',
        'approved',
      );
    });
  });
});
