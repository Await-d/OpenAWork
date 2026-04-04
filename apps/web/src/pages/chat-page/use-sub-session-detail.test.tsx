// @vitest-environment jsdom

import { act, useEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingPermissionRequest, Session, SessionTask } from '@openAwork/web-client';
import { useSubSessionDetail, type SubSessionDetailState } from './use-sub-session-detail.js';

const mockSessionsGet = vi.fn();
const mockGetTasks = vi.fn();
const mockListPending = vi.fn();

vi.mock('@openAwork/web-client', () => ({
  createSessionsClient: () => ({
    get: mockSessionsGet,
    getTasks: mockGetTasks,
  }),
  createPermissionsClient: () => ({
    listPending: mockListPending,
  }),
}));

vi.mock('./support.js', () => ({
  normalizeChatMessages: (_messages: unknown[]) => [],
}));

vi.mock('./transcript-visibility.js', () => ({
  filterTranscriptMessages: (messages: unknown[]) => messages,
}));

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'child-1',
    state_status: 'idle',
    title: '子代理',
    messages: [],
    metadata_json: undefined,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function makeTask(overrides: Partial<SessionTask> = {}): SessionTask {
  return {
    id: 'task-1',
    title: '任务标题',
    status: 'pending',
    blockedBy: [],
    completedSubtaskCount: 0,
    readySubtaskCount: 0,
    priority: 'medium',
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    depth: 0,
    subtaskCount: 0,
    unmetDependencyCount: 0,
    ...overrides,
  };
}

function makePermission(
  overrides: Partial<PendingPermissionRequest> = {},
): PendingPermissionRequest {
  return {
    requestId: 'req-1',
    sessionId: 'child-1',
    toolName: 'bash',
    reason: '执行 shell 命令',
    scope: 'session',
    riskLevel: 'medium',
    status: 'pending',
    createdAt: new Date().toISOString(),
    previewAction: undefined,
    decision: undefined,
    ...overrides,
  };
}

function HookHarness({
  childSessionId,
  onState,
}: {
  childSessionId: string | null;
  onState: (state: SubSessionDetailState) => void;
}) {
  const state = useSubSessionDetail(childSessionId, 'http://gateway', 'token-abc');
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
  mockSessionsGet.mockResolvedValue(makeSession());
  mockGetTasks.mockResolvedValue([]);
  mockListPending.mockResolvedValue([]);
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

async function mountHarness(childSessionId: string | null): Promise<SubSessionDetailState> {
  let captured: SubSessionDetailState | null = null;
  await act(async () => {
    root!.render(
      <HookHarness
        childSessionId={childSessionId}
        onState={(s) => {
          captured = s;
        }}
      />,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
  return captured!;
}

describe('useSubSessionDetail', () => {
  describe('initial state', () => {
    it('initialises with empty collections when childSessionId is null', async () => {
      const state = await mountHarness(null);
      expect(state.loading).toBe(false);
      expect(state.tasks).toEqual([]);
      expect(state.pendingPermissions).toEqual([]);
      expect(state.session).toBeNull();
      expect(state.error).toBeNull();
    });
  });

  describe('successful fetch', () => {
    it('fetches session, tasks and permissions in parallel', async () => {
      const task = makeTask({ id: 'task-1', sessionId: 'child-1', status: 'running' });
      const permission = makePermission({ requestId: 'req-1' });
      mockGetTasks.mockResolvedValue([task]);
      mockListPending.mockResolvedValue([permission]);

      const state = await mountHarness('child-1');

      expect(state.tasks).toHaveLength(1);
      expect(state.tasks[0]?.id).toBe('task-1');
      expect(state.pendingPermissions).toHaveLength(1);
      expect(state.pendingPermissions[0]?.requestId).toBe('req-1');
      expect(state.error).toBeNull();
    });
  });

  describe('graceful degradation', () => {
    it('keeps tasks when listPending rejects', async () => {
      mockGetTasks.mockResolvedValue([makeTask()]);
      mockListPending.mockRejectedValue(new Error('404 not found'));

      const state = await mountHarness('child-1');

      expect(state.pendingPermissions).toEqual([]);
      expect(state.tasks).toHaveLength(1);
      expect(state.error).toBeNull();
    });

    it('keeps permissions when getTasks rejects', async () => {
      mockGetTasks.mockRejectedValue(new Error('500 internal error'));
      mockListPending.mockResolvedValue([makePermission()]);

      const state = await mountHarness('child-1');

      expect(state.tasks).toEqual([]);
      expect(state.pendingPermissions).toHaveLength(1);
      expect(state.error).toBeNull();
    });

    it('sets error when session fetch fails', async () => {
      mockSessionsGet.mockRejectedValue(new Error('Network failure'));

      const state = await mountHarness('child-1');

      expect(state.error).toBe('Network failure');
      expect(state.tasks).toEqual([]);
      expect(state.pendingPermissions).toEqual([]);
    });
  });

  describe('session switch', () => {
    it('resets all state when childSessionId becomes null', async () => {
      mockGetTasks.mockResolvedValue([makeTask()]);
      mockListPending.mockResolvedValue([makePermission()]);

      await mountHarness('child-1');

      const state = await mountHarness(null);

      expect(state.tasks).toEqual([]);
      expect(state.pendingPermissions).toEqual([]);
      expect(state.session).toBeNull();
    });
  });
});
