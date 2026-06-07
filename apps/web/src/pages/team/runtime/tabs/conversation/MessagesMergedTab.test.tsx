// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const notificationState = vi.hoisted(() => ({
  unreadCount: 3,
}));

const runtimeReferenceState = vi.hoisted(() => ({
  activeSharedSession: null as null | {
    share?: { sessionId: string };
    pendingPermissions: Array<{ requestId: string }>;
    pendingQuestions: Array<{ requestId: string }>;
  },
  selectedSharedSession: null as null | {
    share?: { sessionId: string };
    pendingPermissions: Array<{ requestId: string }>;
    pendingQuestions: Array<{ requestId: string }>;
  },
}));

const childState = vi.hoisted(() => ({
  mentions: 0,
  messages: 0,
  sharedMentions: 0,
}));

vi.mock('../../../../../stores/team/team-events.js', () => ({
  useTeamNotificationStore: (selector: (state: { unreadCount: number }) => unknown) =>
    selector({ unreadCount: notificationState.unreadCount }),
}));

vi.mock('../../data/team-runtime-reference-data.js', () => ({
  useTeamRuntimeReferenceViewData: () => runtimeReferenceState,
}));

vi.mock('./MessagesTab.js', () => ({
  MessagesTab: () => {
    childState.messages += 1;
    return <div data-testid="messages-bus-view" />;
  },
}));

vi.mock('./MentionsView.js', () => ({
  MentionsView: () => {
    childState.mentions += 1;
    return <div data-testid="mentions-view" />;
  },
}));

vi.mock('./shared-session-mentions-view.js', () => ({
  SharedSessionMentionsView: () => {
    childState.sharedMentions += 1;
    return <div data-testid="shared-mentions-view" />;
  },
}));

import { MessagesMergedTab } from './MessagesMergedTab.js';

beforeEach(() => {
  cleanup();
  notificationState.unreadCount = 3;
  runtimeReferenceState.activeSharedSession = null;
  runtimeReferenceState.selectedSharedSession = null;
  childState.mentions = 0;
  childState.messages = 0;
  childState.sharedMentions = 0;
});

afterEach(() => {
  cleanup();
});

describe('MessagesMergedTab', () => {
  it('普通会话下第二个分段仍显示待回复，并渲染本地通知队列', async () => {
    render(
      <MessagesMergedTab
        onOpenBlockingTarget={vi.fn()}
        onOpenClarifications={vi.fn()}
        selectedTeam={{
          id: 'session-root',
          status: 'running',
          subtitle: '运行中',
          title: '根会话',
        }}
      />,
    );

    expect(screen.getByLabelText('待回复 3 条')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /待回复/i }));

    await waitFor(() => {
      expect(screen.getByTestId('mentions-view')).toBeTruthy();
    });
    expect(childState.sharedMentions).toBe(0);
  });

  it('共享会话下第二个分段切到共享协作待办，并用共享待办数做角标', async () => {
    runtimeReferenceState.activeSharedSession = {
      share: { sessionId: 'shared-1' },
      pendingPermissions: [{ requestId: 'permission-1' }],
      pendingQuestions: [{ requestId: 'question-1' }, { requestId: 'question-2' }],
    };

    render(
      <MessagesMergedTab
        onOpenBlockingTarget={vi.fn()}
        onOpenClarifications={vi.fn()}
        selectedTeam={{
          id: 'shared-1',
          isSharedSession: true,
          status: 'running',
          subtitle: '共享运行',
          title: '共享会话 A',
        }}
      />,
    );

    expect(screen.getByLabelText('协作待办 3 条')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /协作待办/i }));

    await waitFor(() => {
      expect(screen.getByTestId('shared-mentions-view')).toBeTruthy();
    });
    expect(childState.mentions).toBe(0);
  });

  it('共享会话详情尚未同步时，仍保持共享待办语义而不是回退本地通知队列', async () => {
    render(
      <MessagesMergedTab
        onOpenBlockingTarget={vi.fn()}
        onOpenClarifications={vi.fn()}
        selectedTeam={{
          id: 'shared-1',
          isSharedSession: true,
          status: 'running',
          subtitle: '共享运行',
          title: '共享会话 A',
        }}
      />,
    );

    expect(screen.queryByLabelText('待回复 3 条')).toBeNull();
    expect(screen.getByRole('tab', { name: /协作待办/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /协作待办/i }));

    await waitFor(() => {
      expect(screen.getByTestId('shared-mentions-view')).toBeTruthy();
    });
    expect(childState.mentions).toBe(0);
  });
});
