// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const state = vi.hoisted(() => ({
  error: null as string | null,
  bySessionId: new Map<
    string,
    Array<{
      id: string;
      userId: string;
      fromSessionId: string;
      fromRoleLayer: 'reception' | 'pm1' | 'pm2';
      toRoleLayer: 'pm1' | 'pm2' | 'reviewer';
      toSessionId: string | null;
      payload: Record<string, unknown>;
      state: 'completed' | 'failed';
      claimToken: string | null;
      claimedAt: string | null;
      startedAt: string | null;
      completedAt: string | null;
      failureReason: string | null;
      recoverableFailure?: boolean;
      retryCount: number;
      createdAt: string;
      updatedAt: string;
    }>
  >(),
  loading: false,
  nodes: new Map<
    string,
    {
      parentSessionId: string | null;
      roleLayer: 'reception' | 'pm1' | 'pm2' | 'reviewer';
      sessionId: string;
      state: 'idle' | 'running' | 'completed' | 'failed' | 'pending' | 'claimed' | 'cancelled';
    }
  >(),
}));
const useSessionHandoffsCalls = vi.hoisted(() => [] as Array<string | null>);

const applyPreviewMock = vi.fn();
const refreshMock = vi.fn();
const mockRuntimeReferenceData = vi.hoisted(() => ({
  runRuntimeAlertRemediation: vi.fn(async () => true),
}));

vi.mock('../../hooks/use-session-handoffs.js', () => ({
  useSessionHandoffs: (sessionId: string | null) => ({
    ...(useSessionHandoffsCalls.push(sessionId), {}),
    applyPreview: applyPreviewMock,
    error: state.error,
    handoffs: sessionId ? (state.bySessionId.get(sessionId) ?? []) : [],
    loading: state.loading,
    refresh: refreshMock,
  }),
}));

vi.mock('../../../../../stores/team/team-events.js', () => ({
  useLayerStore: (selector: (store: { nodes: typeof state.nodes }) => unknown) =>
    selector({
      nodes: state.nodes,
    }),
}));

vi.mock('../../data/team-runtime-reference-data.js', () => ({
  useTeamRuntimeReferenceViewData: () => mockRuntimeReferenceData,
}));

vi.mock('../../hooks/use-review-disposition.js', () => ({
  useReviewDisposition: () => ({
    action: null,
    escalationRound: 0,
    error: null,
    loading: false,
    pm2HandoffId: null,
    pm2HandoffState: null,
    reason: null,
  }),
}));

vi.mock('./use-team-artifact-data.js', () => ({
  useTeamArtifactData: () => ({
    artifactError: null,
    artifactLoading: false,
    planArtifact: null,
    refreshArtifacts: vi.fn(),
    reviewArtifact: {
      id: 'review-artifact-1',
      title: 'Review Report',
      phase: 'review',
      content: '# 真实评审产物',
    },
    specArtifact: null,
    tasksArtifact: null,
  }),
}));

vi.mock('./ReviewReportView.js', () => ({
  ReviewReportView: ({
    overallVerdict,
    qualityReviewPassed,
    reportMarkdown,
    specReviewPassed,
  }: {
    overallVerdict: string | null;
    qualityReviewPassed: boolean | null;
    reportMarkdown: string | null;
    specReviewPassed: boolean | null;
  }) => (
    <div>
      <div data-testid="review-report-markdown">{reportMarkdown ?? 'empty'}</div>
      <div data-testid="review-report-verdict">{overallVerdict ?? 'null'}</div>
      <div data-testid="review-report-spec">{String(specReviewPassed)}</div>
      <div data-testid="review-report-quality">{String(qualityReviewPassed)}</div>
    </div>
  ),
}));

vi.mock('./ReviewTab.js', () => ({
  ReviewTab: () => <div data-testid="review-queue-view">queue</div>,
}));

vi.mock('../../shell/controls/FailureFlowIndicator.js', () => ({
  FailureFlowIndicator: () => <div data-testid="failure-flow-indicator" />,
}));

import { ReviewMergedTab } from './ReviewMergedTab.js';

function createPm2Handoff() {
  return {
    id: 'handoff-pm2',
    userId: 'user-1',
    fromSessionId: 'session-pm1',
    fromRoleLayer: 'pm1' as const,
    toRoleLayer: 'pm2' as const,
    toSessionId: 'session-pm2',
    payload: {
      review_report: {
        markdown: '# 评审通过',
        overallVerdict: 'pass',
        specReviewPassed: true,
        qualityReviewPassed: true,
      },
    },
    state: 'completed' as const,
    claimToken: null,
    claimedAt: null,
    startedAt: null,
    completedAt: '2026-06-03T10:00:00.000Z',
    failureReason: null,
    retryCount: 0,
    createdAt: '2026-06-03T09:00:00.000Z',
    updatedAt: '2026-06-03T10:00:00.000Z',
  };
}

function createReceptionToPm1Handoff() {
  return {
    id: 'handoff-pm1',
    userId: 'user-1',
    fromSessionId: 'session-reception',
    fromRoleLayer: 'reception' as const,
    toRoleLayer: 'pm1' as const,
    toSessionId: 'session-pm1',
    payload: {},
    state: 'completed' as const,
    claimToken: null,
    claimedAt: null,
    startedAt: null,
    completedAt: '2026-06-03T09:20:00.000Z',
    failureReason: null,
    retryCount: 0,
    createdAt: '2026-06-03T09:00:00.000Z',
    updatedAt: '2026-06-03T09:20:00.000Z',
  };
}

function createPm2HandoffWithResultOnly() {
  return {
    id: 'handoff-pm2-result',
    userId: 'user-1',
    fromSessionId: 'session-pm1',
    fromRoleLayer: 'pm1' as const,
    toRoleLayer: 'pm2' as const,
    toSessionId: 'session-pm2',
    payload: {},
    resultJson: {
      reviewReportArtifactId: 'review-artifact-1',
      overallVerdict: 'implementation-failure',
      specReviewPassed: false,
      qualityReviewPassed: true,
    },
    state: 'completed' as const,
    claimToken: null,
    claimedAt: null,
    startedAt: null,
    completedAt: '2026-06-03T10:00:00.000Z',
    failureReason: null,
    retryCount: 0,
    createdAt: '2026-06-03T09:00:00.000Z',
    updatedAt: '2026-06-03T10:00:00.000Z',
  };
}

function createReviewerDispatchHandoff() {
  return {
    id: 'handoff-reviewer',
    userId: 'user-1',
    fromSessionId: 'session-pm2',
    fromRoleLayer: 'pm2' as const,
    toRoleLayer: 'reviewer' as const,
    toSessionId: 'session-reviewer',
    payload: {},
    state: 'completed' as const,
    claimToken: null,
    claimedAt: null,
    startedAt: null,
    completedAt: '2026-06-03T10:10:00.000Z',
    failureReason: null,
    retryCount: 0,
    createdAt: '2026-06-03T10:05:00.000Z',
    updatedAt: '2026-06-03T10:10:00.000Z',
  };
}

function createRecoverableFailedPm2Handoff() {
  return {
    id: 'handoff-pm2-failed',
    userId: 'user-1',
    fromSessionId: 'session-pm1',
    fromRoleLayer: 'pm1' as const,
    toRoleLayer: 'pm2' as const,
    toSessionId: 'session-pm2',
    payload: {},
    state: 'failed' as const,
    claimToken: null,
    claimedAt: null,
    startedAt: null,
    completedAt: '2026-06-03T10:00:00.000Z',
    failureReason: 'runner-fail',
    retryCount: 1,
    recoverableFailure: true,
    createdAt: '2026-06-03T09:00:00.000Z',
    updatedAt: '2026-06-03T10:00:00.000Z',
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  useSessionHandoffsCalls.length = 0;
  mockRuntimeReferenceData.runRuntimeAlertRemediation.mockReset().mockResolvedValue(true);
  state.error = null;
  state.loading = false;
  state.nodes = new Map([
    [
      'session-reception',
      {
        parentSessionId: null,
        roleLayer: 'reception',
        sessionId: 'session-reception',
        state: 'completed',
      },
    ],
    [
      'session-pm1',
      {
        parentSessionId: 'session-reception',
        roleLayer: 'pm1',
        sessionId: 'session-pm1',
        state: 'completed',
      },
    ],
    [
      'session-reviewer',
      {
        parentSessionId: 'session-pm2',
        roleLayer: 'reviewer',
        sessionId: 'session-reviewer',
        state: 'completed',
      },
    ],
  ]);
  state.bySessionId = new Map([
    ['session-reception', [createReceptionToPm1Handoff()]],
    ['session-reviewer', [createReviewerDispatchHandoff()]],
    ['session-pm2', [createPm2Handoff(), createReviewerDispatchHandoff()]],
  ]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ReviewMergedTab', () => {
  it('当前选中 reviewer 下游会话时，也会回溯到 PM2 handoff 读取评审报告', () => {
    render(<ReviewMergedTab selectedTeam={null} selectedTeamId="session-reviewer" />);

    expect(screen.getByTestId('review-report-markdown').textContent).toBe('# 评审通过');
    expect(screen.getByTestId('review-report-verdict').textContent).toBe('pass');
    expect(screen.getByTestId('review-report-spec').textContent).toBe('true');
    expect(screen.getByTestId('review-report-quality').textContent).toBe('true');
  });

  it('当前选中 reception 会话时，也会沿 reception→pm1→pm2 多跳回溯到 PM2 评审报告', () => {
    state.bySessionId = new Map([
      ['session-reception', [createReceptionToPm1Handoff(), createPm2Handoff()]],
      ['session-pm2', [createPm2Handoff(), createReviewerDispatchHandoff()]],
    ]);

    render(<ReviewMergedTab selectedTeam={null} selectedTeamId="session-reception" />);

    expect(screen.getByTestId('review-report-markdown').textContent).toBe('# 评审通过');
    expect(screen.getByTestId('review-report-verdict').textContent).toBe('pass');
  });

  it('当前选中 reception 会话时，会继续补拉 PM1 与 PM2 两跳 handoff 上下文', () => {
    state.bySessionId = new Map([
      ['session-reception', [createReceptionToPm1Handoff()]],
      ['session-pm1', [createPm2Handoff()]],
      ['session-pm2', [createPm2Handoff(), createReviewerDispatchHandoff()]],
    ]);

    render(<ReviewMergedTab selectedTeam={null} selectedTeamId="session-reception" />);

    expect(useSessionHandoffsCalls).toContain('session-pm1');
    expect(useSessionHandoffsCalls).toContain('session-pm2');
  });

  it('切换到评审待办时会显示队列视图', () => {
    render(<ReviewMergedTab selectedTeam={null} selectedTeamId="session-reviewer" />);

    fireEvent.click(screen.getByRole('tab', { name: /评审待办/i }));

    expect(screen.getByTestId('review-queue-view').textContent).toBe('queue');
  });

  it('当 handoff 只有 resultJson 判定字段时，会回退显示真实 review artifact 正文', () => {
    state.bySessionId = new Map([
      ['session-reviewer', [createReviewerDispatchHandoff()]],
      ['session-pm2', [createPm2HandoffWithResultOnly(), createReviewerDispatchHandoff()]],
    ]);

    render(<ReviewMergedTab selectedTeam={null} selectedTeamId="session-reviewer" />);

    expect(screen.getByTestId('review-report-markdown').textContent).toBe('# 真实评审产物');
    expect(screen.getByTestId('review-report-verdict').textContent).toBe('implementation-failure');
    expect(screen.getByTestId('review-report-spec').textContent).toBe('false');
    expect(screen.getByTestId('review-report-quality').textContent).toBe('true');
  });

  it('聚焦到可恢复失败 handoff 时会展示行级重试按钮，并按 handoffId 触发 remediation', async () => {
    state.bySessionId = new Map([
      ['session-reviewer', [createReviewerDispatchHandoff()]],
      ['session-pm2', [createRecoverableFailedPm2Handoff(), createReviewerDispatchHandoff()]],
    ]);

    render(
      <ReviewMergedTab
        focusHandoffId="handoff-pm2-failed"
        selectedTeam={null}
        selectedTeamId="session-reviewer"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '重试失败 handoff handoff-pm2-failed' }));

    await waitFor(() => {
      expect(mockRuntimeReferenceData.runRuntimeAlertRemediation).toHaveBeenCalledWith(
        'handoff-failure',
        {
          handoffId: 'handoff-pm2-failed',
          sessionId: 'session-pm2',
        },
      );
    });
  });
});
