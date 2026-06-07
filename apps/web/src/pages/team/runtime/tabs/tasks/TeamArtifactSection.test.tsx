import type {
  SessionFileChangesSummary,
  SharedSessionDetailRecord,
  SharedSessionSummaryRecord,
} from '@openAwork/web-client';
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const storeState = vi.hoisted(() => ({
  clarificationItems: [] as Array<{
    id: string;
    status: 'pending' | 'answered' | 'dismissed';
    sessionId: string;
    question: string;
  }>,
  nodes: new Map<
    string,
    {
      parentSessionId: string | null;
      roleLayer: 'reception' | 'pm1' | 'pm2' | 'executor';
      sessionId: string;
      state: 'idle' | 'running' | 'completed' | 'failed' | 'pending' | 'claimed' | 'cancelled';
    }
  >(),
}));

const sessionHandoffState = vi.hoisted(() => ({
  bySessionId: new Map<
    string,
    Array<{
      id: string;
      userId: string;
      fromSessionId: string;
      fromRoleLayer: 'reception' | 'pm1' | 'pm2';
      toRoleLayer: 'pm1' | 'pm2' | 'executor';
      toSessionId: string | null;
      payload: Record<string, unknown>;
      state: 'completed' | 'running';
      claimToken: string | null;
      claimedAt: string | null;
      startedAt: string | null;
      completedAt: string | null;
      failureReason: string | null;
      retryCount: number;
      createdAt: string;
      updatedAt: string;
    }>
  >(),
}));
const useSessionHandoffsCalls = vi.hoisted(() => [] as Array<string | null>);

const reviewDispositionArgs = vi.hoisted(() => ({
  calls: [] as Array<{ focusHandoffId: string | null | undefined; sessionId: string | null }>,
}));
const mockRuntimeReferenceData = vi.hoisted(() => ({
  activeSharedSession: null as SharedSessionDetailRecord | null,
  runRuntimeAlertRemediation: vi.fn(async () => true),
  sharedSessionLoading: false,
  sharedSessions: [] as SharedSessionSummaryRecord[],
}));

vi.mock('../../../../../stores/team/team-events.js', () => ({
  useClarificationStore: (
    selector: (state: { items: typeof storeState.clarificationItems }) => unknown,
  ) =>
    selector({
      items: storeState.clarificationItems,
    }),
  useLayerStore: (selector: (state: { nodes: typeof storeState.nodes }) => unknown) =>
    selector({
      nodes: storeState.nodes,
    }),
}));

vi.mock('../../data/team-runtime-reference-data.js', () => ({
  useTeamRuntimeReferenceViewData: () => mockRuntimeReferenceData,
}));

vi.mock('../../hooks/use-session-handoffs.js', () => ({
  useSessionHandoffs: (sessionId: string | null) => ({
    ...(useSessionHandoffsCalls.push(sessionId), {}),
    applyPreview: vi.fn(),
    error: null,
    handoffs: sessionId ? (sessionHandoffState.bySessionId.get(sessionId) ?? []) : [],
    loading: false,
    refresh: vi.fn(),
  }),
}));

vi.mock('../../hooks/use-review-disposition.js', () => ({
  useReviewDisposition: (sessionId: string | null, focusHandoffId?: string | null) => {
    reviewDispositionArgs.calls.push({ focusHandoffId, sessionId });
    return {
      action: null,
      escalationRound: 0,
      pm2HandoffId: null,
      pm2HandoffState: null,
      reason: null,
      loading: false,
      error: null,
    };
  },
}));

vi.mock('./use-team-artifact-data.js', () => ({
  useTeamArtifactData: () => ({
    artifactError: null,
    artifactLoading: false,
    planArtifact: {
      id: 'plan-1',
      title: 'plan',
      phase: 'plan',
      content:
        '| 宪法条目 | 状态 | 说明 |\n| --- | --- | --- |\n| 文件边界 | ⚠️ | 计划文件偏大 |\n| 测试覆盖 | ✅ | 已覆盖 |\n| 权限控制 | ❌ | 缺少权限校验 |',
    },
    refreshArtifacts: vi.fn(),
    reviewArtifact: null,
    specArtifact: null,
    tasksArtifact: null,
  }),
}));

vi.mock('./ClarificationsPanel.js', () => ({
  ClarificationsPanel: ({ filterSessionId }: { filterSessionId?: string | null }) => (
    <div data-testid="clarifications-filter">{filterSessionId ?? 'null'}</div>
  ),
}));

vi.mock('./ArtifactChainWizard.js', () => ({
  ArtifactChainWizard: ({
    constitutionWarnings,
  }: {
    constitutionWarnings: Array<{ clause: string; note: string; status: string }>;
  }) => (
    <div
      data-testid="artifact-chain-wizard"
      data-constitution-warning-count={String(constitutionWarnings.length)}
      data-constitution-warning-statuses={constitutionWarnings.map((item) => item.status).join(',')}
    />
  ),
}));

vi.mock('./DispatchPackageView.js', () => ({
  DispatchPackageView: () => <div data-testid="dispatch-package-view" />,
}));

vi.mock('./ReviewReportView.js', () => ({
  ReviewReportView: () => <div data-testid="review-report-view" />,
}));

vi.mock('./SessionTreeView.js', () => ({
  SessionTreeView: () => <div data-testid="session-tree-view" />,
}));

vi.mock('./RunningHandoffCancelList.js', () => ({
  RunningHandoffCancelList: () => <div data-testid="running-handoff-cancel-list" />,
}));

vi.mock('../../shell/controls/FailureFlowIndicator.js', () => ({
  FailureFlowIndicator: () => <div data-testid="failure-flow-indicator" />,
}));

import { TeamArtifactSection } from './TeamArtifactSection.js';

function createHandoffRecord() {
  return {
    id: 'handoff-pm2',
    userId: 'user-1',
    fromSessionId: 'session-pm1',
    fromRoleLayer: 'pm1' as const,
    toRoleLayer: 'pm2' as const,
    toSessionId: 'session-pm2',
    payload: {},
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
    state: 'running' as const,
    claimToken: null,
    claimedAt: null,
    startedAt: null,
    completedAt: null,
    failureReason: null,
    retryCount: 0,
    createdAt: '2026-06-03T08:00:00.000Z',
    updatedAt: '2026-06-03T08:10:00.000Z',
  };
}

function createReviewerDispatchHandoff() {
  return {
    id: 'handoff-reviewer',
    userId: 'user-1',
    fromSessionId: 'session-pm2',
    fromRoleLayer: 'pm2' as const,
    toRoleLayer: 'executor' as const,
    toSessionId: 'session-reviewer',
    payload: {},
    state: 'running' as const,
    claimToken: null,
    claimedAt: null,
    startedAt: null,
    completedAt: null,
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
    state: 'completed' as const,
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

function createSharedSummary(
  overrides: Partial<SharedSessionSummaryRecord> = {},
): SharedSessionSummaryRecord {
  return {
    createdAt: '2026-06-05T08:00:00.000Z',
    permission: 'operate',
    sessionId: 'shared-1',
    shareCreatedAt: '2026-06-05T08:00:00.000Z',
    shareUpdatedAt: '2026-06-05T08:12:00.000Z',
    sharedByEmail: 'owner@example.com',
    stateStatus: 'running',
    title: '共享会话 A',
    updatedAt: '2026-06-05T08:12:00.000Z',
    workspacePath: '/workspace/shared',
    ...overrides,
  };
}

function createFileChangesSummary(
  overrides: Partial<SessionFileChangesSummary> = {},
): SessionFileChangesSummary {
  return {
    latestSnapshotAt: '2026-06-05T09:20:00.000Z',
    latestSnapshotRef: 'snapshot-1',
    latestSnapshotScopeKind: 'scope',
    snapshotCount: 3,
    sourceKinds: ['session_snapshot', 'structured_tool_diff'],
    totalAdditions: 12,
    totalDeletions: 3,
    totalFileDiffs: 4,
    ...overrides,
  };
}

function createSharedDetail(
  overrides: Partial<SharedSessionDetailRecord> = {},
): SharedSessionDetailRecord {
  return {
    comments: [
      {
        authorEmail: 'peer@example.com',
        content: '请补充说明',
        createdAt: '2026-06-05T08:30:00.000Z',
        id: 'comment-1',
        sessionId: 'shared-1',
      },
    ],
    pendingPermissions: [
      {
        createdAt: '2026-06-05T08:10:00.000Z',
        previewAction: '写入 apps/web/src/pages/team/runtime/tabs/tasks/TeamArtifactSection.tsx',
        reason: '需要更新共享产物页',
        requestId: 'permission-1',
        riskLevel: 'medium',
        scope: 'write apps/web/src/pages/team/runtime/tabs/tasks/TeamArtifactSection.tsx',
        sessionId: 'shared-1',
        status: 'pending',
        toolName: 'write_file',
      },
    ],
    pendingQuestions: [
      {
        createdAt: '2026-06-05T08:11:00.000Z',
        questions: [
          {
            header: '目标',
            options: [],
            question: '共享产物页是否要展示文件变更快照？',
          },
        ],
        requestId: 'question-1',
        sessionId: 'shared-1',
        status: 'pending',
        title: '确认共享产物展示范围',
        toolName: 'request_user_input',
      },
    ],
    presence: [
      {
        active: true,
        firstSeenAt: '2026-06-05T08:00:00.000Z',
        lastSeenAt: '2026-06-05T08:12:00.000Z',
        viewerEmail: 'viewer@example.com',
        viewerUserId: 'viewer-1',
      },
    ],
    share: createSharedSummary(),
    session: {
      createdAt: Date.parse('2026-06-05T08:00:00.000Z'),
      fileChangesSummary: createFileChangesSummary(),
      id: 'shared-1',
      messages: [
        {
          content: [{ text: '共享运行已经产出第一版任务与产物摘要。', type: 'text' }],
          createdAt: Date.parse('2026-06-05T08:20:00.000Z'),
          id: 'message-1',
          role: 'assistant',
        },
      ],
    },
    ...overrides,
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  useSessionHandoffsCalls.length = 0;
  reviewDispositionArgs.calls = [];
  mockRuntimeReferenceData.activeSharedSession = null;
  mockRuntimeReferenceData.runRuntimeAlertRemediation.mockReset().mockResolvedValue(true);
  mockRuntimeReferenceData.sharedSessionLoading = false;
  mockRuntimeReferenceData.sharedSessions = [];
  storeState.clarificationItems = [
    {
      id: 'clarification-1',
      question: '需要确认导出格式',
      sessionId: 'session-pm1',
      status: 'pending',
    },
  ];
  storeState.nodes = new Map([
    [
      'session-reception',
      {
        parentSessionId: null,
        roleLayer: 'reception',
        sessionId: 'session-reception',
        state: 'running',
      },
    ],
    [
      'session-pm2',
      {
        parentSessionId: 'session-pm1',
        roleLayer: 'pm2',
        sessionId: 'session-pm2',
        state: 'running',
      },
    ],
    [
      'session-reviewer',
      {
        parentSessionId: 'session-pm2',
        roleLayer: 'executor',
        sessionId: 'session-reviewer',
        state: 'running',
      },
    ],
  ]);
  sessionHandoffState.bySessionId = new Map([
    ['session-pm2', [createHandoffRecord(), createReviewerDispatchHandoff()]],
    ['session-reviewer', [createReviewerDispatchHandoff()]],
  ]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TeamArtifactSection', () => {
  it('当前选中 PM2 会话时，待澄清面板会跟随对应的 PM1 artifact session', () => {
    render(<TeamArtifactSection selectedTeamId="session-pm2" />);

    expect(screen.getByTestId('clarifications-filter').textContent).toBe('session-pm1');
  });

  it('当前选中 reception 会话且只推进到 PM1 时，待澄清面板也会回溯到 PM1 session', () => {
    sessionHandoffState.bySessionId = new Map([
      ['session-reception', [createReceptionToPm1Handoff()]],
    ]);

    render(<TeamArtifactSection selectedTeamId="session-reception" />);

    expect(screen.getByTestId('clarifications-filter').textContent).toBe('session-pm1');
  });

  it('当前选中 reception 会话时，会继续补拉 PM1 与 PM2 两跳 handoff 上下文', () => {
    sessionHandoffState.bySessionId = new Map([
      ['session-reception', [createReceptionToPm1Handoff()]],
      ['session-pm1', [createHandoffRecord()]],
      ['session-pm2', [createHandoffRecord(), createReviewerDispatchHandoff()]],
    ]);

    render(<TeamArtifactSection selectedTeamId="session-reception" />);

    expect(useSessionHandoffsCalls).toContain('session-pm1');
    expect(useSessionHandoffsCalls).toContain('session-pm2');
  });

  it('无法回溯到 PM1 时，待澄清面板回退到当前选中会话', () => {
    sessionHandoffState.bySessionId = new Map([['session-pm2', []]]);

    render(<TeamArtifactSection selectedTeamId="session-pm2" />);

    expect(screen.getByTestId('clarifications-filter').textContent).toBe('session-pm2');
  });

  it('当前选中下游子会话时，失败分流会回溯到 PM2 会话上下文', () => {
    render(<TeamArtifactSection selectedTeamId="session-reviewer" />);

    expect(reviewDispositionArgs.calls.at(-1)?.sessionId).toBe('session-pm2');
  });

  it('会把计划中的宪法检查结果传给 PM1 规划向导', () => {
    render(<TeamArtifactSection selectedTeamId="session-pm2" />);

    const wizard = screen.getByTestId('artifact-chain-wizard');
    expect(wizard.getAttribute('data-constitution-warning-count')).toBe('2');
    expect(wizard.getAttribute('data-constitution-warning-statuses')).toBe('warning,conflict');
  });

  it('聚焦到可恢复失败 handoff 时会展示行级重试按钮，并按 handoffId 触发 remediation', async () => {
    sessionHandoffState.bySessionId = new Map([
      ['session-reviewer', [createReviewerDispatchHandoff()]],
      ['session-pm2', [createRecoverableFailedPm2Handoff(), createReviewerDispatchHandoff()]],
    ]);

    render(
      <TeamArtifactSection focusHandoffId="handoff-pm2-failed" selectedTeamId="session-reviewer" />,
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

  it('选中共享会话时，会直接展示共享输出、待处理协作项和变更快照', () => {
    mockRuntimeReferenceData.sharedSessions = [createSharedSummary()];
    mockRuntimeReferenceData.activeSharedSession = createSharedDetail();

    render(<TeamArtifactSection selectedTeamId="shared-1" />);

    expect(screen.getByTestId('shared-artifact-view')).toBeTruthy();
    expect(screen.getByText('共享会话 A')).toBeTruthy();
    expect(screen.getByTestId('shared-artifact-output').textContent).toContain(
      '共享运行已经产出第一版任务与产物摘要。',
    );
    expect(screen.getByText('待审批权限 1')).toBeTruthy();
    expect(screen.getByText('待回答问题 1')).toBeTruthy();
    expect(screen.getByText('变更文件')).toBeTruthy();
    expect(screen.queryByTestId('clarifications-filter')).toBeNull();
  });
});
