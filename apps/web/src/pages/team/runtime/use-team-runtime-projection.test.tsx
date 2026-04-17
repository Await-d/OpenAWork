// @vitest-environment jsdom

import { act, useEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Session,
  SharedSessionDetailRecord,
  SharedSessionSummaryRecord,
  TeamRuntimeSessionRecord,
  TeamSessionShareRecord,
} from '@openAwork/web-client';
import { ALL_WORKSPACES_KEY } from './team-runtime-model.js';
import { useTeamRuntimeProjection } from './use-team-runtime-projection.js';

type ProjectionInput = Parameters<typeof useTeamRuntimeProjection>[0];
type ProjectionState = ReturnType<typeof useTeamRuntimeProjection>;

function makeSharedSessionSummary(
  sessionId: string,
  workspacePath: string | null,
  overrides: Partial<SharedSessionSummaryRecord> = {},
): SharedSessionSummaryRecord {
  return {
    sessionId,
    title: `共享会话 ${sessionId}`,
    stateStatus: 'running',
    workspacePath,
    sharedByEmail: 'owner@openawork.local',
    permission: 'operate',
    createdAt: '2026-04-04T00:00:00.000Z',
    updatedAt: '2026-04-04T00:00:00.000Z',
    shareCreatedAt: '2026-04-04T00:00:00.000Z',
    shareUpdatedAt: '2026-04-04T00:00:00.000Z',
    ...overrides,
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-a',
    title: '共享会话 session-a',
    state_status: 'running',
    messages: [],
    metadata_json: '{}',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function makeSharedSessionDetail(
  sessionId: string,
  workspacePath: string | null,
): SharedSessionDetailRecord {
  return {
    comments: [],
    pendingPermissions: [],
    pendingQuestions: [],
    presence: [],
    share: makeSharedSessionSummary(sessionId, workspacePath),
    session: makeSession({ id: sessionId, title: `共享会话 ${sessionId}` }),
  };
}

function makeRuntimeSession(id: string, workspacePath: string | null): TeamRuntimeSessionRecord {
  return {
    id,
    metadataJson: '{}',
    parentSessionId: null,
    stateStatus: 'running',
    title: `运行会话 ${id}`,
    updatedAt: '2026-04-04T00:00:00.000Z',
    workspacePath,
  };
}

function makeSessionShare(
  id: string,
  sessionId: string,
  workspacePath: string | null,
): TeamSessionShareRecord {
  return {
    id,
    sessionId,
    sessionLabel: `共享记录 ${sessionId}`,
    workspacePath,
    memberId: 'member-1',
    memberName: '林雾',
    memberEmail: 'linwu@openawork.local',
    permission: 'operate',
    createdAt: '2026-04-04T00:00:00.000Z',
    updatedAt: '2026-04-04T00:00:00.000Z',
  };
}

function buildInput(overrides: Partial<ProjectionInput> = {}): ProjectionInput {
  return {
    auditLogs: [],
    interactionRewriteArtifact: null,
    members: [],
    messages: [],
    onSelectSharedSession: vi.fn(),
    selectedSharedSession: null,
    selectedSharedSessionId: null,
    runtimeTaskGroups: [],
    sessionShares: [],
    sessions: [],
    sharedSessions: [],
    tasks: [],
    ...overrides,
  };
}

function HookHarness({
  input,
  onState,
}: {
  input: ProjectionInput;
  onState: (state: ProjectionState) => void;
}) {
  const state = useTeamRuntimeProjection(input);
  const onStateRef = useRef(onState);
  onStateRef.current = onState;

  useEffect(() => {
    onStateRef.current({ ...state });
  });

  return null;
}

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
});

async function flushAsync(cycles = 4) {
  for (let index = 0; index < cycles; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mountHarness(input: ProjectionInput) {
  let captured: ProjectionState | null = null;

  const render = async (nextInput: ProjectionInput) => {
    await act(async () => {
      root!.render(
        <HookHarness
          input={nextInput}
          onState={(state) => {
            captured = state;
          }}
        />,
      );
    });
    await flushAsync();
  };

  await render(input);

  return {
    getState: () => {
      if (!captured) {
        throw new Error('Projection state not captured');
      }
      return captured;
    },
    rerender: render,
  };
}

describe('useTeamRuntimeProjection', () => {
  it('filters sessions, shares and runtime task groups by the selected workspace key', async () => {
    const harness = await mountHarness(
      buildInput({
        sessions: [
          makeRuntimeSession('session-a', '/workspace/a'),
          makeRuntimeSession('session-b', '/workspace/b'),
        ],
        sessionShares: [
          makeSessionShare('share-a', 'session-a', '/workspace/a'),
          makeSessionShare('share-b', 'session-b', '/workspace/b'),
        ],
        sharedSessions: [
          makeSharedSessionSummary('session-a', '/workspace/a'),
          makeSharedSessionSummary('session-b', '/workspace/b'),
        ],
        runtimeTaskGroups: [
          {
            sessionIds: ['session-a'],
            tasks: [],
            updatedAt: 1,
            workspacePath: '/workspace/a',
          },
          {
            sessionIds: ['session-b'],
            tasks: [],
            updatedAt: 1,
            workspacePath: '/workspace/b',
          },
        ],
      }),
    );

    await act(async () => {
      harness.getState().setSelectedWorkspaceKey('/workspace/b');
    });
    await flushAsync();

    expect(harness.getState().selectedWorkspaceKey).toBe('/workspace/b');
    expect(harness.getState().filteredSessions.map((session) => session.id)).toEqual(['session-b']);
    expect(harness.getState().filteredSessionShares.map((share) => share.id)).toEqual(['share-b']);
    expect(harness.getState().filteredSharedSessions.map((session) => session.sessionId)).toEqual([
      'session-b',
    ]);
    expect(harness.getState().filteredRuntimeTaskGroups).toHaveLength(1);
    expect(harness.getState().selectedWorkspace?.label).toBe('/workspace/b');
  });

  it('resets an invalid selected workspace key back to ALL_WORKSPACES_KEY when summaries change', async () => {
    const initialInput = buildInput({
      sessions: [makeRuntimeSession('session-a', '/workspace/a')],
      sharedSessions: [makeSharedSessionSummary('session-a', '/workspace/a')],
    });
    const harness = await mountHarness(initialInput);

    await act(async () => {
      harness.getState().setSelectedWorkspaceKey('/workspace/a');
    });
    await flushAsync();
    expect(harness.getState().selectedWorkspaceKey).toBe('/workspace/a');

    await harness.rerender(buildInput());

    expect(harness.getState().selectedWorkspaceKey).toBe(ALL_WORKSPACES_KEY);
    expect(harness.getState().workspaceSummaries).toHaveLength(1);
  });

  it('requests a new shared session selection when the current selection is outside the filtered workspace', async () => {
    const onSelectSharedSession = vi.fn();
    const harness = await mountHarness(
      buildInput({
        onSelectSharedSession,
        selectedSharedSessionId: 'session-a',
        selectedSharedSession: makeSharedSessionDetail('session-a', '/workspace/a'),
        sharedSessions: [
          makeSharedSessionSummary('session-a', '/workspace/a'),
          makeSharedSessionSummary('session-b', '/workspace/b'),
        ],
      }),
    );

    await act(async () => {
      harness.getState().setSelectedWorkspaceKey('/workspace/b');
    });
    await flushAsync();

    expect(harness.getState().effectiveSelectedSharedSession).toBeNull();
    expect(harness.getState().selectedRunSummary).toBeNull();
    expect(onSelectSharedSession).toHaveBeenCalledWith('session-b');
  });

  it('exposes an empty-state projection when no shared session is selected', async () => {
    const harness = await mountHarness(buildInput());

    expect(harness.getState().selectedRunSummary).toBeNull();
    expect(harness.getState().workspaceOutputCards).toEqual([]);
    expect(harness.getState().buddyProjection.sessionTitle).toBeNull();
    expect(harness.getState().changeMetrics[0]?.value).toBe(0);
    expect(harness.getState().contextMetrics[0]?.value).toBe(0);
  });

  it('recomputes selected run summary and selected output cards when the selected shared session changes', async () => {
    const sharedSessionA = makeSharedSessionSummary('session-a', '/workspace/a');
    const sharedSessionB = makeSharedSessionSummary('session-b', '/workspace/a', {
      title: '共享会话 session-b',
    });

    const detailA: SharedSessionDetailRecord = {
      ...makeSharedSessionDetail('session-a', '/workspace/a'),
      comments: [
        {
          id: 'comment-a',
          content: 'comment-a',
          authorEmail: 'a@openawork.local',
          createdAt: '2026-04-04T00:00:00.000Z',
          sessionId: 'session-a',
        },
      ],
      pendingPermissions: [
        {
          requestId: 'perm-a',
          sessionId: 'session-a',
          toolName: 'write_file',
          scope: '/workspace/a',
          reason: 'need write access',
          riskLevel: 'medium',
          status: 'pending',
          createdAt: '2026-04-04T00:00:00.000Z',
        },
      ],
      pendingQuestions: [],
      presence: [
        {
          viewerUserId: 'viewer-a',
          viewerEmail: 'viewer-a@openawork.local',
          active: true,
          firstSeenAt: '2026-04-04T00:00:00.000Z',
          lastSeenAt: '2026-04-04T00:00:00.000Z',
        },
      ],
      share: sharedSessionA,
      session: {
        ...makeSession({ id: 'session-a', title: '共享会话 session-a' }),
        fileChangesSummary: {
          latestSnapshotAt: '2026-04-04T00:00:00.000Z',
          latestSnapshotScopeKind: 'scope',
          sourceKinds: ['session_snapshot'],
          snapshotCount: 1,
          totalAdditions: 5,
          totalDeletions: 1,
          totalFileDiffs: 2,
          weakestGuaranteeLevel: 'medium',
        },
      },
    };

    const detailB: SharedSessionDetailRecord = {
      ...makeSharedSessionDetail('session-b', '/workspace/a'),
      comments: [
        {
          id: 'comment-b-1',
          content: 'comment-b-1',
          authorEmail: 'b@openawork.local',
          createdAt: '2026-04-04T00:00:00.000Z',
          sessionId: 'session-b',
        },
        {
          id: 'comment-b-2',
          content: 'comment-b-2',
          authorEmail: 'b2@openawork.local',
          createdAt: '2026-04-04T00:00:00.000Z',
          sessionId: 'session-b',
        },
      ],
      pendingPermissions: [],
      pendingQuestions: [
        {
          requestId: 'question-b',
          sessionId: 'session-b',
          status: 'pending',
          title: 'Need input',
          toolName: 'ask-user',
          createdAt: '2026-04-05T00:00:00.000Z',
          questions: [
            {
              header: 'Need input',
              question: 'please answer',
              options: [{ label: '继续', description: '继续处理当前运行' }],
            },
          ],
        },
      ],
      presence: [
        {
          viewerUserId: 'viewer-b',
          viewerEmail: 'viewer-b@openawork.local',
          active: true,
          firstSeenAt: '2026-04-04T00:00:00.000Z',
          lastSeenAt: '2026-04-04T00:00:00.000Z',
        },
        {
          viewerUserId: 'viewer-c',
          viewerEmail: 'viewer-c@openawork.local',
          active: true,
          firstSeenAt: '2026-04-04T00:00:00.000Z',
          lastSeenAt: '2026-04-04T00:00:00.000Z',
        },
      ],
      share: sharedSessionB,
      session: {
        ...makeSession({ id: 'session-b', title: '共享会话 session-b' }),
        fileChangesSummary: {
          latestSnapshotAt: '2026-04-05T00:00:00.000Z',
          latestSnapshotScopeKind: 'request',
          sourceKinds: ['workspace_reconcile'],
          snapshotCount: 3,
          totalAdditions: 9,
          totalDeletions: 0,
          totalFileDiffs: 4,
          weakestGuaranteeLevel: 'weak',
        },
      },
    };

    const harness = await mountHarness(
      buildInput({
        selectedSharedSessionId: 'session-a',
        selectedSharedSession: detailA,
        sharedSessions: [sharedSessionA, sharedSessionB],
      }),
    );

    expect(harness.getState().selectedRunSummary?.title).toBe('共享会话 session-a');
    expect(harness.getState().selectedRunSummary?.commentCount).toBe(1);
    expect(harness.getState().selectedRunSummary?.pendingApprovalCount).toBe(1);

    await harness.rerender(
      buildInput({
        selectedSharedSessionId: 'session-b',
        selectedSharedSession: detailB,
        sharedSessions: [sharedSessionA, sharedSessionB],
      }),
    );

    expect(harness.getState().selectedRunSummary?.title).toBe('共享会话 session-b');
    expect(harness.getState().selectedRunSummary?.commentCount).toBe(2);
    expect(harness.getState().selectedRunSummary?.pendingApprovalCount).toBe(0);
    expect(harness.getState().selectedRunSummary?.pendingQuestionCount).toBe(1);
    expect(harness.getState().selectedRunSummary?.activeViewerCount).toBe(2);
    expect(harness.getState().workspaceOutputCards[0]?.title).toBe('共享会话 session-b');
  });
});
