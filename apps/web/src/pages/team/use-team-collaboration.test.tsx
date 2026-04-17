// @vitest-environment jsdom

import { act, useEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Session,
  SharedSessionDetailRecord,
  SharedSessionPresenceRecord,
  SharedSessionSummaryRecord,
  TeamClient,
  TeamRuntimeReadModel,
} from '@openAwork/web-client';
import { useAuthStore } from '../../stores/auth.js';
import { useTeamCollaboration } from './use-team-collaboration.js';

const mockGetRuntime = vi.fn<TeamClient['getRuntime']>();
const mockGetSharedSessionDetail = vi.fn<TeamClient['getSharedSessionDetail']>();
const mockTouchSharedSessionPresence = vi.fn<TeamClient['touchSharedSessionPresence']>();
const mockCreateSharedSessionComment = vi.fn<TeamClient['createSharedSessionComment']>();
const mockReplySharedSessionPermission = vi.fn<TeamClient['replySharedSessionPermission']>();
const mockReplySharedSessionQuestion = vi.fn<TeamClient['replySharedSessionQuestion']>();
const mockCreateMember = vi.fn<TeamClient['createMember']>();
const mockCreateTask = vi.fn<TeamClient['createTask']>();
const mockUpdateTask = vi.fn<TeamClient['updateTask']>();
const mockCreateMessage = vi.fn<TeamClient['createMessage']>();
const mockCreateSessionShare = vi.fn<TeamClient['createSessionShare']>();
const mockUpdateSessionShare = vi.fn<TeamClient['updateSessionShare']>();
const mockDeleteSessionShare = vi.fn<TeamClient['deleteSessionShare']>();
const mockUpdateSessionState = vi.fn<TeamClient['updateSessionState']>();
const mockDeleteSession = vi.fn<TeamClient['deleteSession']>();

vi.mock('@openAwork/web-client', async () => {
  const actual =
    await vi.importActual<typeof import('@openAwork/web-client')>('@openAwork/web-client');

  return {
    ...actual,
    createTeamClient: () => ({
      getRuntime: mockGetRuntime,
      getSharedSessionDetail: mockGetSharedSessionDetail,
      touchSharedSessionPresence: mockTouchSharedSessionPresence,
      createSharedSessionComment: mockCreateSharedSessionComment,
      replySharedSessionPermission: mockReplySharedSessionPermission,
      replySharedSessionQuestion: mockReplySharedSessionQuestion,
      createMember: mockCreateMember,
      createTask: mockCreateTask,
      updateTask: mockUpdateTask,
      createMessage: mockCreateMessage,
      createSessionShare: mockCreateSessionShare,
      updateSessionShare: mockUpdateSessionShare,
      deleteSessionShare: mockDeleteSessionShare,
      updateSessionState: mockUpdateSessionState,
      deleteSession: mockDeleteSession,
    }),
  };
});

function makeSharedSessionSummary(
  sessionId: string,
  overrides: Partial<SharedSessionSummaryRecord> = {},
): SharedSessionSummaryRecord {
  return {
    sessionId,
    title: `共享会话 ${sessionId}`,
    stateStatus: 'running',
    workspacePath: '/workspace/demo',
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

function makeSharedSessionDetail(sessionId: string): SharedSessionDetailRecord {
  return {
    comments: [],
    pendingPermissions: [],
    pendingQuestions: [],
    presence: [],
    share: makeSharedSessionSummary(sessionId),
    session: makeSession({ id: sessionId, title: `共享会话 ${sessionId}` }),
  };
}

function makeRuntime(overrides: Partial<TeamRuntimeReadModel> = {}): TeamRuntimeReadModel {
  return {
    auditLogs: [],
    members: [],
    messages: [],
    runtimeTaskGroups: [],
    sessionShares: [],
    sessions: [],
    sharedSessions: [],
    tasks: [],
    ...overrides,
  };
}

function HookHarness({
  onState,
  enabled,
  teamWorkspaceId,
}: {
  onState: (state: ReturnType<typeof useTeamCollaboration>) => void;
  enabled?: boolean;
  teamWorkspaceId?: string;
}) {
  const state = useTeamCollaboration(teamWorkspaceId, { enabled });
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
  vi.clearAllMocks();
  useAuthStore.setState({ accessToken: 'token-123', gatewayUrl: 'http://localhost:3000' });
  mockGetRuntime.mockResolvedValue(makeRuntime());
  mockGetSharedSessionDetail.mockResolvedValue(makeSharedSessionDetail('session-a'));
  mockTouchSharedSessionPresence.mockResolvedValue([] as SharedSessionPresenceRecord[]);
  mockCreateSharedSessionComment.mockResolvedValue({
    authorEmail: 'owner@openawork.local',
    content: 'comment',
    createdAt: '2026-04-04T00:00:00.000Z',
    id: 'comment-1',
    sessionId: 'session-a',
  });
  mockReplySharedSessionPermission.mockResolvedValue();
  mockReplySharedSessionQuestion.mockResolvedValue();
  mockCreateMember.mockResolvedValue({
    id: 'member-1',
    name: '林雾',
    email: 'linwu@openawork.local',
    role: 'owner',
    avatarUrl: null,
    status: 'working',
    createdAt: '2026-04-04T00:00:00.000Z',
  });
  mockCreateTask.mockResolvedValue({
    id: 'task-1',
    title: '任务',
    assigneeId: null,
    status: 'pending',
    priority: 'medium',
    result: null,
    createdAt: '2026-04-04T00:00:00.000Z',
    updatedAt: '2026-04-04T00:00:00.000Z',
  });
  mockUpdateTask.mockResolvedValue();
  mockCreateMessage.mockResolvedValue({
    id: 'message-1',
    memberId: 'member-1',
    content: 'update',
    type: 'update',
    timestamp: Date.now(),
  });
  mockCreateSessionShare.mockResolvedValue({
    id: 'share-1',
    sessionId: 'session-a',
    sessionLabel: '共享会话 session-a',
    workspacePath: '/workspace/demo',
    memberId: 'member-1',
    memberName: '林雾',
    memberEmail: 'linwu@openawork.local',
    permission: 'operate',
    createdAt: '2026-04-04T00:00:00.000Z',
    updatedAt: '2026-04-04T00:00:00.000Z',
  });
  mockUpdateSessionShare.mockResolvedValue({
    id: 'share-1',
    sessionId: 'session-a',
    sessionLabel: '共享会话 session-a',
    workspacePath: '/workspace/demo',
    memberId: 'member-1',
    memberName: '林雾',
    memberEmail: 'linwu@openawork.local',
    permission: 'view',
    createdAt: '2026-04-04T00:00:00.000Z',
    updatedAt: '2026-04-04T00:00:00.000Z',
  });
  mockDeleteSessionShare.mockResolvedValue();
  mockUpdateSessionState.mockResolvedValue();
  mockDeleteSession.mockResolvedValue(['session-a']);

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

async function flushAsync(cycles = 6) {
  for (let index = 0; index < cycles; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mountHarness(teamWorkspaceId?: string, enabled = true) {
  let captured: ReturnType<typeof useTeamCollaboration> | null = null;

  await act(async () => {
    root!.render(
      <HookHarness
        enabled={enabled}
        teamWorkspaceId={teamWorkspaceId}
        onState={(state) => {
          captured = state;
        }}
      />,
    );
  });

  await flushAsync();

  return {
    getState: () => {
      if (!captured) {
        throw new Error('Hook state not captured');
      }

      return captured;
    },
  };
}

describe('useTeamCollaboration', () => {
  it('returns an empty read model without calling Team APIs when accessToken is missing', async () => {
    useAuthStore.setState({ accessToken: null });

    const harness = await mountHarness();
    const state = harness.getState();

    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.feedback).toBeNull();
    expect(state.sharedSessions).toEqual([]);
    expect(state.selectedSharedSessionId).toBeNull();
    expect(state.selectedSharedSession).toBeNull();
    expect(state.runtimeTaskRecords).toEqual([]);
    expect(mockGetRuntime).not.toHaveBeenCalled();
    expect(mockGetSharedSessionDetail).not.toHaveBeenCalled();
  });

  it('does not request team runtime while collaboration loading is disabled', async () => {
    const harness = await mountHarness(undefined, false);
    const state = harness.getState();

    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.sessions).toEqual([]);
    expect(state.sharedSessions).toEqual([]);
    expect(mockGetRuntime).not.toHaveBeenCalled();
  });

  it('degrades gracefully when the selected shared session detail request fails', async () => {
    mockGetRuntime.mockResolvedValue(
      makeRuntime({ sharedSessions: [makeSharedSessionSummary('session-a')] }),
    );
    mockGetSharedSessionDetail.mockRejectedValue(new Error('shared detail failed'));

    const harness = await mountHarness();
    const state = harness.getState();

    expect(state.sharedSessions).toHaveLength(1);
    expect(state.selectedSharedSessionId).toBe('session-a');
    expect(state.selectedSharedSession).toBeNull();
    expect(state.sharedSessionLoading).toBe(false);
    expect(state.error).toBe('shared detail failed');
    expect(mockTouchSharedSessionPresence).toHaveBeenCalledWith('token-123', 'session-a');
  });

  it('falls back to the first remaining shared session when the current selection disappears after refresh', async () => {
    mockGetRuntime.mockResolvedValue(
      makeRuntime({
        sharedSessions: [
          makeSharedSessionSummary('session-a'),
          makeSharedSessionSummary('session-b', {
            shareUpdatedAt: '2026-04-05T00:00:00.000Z',
            updatedAt: '2026-04-05T00:00:00.000Z',
          }),
        ],
      }),
    );
    mockGetSharedSessionDetail.mockImplementation(async (_token, sessionId) =>
      makeSharedSessionDetail(sessionId),
    );

    const harness = await mountHarness();

    await act(async () => {
      harness.getState().setSelectedSharedSessionId('session-b');
    });
    await flushAsync();

    expect(harness.getState().selectedSharedSessionId).toBe('session-b');
    expect(harness.getState().selectedSharedSession?.share.sessionId).toBe('session-b');

    mockGetRuntime.mockResolvedValue(
      makeRuntime({ sharedSessions: [makeSharedSessionSummary('session-a')] }),
    );

    await act(async () => {
      await harness.getState().refresh();
    });
    await flushAsync();

    expect(harness.getState().sharedSessions).toHaveLength(1);
    expect(harness.getState().selectedSharedSessionId).toBe('session-a');
    expect(harness.getState().selectedSharedSession?.share.sessionId).toBe('session-a');
  });

  it('passes the current teamWorkspaceId into the runtime request', async () => {
    await mountHarness('workspace-1');

    expect(mockGetRuntime).toHaveBeenCalledWith('token-123', { teamWorkspaceId: 'workspace-1' });
  });
});
