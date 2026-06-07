// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const mockHandoffs = new Map();
const mockNodes = new Map();
const runtimeReferenceState = {
  activeSharedSession: null as null | {
    comments: Array<{
      content: string;
      createdAt: string;
      id: string;
      authorEmail: string;
      sessionId: string;
    }>;
    session: {
      fileChangesSummary?: { latestSnapshotAt?: string; snapshotCount: number };
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
      stateStatus: string;
      shareCreatedAt: string;
      shareUpdatedAt: string;
      sharedByEmail?: string;
      workspacePath?: string | null;
      permission?: string;
      createdAt?: string;
      updatedAt?: string;
    };
  },
  selectedSharedSession: null as null | {
    comments: Array<{
      content: string;
      createdAt: string;
      id: string;
      authorEmail: string;
      sessionId: string;
    }>;
    session: {
      fileChangesSummary?: { latestSnapshotAt?: string; snapshotCount: number };
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
      stateStatus: string;
      shareCreatedAt: string;
      shareUpdatedAt: string;
      sharedByEmail?: string;
      workspacePath?: string | null;
      permission?: string;
      createdAt?: string;
      updatedAt?: string;
    };
  },
  sharedSessionLoading: false,
  sharedSessions: [] as Array<{
    sessionId: string;
    title: string | null;
    stateStatus: string;
    shareUpdatedAt: string;
  }>,
};

vi.mock('../../../../../stores/team/team-events.js', () => ({
  useHandoffStore: (selector: (state: { handoffs: typeof mockHandoffs }) => unknown) =>
    selector({ handoffs: mockHandoffs }),
  useLayerStore: (selector: (state: { nodes: typeof mockNodes }) => unknown) =>
    selector({ nodes: mockNodes }),
}));

vi.mock('../../data/team-runtime-reference-data.js', () => ({
  useTeamRuntimeReferenceViewData: () => runtimeReferenceState,
}));

import { TimingView } from './TimingView.js';

function hasExactNormalizedText(expected: string) {
  const normalizedExpected = expected.replace(/\s+/g, ' ').trim();
  return (_content: string, element: Element | null) =>
    (element?.textContent ?? '').replace(/\s+/g, ' ').trim() === normalizedExpected;
}

beforeEach(() => {
  cleanup();
  mockHandoffs.clear();
  mockNodes.clear();
  runtimeReferenceState.activeSharedSession = null;
  runtimeReferenceState.selectedSharedSession = null;
  runtimeReferenceState.sharedSessionLoading = false;
  runtimeReferenceState.sharedSessions = [];
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-06-04T15:30:00.000Z'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('TimingView', () => {
  it('未选中会话时展示全局 handoff 统计', () => {
    mockHandoffs.set('handoff-global', {
      id: 'handoff-global',
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
      fromSessionId: 'session-a',
      toSessionId: 'session-b',
      sessionId: 'session-b',
      state: 'running',
      startedAt: Date.parse('2026-06-04T15:29:00.000Z'),
      updatedAt: Date.parse('2026-06-04T15:29:00.000Z'),
    });

    render(<TimingView />);

    expect(screen.getByText('接待 → PM1')).toBeTruthy();
    expect(screen.queryByText('当前统计范围：')).toBeNull();
  });

  it('选中会话后只统计当前会话及其子树 handoff', () => {
    mockNodes.set('session-root', {
      sessionId: 'session-root',
      roleLayer: 'pm1',
      parentSessionId: null,
      state: 'running',
    });
    mockNodes.set('session-child', {
      sessionId: 'session-child',
      roleLayer: 'pm2',
      parentSessionId: 'session-root',
      state: 'running',
    });
    mockNodes.set('session-other', {
      sessionId: 'session-other',
      roleLayer: 'reviewer',
      parentSessionId: null,
      state: 'running',
    });

    mockHandoffs.set('handoff-in-scope', {
      id: 'handoff-in-scope',
      fromRoleLayer: 'pm1',
      toRoleLayer: 'pm2',
      fromSessionId: 'session-root',
      toSessionId: 'session-child',
      sessionId: 'session-child',
      state: 'running',
      startedAt: Date.parse('2026-06-04T15:29:00.000Z'),
      updatedAt: Date.parse('2026-06-04T15:29:00.000Z'),
    });
    mockHandoffs.set('handoff-out-of-scope', {
      id: 'handoff-out-of-scope',
      fromRoleLayer: 'reviewer',
      toRoleLayer: 'executor',
      fromSessionId: 'session-other',
      toSessionId: 'session-external',
      sessionId: 'session-external',
      state: 'running',
      startedAt: Date.parse('2026-06-04T15:28:30.000Z'),
      updatedAt: Date.parse('2026-06-04T15:28:30.000Z'),
    });

    render(<TimingView selectedSessionId="session-root" selectedSessionTitle="根会话" />);

    expect(screen.getByText(hasExactNormalizedText('当前统计范围：根会话 及其子树'))).toBeTruthy();
    expect(screen.getByText('PM1 → PM2')).toBeTruthy();
    expect(screen.queryByText('评审 → 执行')).toBeNull();
  });

  it('选中会话但没有命中 handoff 时展示当前会话空态', () => {
    mockNodes.set('session-root', {
      sessionId: 'session-root',
      roleLayer: 'pm1',
      parentSessionId: null,
      state: 'running',
    });
    mockHandoffs.set('handoff-other', {
      id: 'handoff-other',
      fromRoleLayer: 'reviewer',
      toRoleLayer: 'executor',
      fromSessionId: 'session-other',
      toSessionId: 'session-external',
      sessionId: 'session-external',
      state: 'running',
      startedAt: Date.parse('2026-06-04T15:28:30.000Z'),
      updatedAt: Date.parse('2026-06-04T15:28:30.000Z'),
    });

    render(<TimingView selectedSessionId="session-root" selectedSessionTitle="根会话" />);

    expect(screen.getByText('当前会话暂无 handoff 记录')).toBeTruthy();
    expect(
      screen.getByText(
        hasExactNormalizedText('根会话 及其下游会话产生 handoff 后，这里会展示对应耗时。'),
      ),
    ).toBeTruthy();
  });

  it('选中共享会话时展示共享协作时序，而不是 runtime handoff 统计', () => {
    runtimeReferenceState.sharedSessions = [
      {
        sessionId: 'shared-1',
        title: '共享会话 A',
        stateStatus: 'running',
        shareUpdatedAt: '2026-06-04T15:28:00.000Z',
      },
    ];
    runtimeReferenceState.activeSharedSession = {
      comments: [
        {
          id: 'comment-1',
          authorEmail: 'owner@example.com',
          content: '请确认耗时窗口',
          createdAt: '2026-06-04T15:29:00.000Z',
          sessionId: 'shared-1',
        },
      ],
      session: {
        fileChangesSummary: {
          latestSnapshotAt: '2026-06-04T15:27:30.000Z',
          snapshotCount: 2,
        },
        messages: [
          {
            id: 'assistant-1',
            role: 'assistant',
            createdAt: Date.parse('2026-06-04T15:26:00.000Z'),
            content: [{ type: 'text', text: '第一版共享输出' }],
          },
          {
            id: 'assistant-2',
            role: 'assistant',
            createdAt: Date.parse('2026-06-04T15:28:00.000Z'),
            content: [{ type: 'text', text: '第二版共享输出' }],
          },
        ],
      },
      share: {
        sessionId: 'shared-1',
        title: '共享会话 A',
        stateStatus: 'running',
        shareCreatedAt: '2026-06-04T15:20:00.000Z',
        shareUpdatedAt: '2026-06-04T15:28:00.000Z',
      },
    };

    render(<TimingView selectedSessionId="shared-1" selectedSessionTitle="共享会话 A" />);

    expect(screen.getByTestId('shared-timing-view')).toBeTruthy();
    expect(screen.getByText(/当前统计范围：共享会话 A（共享会话快照）/)).toBeTruthy();
    expect(screen.getByText('Assistant 输出')).toBeTruthy();
    expect(screen.getByText('关键时间线')).toBeTruthy();
    expect(screen.getByText('共享建立')).toBeTruthy();
    expect(screen.queryByText('Handoff 总数')).toBeNull();
  });
});
