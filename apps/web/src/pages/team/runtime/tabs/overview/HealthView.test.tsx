// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { TeamRuntimeDiagnostics } from '@openAwork/web-client';

const mockHandoffs = new Map();
const mockNodes = new Map();

function hasExactNormalizedText(expected: string) {
  const normalizedExpected = expected.replace(/\s+/g, '').trim();
  return (_content: string, element: Element | null) =>
    (element?.textContent ?? '').replace(/\s+/g, '').trim() === normalizedExpected;
}

function createDefaultLatencyStats(): TeamRuntimeDiagnostics['latency']['a_to_b_ack'] {
  return {
    avgMs: 0,
    count: 0,
    maxMs: 0,
    minMs: 0,
    p50Ms: 0,
    p95Ms: 0,
    p99Ms: 0,
    thresholdMs: 0,
    violationCount: 0,
  };
}

function createDefaultDiagnostics(): TeamRuntimeDiagnostics {
  return {
    activeAlerts: [],
    alerts: [],
    capturedAt: '2026-06-04T16:00:00.000Z',
    health: { status: 'healthy', reasons: [] },
    incidentSummary: {
      architecture_review: 0,
      handoff_failure: 0,
      latency_violation: 0,
      team_events_connection: 0,
      team_events_listener: 0,
    },
    incidents: [],
    latency: {
      a_to_b_ack: createDefaultLatencyStats(),
      a_to_b_direct: createDefaultLatencyStats(),
      progress_interval: createDefaultLatencyStats(),
      substate_push: createDefaultLatencyStats(),
    },
    pendingInteractions: {
      affectedSessionCount: 0,
      decidingPermissionCount: 0,
      decidingQuestionCount: 0,
      pendingPermissionCount: 0,
      pendingQuestionCount: 0,
      staleDecidingPermissionCount: 0,
      staleDecidingQuestionCount: 0,
      staleDecidingSessionCount: 0,
    },
    qualityReview: {
      pendingCount: 0,
      redispatchCount: 0,
      returnToCCount: 0,
      escalateToUserCount: 0,
      retryableErrorCount: 0,
      pendingHandoffs: [],
    },
    recentResolvedAlerts: [],
    runtimeThreads: {
      activeCount: 0,
      heartbeatIntervalMs: 30_000,
      staleAfterMs: 120_000,
      staleCount: 0,
      totalCount: 0,
    },
    teamEvents: {
      listenerCount: 0,
      listenerErrorCount: 0,
      publishedByType: {},
      publishedCount: 0,
    },
    telemetry: { enabled: false },
  };
}

const mockTeamEventsConnectionState = {
  state: 'connected',
  lastProtocolErrorCode: null,
  lastError: null,
  reconnectAttempt: 0,
  nextRetryAt: null,
  lastOpenAt: null,
  lastCloseCode: null,
};
const mockRuntimeReferenceData = {
  acknowledgeRuntimeAlert: vi.fn(async () => true),
  activeSharedSession: null as null | {
    comments: Array<{ id: string }>;
    pendingPermissions: Array<{ requestId: string }>;
    pendingQuestions: Array<{ requestId: string }>;
    presence: Array<{ active: boolean }>;
    share: {
      sessionId: string;
      title: string | null;
      shareUpdatedAt: string;
      stateStatus: string;
    };
  },
  auditLogs: [] as Array<{
    id: string;
    action: string;
    actorEmail: string | null;
    actorUserId: string | null;
    sessionId: string | null;
    summary: string;
    detail: string | null;
    createdAt: string;
  }>,
  clearRuntimeAlertControl: vi.fn(async () => true),
  diagnostics: createDefaultDiagnostics(),
  runRuntimeAlertRemediation: vi.fn(async () => true),
  selectedSharedSession: null as null | {
    comments: Array<{ id: string }>;
    pendingPermissions: Array<{ requestId: string }>;
    pendingQuestions: Array<{ requestId: string }>;
    presence: Array<{ active: boolean }>;
    share: {
      sessionId: string;
      title: string | null;
      shareUpdatedAt: string;
      stateStatus: string;
    };
  },
  sharedSessionLoading: false,
  sharedSessions: [] as Array<{
    sessionId: string;
    title: string | null;
    shareUpdatedAt: string;
    stateStatus: string;
  }>,
  suppressRuntimeAlert: vi.fn(async () => true),
};

vi.mock('../../../../../stores/team/team-events.js', () => ({
  useHandoffStore: (selector: (state: { handoffs: typeof mockHandoffs }) => unknown) =>
    selector({ handoffs: mockHandoffs }),
  useLayerStore: (selector: (state: { nodes: typeof mockNodes }) => unknown) =>
    selector({ nodes: mockNodes }),
  useTeamEventsConnectionStore: () => mockTeamEventsConnectionState,
}));

vi.mock('../../data/team-runtime-reference-data.js', () => ({
  useTeamRuntimeReferenceViewData: () => mockRuntimeReferenceData,
}));

import { HealthView } from './HealthView.js';

beforeEach(() => {
  cleanup();
  mockHandoffs.clear();
  mockNodes.clear();
  mockRuntimeReferenceData.activeSharedSession = null;
  mockRuntimeReferenceData.auditLogs = [];
  mockRuntimeReferenceData.diagnostics = createDefaultDiagnostics();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-06-04T16:00:00.000Z'));
  mockRuntimeReferenceData.selectedSharedSession = null;
  mockRuntimeReferenceData.sharedSessionLoading = false;
  mockRuntimeReferenceData.sharedSessions = [];
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('HealthView', () => {
  it('未选中会话时展示全局 handoff 健康视图', () => {
    mockHandoffs.set('failed-global', {
      id: 'failed-global',
      fromRoleLayer: 'pm1',
      toRoleLayer: 'pm2',
      fromSessionId: 'session-a',
      toSessionId: 'session-b',
      sessionId: 'session-b',
      state: 'failed',
      endedAt: Date.parse('2026-06-04T15:59:00.000Z'),
      updatedAt: Date.parse('2026-06-04T15:59:00.000Z'),
    });

    render(<HealthView />);

    expect(screen.getByText('失败 handoff')).toBeTruthy();
    expect(screen.queryByText('工具调用统计', { exact: false })).toBeNull();
    expect(screen.queryByText(/当前下钻范围：/)).toBeNull();
    expect(screen.getByText('failed-global')).toBeTruthy();
  });

  it('选中会话后只展示当前会话及子树的失败与卡住 handoff', () => {
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

    mockHandoffs.set('failed-in-scope', {
      id: 'failed-in-scope',
      fromRoleLayer: 'pm1',
      toRoleLayer: 'pm2',
      fromSessionId: 'session-root',
      toSessionId: 'session-child',
      sessionId: 'session-child',
      state: 'failed',
      endedAt: Date.parse('2026-06-04T15:58:00.000Z'),
      updatedAt: Date.parse('2026-06-04T15:58:00.000Z'),
    });
    mockHandoffs.set('failed-out-of-scope', {
      id: 'failed-out-of-scope',
      fromRoleLayer: 'reviewer',
      toRoleLayer: 'executor',
      fromSessionId: 'session-other',
      toSessionId: 'session-external',
      sessionId: 'session-external',
      state: 'failed',
      endedAt: Date.parse('2026-06-04T15:57:00.000Z'),
      updatedAt: Date.parse('2026-06-04T15:57:00.000Z'),
    });
    mockHandoffs.set('stuck-in-scope', {
      id: 'stuck-in-scope',
      fromRoleLayer: 'pm1',
      toRoleLayer: 'pm2',
      fromSessionId: 'session-root',
      toSessionId: 'session-child',
      sessionId: 'session-child',
      state: 'pending',
      startedAt: Date.parse('2026-06-04T15:50:00.000Z'),
      updatedAt: Date.parse('2026-06-04T15:50:00.000Z'),
    });
    mockHandoffs.set('stuck-out-of-scope', {
      id: 'stuck-out-of-scope',
      fromRoleLayer: 'reviewer',
      toRoleLayer: 'executor',
      fromSessionId: 'session-other',
      toSessionId: 'session-external',
      sessionId: 'session-external',
      state: 'pending',
      startedAt: Date.parse('2026-06-04T15:50:00.000Z'),
      updatedAt: Date.parse('2026-06-04T15:50:00.000Z'),
    });

    render(
      <HealthView
        selectedSessionId="session-root"
        selectedSessionTitle="根会话"
        onCancelHandoff={() => {}}
      />,
    );

    expect(screen.getByText(hasExactNormalizedText('当前下钻范围：根会话 及其子树'))).toBeTruthy();
    expect(screen.getByText('failed-in-scope')).toBeTruthy();
    expect(screen.queryByText('failed-out-of-scope')).toBeNull();
    expect(screen.getByText(/已等待/)).toBeTruthy();
    expect(screen.queryByText('stuck-out-of-scope')).toBeNull();
  });

  it('可恢复失败会展示行级重试按钮，并按 handoffId 定向触发 remediation', async () => {
    mockHandoffs.set('failed-retryable', {
      id: 'failed-retryable',
      fromRoleLayer: 'pm2',
      toRoleLayer: 'executor',
      fromSessionId: 'session-a',
      toSessionId: 'session-b',
      sessionId: 'session-b',
      state: 'failed',
      failureReason: 'runner-fail',
      recoverableFailure: true,
      retryCount: 1,
      endedAt: Date.parse('2026-06-04T15:59:00.000Z'),
      updatedAt: Date.parse('2026-06-04T15:59:00.000Z'),
    });

    render(<HealthView />);

    fireEvent.click(screen.getByRole('button', { name: '重试失败 handoff failed-retryable' }));

    expect(mockRuntimeReferenceData.runRuntimeAlertRemediation).toHaveBeenCalledWith(
      'handoff-failure',
      {
        handoffId: 'failed-retryable',
      },
    );
  });

  it('选中会话下钻时，告警治理动作会携带当前 sessionId', async () => {
    mockNodes.set('session-root', {
      sessionId: 'session-root',
      roleLayer: 'pm1',
      parentSessionId: null,
      state: 'running',
    });
    mockHandoffs.set('failed-retryable', {
      id: 'failed-retryable',
      fromRoleLayer: 'pm2',
      toRoleLayer: 'executor',
      fromSessionId: 'session-root',
      toSessionId: 'session-child',
      sessionId: 'session-child',
      state: 'failed',
      failureReason: 'runner-fail',
      recoverableFailure: true,
      retryCount: 1,
      endedAt: Date.parse('2026-06-04T15:59:00.000Z'),
      updatedAt: Date.parse('2026-06-04T15:59:00.000Z'),
    });

    render(<HealthView selectedSessionId="session-root" selectedSessionTitle="根会话" />);

    fireEvent.click(screen.getByRole('button', { name: '重试失败 handoff failed-retryable' }));

    expect(mockRuntimeReferenceData.runRuntimeAlertRemediation).toHaveBeenCalledWith(
      'handoff-failure',
      {
        handoffId: 'failed-retryable',
        sessionId: 'session-root',
      },
    );
  });

  it('不可恢复失败不显示行级重试按钮', () => {
    mockHandoffs.set('failed-non-retryable', {
      id: 'failed-non-retryable',
      fromRoleLayer: 'pm2',
      toRoleLayer: 'executor',
      fromSessionId: 'session-a',
      toSessionId: 'session-b',
      sessionId: 'session-b',
      state: 'failed',
      failureReason: 'Spec Review 未通过：遗漏验收场景',
      recoverableFailure: false,
      retryCount: 2,
      endedAt: Date.parse('2026-06-04T15:57:00.000Z'),
      updatedAt: Date.parse('2026-06-04T15:57:00.000Z'),
    });

    render(<HealthView />);

    expect(
      screen.queryByRole('button', { name: '重试失败 handoff failed-non-retryable' }),
    ).toBeNull();
  });

  it('失败 handoff 会直接展示后端失败原因', () => {
    mockHandoffs.set('failed-with-reason', {
      id: 'failed-with-reason',
      fromRoleLayer: 'pm2',
      toRoleLayer: 'executor',
      fromSessionId: 'session-a',
      toSessionId: 'session-b',
      sessionId: 'session-b',
      state: 'failed',
      failureReason:
        '[{"code":"invalid_type","path":["clientRequestId"],"message":"Required","apiKey":"sk-test-secret"}]',
      recoverableFailure: true,
      retryCount: 1,
      endedAt: Date.parse('2026-06-04T15:57:00.000Z'),
      updatedAt: Date.parse('2026-06-04T15:57:00.000Z'),
    });

    render(<HealthView />);

    const reasonText = screen.getByText(/失败原因：/).textContent ?? '';
    expect(screen.getByText('failed-with-reason')).toBeTruthy();
    expect(reasonText).toContain('clientRequestId');
    expect(reasonText).toContain('Required');
    expect(reasonText).toContain('[已隐藏]');
    expect(reasonText).not.toContain('sk-test-secret');
  });

  it('运行时事件会展示 code 与关键 context，便于定位阻塞来源', () => {
    mockRuntimeReferenceData.diagnostics = {
      ...createDefaultDiagnostics(),
      incidents: [
        {
          category: 'handoff_failure',
          code: 'handoff-runner-failed',
          context: {
            handoffId: 'handoff-blocked-1',
            toRoleLayer: 'executor',
            sessionId: 'session-executor',
            errorMessage: 'clientRequestId Required',
            apiKey: 'sk-context-secret',
          },
          message:
            'executor 层执行失败：clientRequestId Required Authorization: Bearer token-secret',
          severity: 'error',
          timestamp: Date.parse('2026-06-04T15:59:30.000Z'),
        },
      ],
    };

    render(<HealthView />);

    expect(screen.getByText('handoff-runner-failed')).toBeTruthy();
    expect(
      screen.getByText(
        'executor 层执行失败：clientRequestId Required Authorization: Bearer [已隐藏]',
      ),
    ).toBeTruthy();
    expect(screen.getByText('handoffId: handoff-blocked-1')).toBeTruthy();
    expect(screen.getByText('toRoleLayer: executor')).toBeTruthy();
    expect(screen.getByText('sessionId: session-executor')).toBeTruthy();
    expect(screen.getByText('errorMessage: clientRequestId Required')).toBeTruthy();
    expect(screen.getByText('apiKey: [已隐藏]')).toBeTruthy();
    expect(screen.queryByText(/token-secret/)).toBeNull();
    expect(screen.queryByText(/sk-context-secret/)).toBeNull();
  });

  it('选中共享会话时展示共享健康视图，而不是 runtime handoff 下钻', () => {
    mockRuntimeReferenceData.sharedSessions = [
      {
        sessionId: 'shared-1',
        title: '共享会话 A',
        shareUpdatedAt: '2026-06-04T15:58:00.000Z',
        stateStatus: 'running',
      },
    ];
    mockRuntimeReferenceData.activeSharedSession = {
      comments: [{ id: 'comment-1' }, { id: 'comment-2' }],
      pendingPermissions: [{ requestId: 'permission-1' }],
      pendingQuestions: [{ requestId: 'question-1' }],
      presence: [{ active: true }, { active: false }],
      share: {
        sessionId: 'shared-1',
        title: '共享会话 A',
        shareUpdatedAt: '2026-06-04T15:58:00.000Z',
        stateStatus: 'running',
      },
    };
    mockRuntimeReferenceData.auditLogs = [
      {
        id: 'audit-shared',
        action: 'shared_comment_created',
        actorEmail: 'owner@example.com',
        actorUserId: 'user-1',
        sessionId: 'shared-1',
        summary: '新增共享评论',
        detail: null,
        createdAt: '2026-06-04T15:59:00.000Z',
      },
    ];

    render(<HealthView selectedSessionId="shared-1" selectedSessionTitle="共享会话 A" />);

    expect(screen.getByTestId('shared-health-view')).toBeTruthy();
    expect(
      screen.getByText(
        '共享会话不参与本地团队 handoff 树。这里展示的是共享协作本身的健康状态，以及后端全局运行健康信号。',
      ),
    ).toBeTruthy();
    expect(screen.getByText('待审批')).toBeTruthy();
    expect(screen.getByText('协作评论')).toBeTruthy();
    expect(screen.getByText('新增共享评论')).toBeTruthy();
    expect(screen.queryByText('失败 handoff')).toBeNull();
  });
});
