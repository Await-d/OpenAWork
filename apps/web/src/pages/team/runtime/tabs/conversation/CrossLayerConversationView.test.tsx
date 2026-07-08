// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { TeamRuntimeSessionRecord } from '@openAwork/web-client';
import {
  useHandoffStore,
  useLayerStore,
  type HandoffEntry,
} from '../../../../../stores/team/team-events.js';

vi.mock('../../../conversation/TeamConversationView.js', () => ({
  TeamConversationView: ({ sessionId }: { sessionId: string }) => (
    <div data-session-id={sessionId} data-testid="team-session-view-mock" />
  ),
}));

const artifactState = vi.hoisted(() => ({
  planArtifact: { content: '规划产物内容', title: 'plan-artifact' } as {
    content: string;
    title: string;
  } | null,
  reviewArtifact: null as { content: string; title: string } | null,
}));

vi.mock('../tasks/use-team-artifact-data.js', () => ({
  useTeamArtifactData: () => ({
    artifactError: null,
    artifactLoading: false,
    planArtifact: artifactState.planArtifact,
    refreshArtifacts: () => undefined,
    reviewArtifact: artifactState.reviewArtifact,
    specArtifact: null,
    tasksArtifact: null,
  }),
}));

vi.mock('../../hooks/use-session-handoffs.js', () => ({
  useSessionHandoffs: (sessionId: string | null) => ({
    applyPreview: () => undefined,
    error: null,
    handoffs:
      sessionId === 'pm1-session'
        ? [
            {
              claimedAt: null,
              claimToken: null,
              completedAt: '2026-06-06T10:20:00.000Z',
              createdAt: '2026-06-06T10:19:00.000Z',
              failureReason: null,
              fromRoleLayer: 'reception',
              fromSessionId: 'root-session',
              id: 'handoff-pm1',
              idempotencyKey: null,
              pauseReason: null,
              paused: false,
              pausedAt: null,
              pausedByUserId: null,
              payload: {
                sourceIntent: '帮我启动项目',
                rewrittenIntent: '把启动项目的需求下发给 PM1 做规划',
                recommendedNextStep: '整理里程碑并生成计划',
                recommendedRole: 'planner',
              },
              resultJson: null,
              retryCount: 0,
              startedAt: '2026-06-06T10:19:10.000Z',
              state: 'completed',
              toRoleLayer: 'pm1',
              toSessionId: 'pm1-session',
              updatedAt: '2026-06-06T10:20:00.000Z',
              userId: 'user-1',
            },
          ]
        : [],
    loading: false,
    refresh: () => undefined,
  }),
}));

const referenceState = vi.hoisted(() => ({
  sessions: [] as TeamRuntimeSessionRecord[],
}));

vi.mock('../../data/team-runtime-reference-data.js', () => ({
  useTeamRuntimeReferenceViewData: () => ({
    sessions: referenceState.sessions,
  }),
}));

import { CrossLayerConversationView } from './CrossLayerConversationView.js';

function runtimeSession(
  id: string,
  parentSessionId: string | null,
  roleLayer: TeamRuntimeSessionRecord['roleLayer'],
  title: string,
): TeamRuntimeSessionRecord {
  return {
    id,
    metadataJson: '{}',
    parentSessionId,
    roleLayer,
    stateStatus: 'completed',
    title,
    updatedAt: '2026-06-06T10:00:00.000Z',
    workspacePath: '/work',
  };
}

function seedHandoff(entry: HandoffEntry) {
  useHandoffStore.setState({ handoffs: new Map([[entry.id, entry]]) });
}

beforeEach(() => {
  useHandoffStore.getState().clear();
  useLayerStore.getState().clear();
  artifactState.planArtifact = { content: '规划产物内容', title: 'plan-artifact' };
  artifactState.reviewArtifact = null;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  referenceState.sessions = [
    runtimeSession('root-session', null, 'reception', '主会话'),
    runtimeSession('pm1-session', 'root-session', 'pm1', 'PM1 层会话'),
  ];
});

afterEach(() => {
  cleanup();
  useHandoffStore.getState().clear();
  useLayerStore.getState().clear();
  vi.restoreAllMocks();
});

describe('CrossLayerConversationView', () => {
  it('focusSessionId 会自动展开对应层级会话', () => {
    render(
      <CrossLayerConversationView
        focusSessionId="pm1-session"
        selectedTeam={{
          id: 'root-session',
          status: 'completed',
          subtitle: '已完成',
          title: '主会话',
        }}
      />,
    );

    return waitFor(() => {
      expect(screen.getByTestId('team-session-view-mock').getAttribute('data-session-id')).toBe(
        'pm1-session',
      );
      expect(screen.getByText('规划链摘要')).toBeTruthy();
      expect(screen.getByText('规划产物内容')).toBeTruthy();
    });
  });

  it('focusHandoffId 会按 handoff 目标会话自动展开', () => {
    seedHandoff({
      id: 'handoff-pm1',
      state: 'running',
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
      fromSessionId: 'root-session',
      sessionId: 'root-session',
      toSessionId: 'pm1-session',
      summary: '接待派发到 PM1',
      updatedAt: Date.now(),
    });

    render(
      <CrossLayerConversationView
        focusHandoffId="handoff-pm1"
        selectedTeam={{
          id: 'root-session',
          status: 'running',
          subtitle: '运行中',
          title: '主会话',
        }}
      />,
    );

    return waitFor(() => {
      expect(screen.getByTestId('team-session-view-mock').getAttribute('data-session-id')).toBe(
        'pm1-session',
      );
      expect(screen.getByText('规划链摘要')).toBeTruthy();
      expect(screen.getByText('规划产物内容')).toBeTruthy();
    });
  });

  it('PM2 层会优先展示 review 产物', () => {
    referenceState.sessions = [
      runtimeSession('root-session', null, 'reception', '主会话'),
      runtimeSession('pm2-session', 'root-session', 'pm2', 'PM2 层会话'),
    ];
    artifactState.planArtifact = { content: '规划产物内容', title: 'plan-artifact' };
    artifactState.reviewArtifact = { content: '评审报告内容', title: 'review-artifact' };

    render(
      <CrossLayerConversationView
        focusSessionId="pm2-session"
        selectedTeam={{
          id: 'root-session',
          status: 'completed',
          subtitle: '已完成',
          title: '主会话',
        }}
      />,
    );

    return waitFor(() => {
      expect(screen.getByText('评审报告内容')).toBeTruthy();
      expect(screen.getByText('评审链摘要')).toBeTruthy();
      expect(screen.getAllByText('review').length).toBeGreaterThan(0);
      expect(screen.getByText('跨层线程视角')).toBeTruthy();
    });
  });

  it('同一 session 被多轮 handoff 复用时，列表与详情会显示当前轮次', () => {
    referenceState.sessions = [
      runtimeSession('root-session', null, 'reception', '主会话'),
      runtimeSession('pm1-session', 'root-session', 'pm1', 'PM1 层会话'),
    ];
    useHandoffStore.setState({
      handoffs: new Map([
        [
          'handoff-pm1-round-1',
          {
            id: 'handoff-pm1-round-1',
            state: 'completed',
            fromRoleLayer: 'reception',
            toRoleLayer: 'pm1',
            fromSessionId: 'root-session',
            sessionId: 'pm1-session',
            toSessionId: 'pm1-session',
            summary: '第一轮规划',
            updatedAt: Date.parse('2026-06-06T10:10:00.000Z'),
          },
        ],
        [
          'handoff-pm1-round-2',
          {
            id: 'handoff-pm1-round-2',
            state: 'completed',
            fromRoleLayer: 'reception',
            toRoleLayer: 'pm1',
            fromSessionId: 'root-session',
            sessionId: 'pm1-session',
            toSessionId: 'pm1-session',
            summary: '第二轮规划',
            updatedAt: Date.parse('2026-06-06T10:20:00.000Z'),
          },
        ],
      ]),
    });

    render(
      <CrossLayerConversationView
        focusSessionId="pm1-session"
        selectedTeam={{
          id: 'root-session',
          status: 'completed',
          subtitle: '已完成',
          title: '主会话',
        }}
      />,
    );

    return waitFor(() => {
      expect(screen.getAllByText('第 2 轮复用').length).toBeGreaterThan(0);
      expect(screen.getByText('当前轮次 · 第 2 轮（复用会话）')).toBeTruthy();
      expect(screen.getByText('来源上下文')).toBeTruthy();
      expect(screen.getAllByText('主会话').length).toBeGreaterThan(0);
      expect(screen.getByText('当前会话')).toBeTruthy();
      expect(screen.getAllByText('PM1 层会话').length).toBeGreaterThan(0);
    });
  });

  it('窄宽度下跨层线程改为上下堆叠布局', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 860 });
    window.dispatchEvent(new Event('resize'));

    render(
      <CrossLayerConversationView
        focusSessionId="pm1-session"
        selectedTeam={{
          id: 'root-session',
          status: 'completed',
          subtitle: '已完成',
          title: '主会话',
        }}
      />,
    );

    return waitFor(() => {
      expect(screen.getByText('线程节点')).toBeTruthy();
      expect(screen.getByText('规划链摘要')).toBeTruthy();
    });
  });
});
