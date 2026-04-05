// @vitest-environment jsdom

import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentProfileRecord } from '@openAwork/web-client';
import { useSessions } from './useSessions.js';
import { useAuthStore } from '../stores/auth.js';
import { useUIStateStore } from '../stores/uiState.js';
import { publishSessionRunState, requestSessionListRefresh } from '../utils/session-list-events.js';

let listedSessionStateStatus: 'idle' | 'running' | 'paused' = 'idle';

const listMock = vi.fn(async () => [
  {
    id: 'session-1',
    title: '会话一',
    state_status: listedSessionStateStatus,
    updated_at: '2026-03-22T10:00:00.000Z',
    metadata_json: JSON.stringify({ workingDirectory: '/repo/project' }),
  },
]);
const createSessionMock = vi.fn(async () => ({ id: 'session-new' }));
const getCurrentAgentProfileMock = vi.fn(async (): Promise<AgentProfileRecord | null> => null);

vi.mock('../utils/chat-session-defaults.js', () => ({
  buildSavedChatSessionMetadata: vi.fn(
    (
      defaults: { toolSurfaceProfile: string },
      options?: { parentSessionId?: string | null; workingDirectory?: string | null },
    ) => ({
      ...(options?.workingDirectory ? { workingDirectory: options.workingDirectory } : {}),
      ...(options?.parentSessionId ? { parentSessionId: options.parentSessionId } : {}),
      toolSurfaceProfile: defaults.toolSurfaceProfile,
    }),
  ),
  loadSavedChatSessionDefaults: vi.fn(async () => ({
    defaults: {
      providerId: 'openai',
      modelId: 'gpt-5',
      thinkingEnabled: false,
      reasoningEffort: 'medium',
      toolSurfaceProfile: 'claude_code_default',
    },
    providers: [],
  })),
}));

vi.mock('@openAwork/web-client', () => ({
  createAgentProfilesClient: vi.fn(() => ({
    getCurrent: getCurrentAgentProfileMock,
  })),
  createSessionsClient: vi.fn(() => ({
    list: listMock,
    create: createSessionMock,
    get: vi.fn(async () => ({ messages: [] })),
    delete: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined),
    importSession: vi.fn(async () => ({ sessionId: 'imported' })),
  })),
  withTokenRefresh: vi.fn(
    async (_gatewayUrl: string, _store: unknown, fn: (token: string) => Promise<unknown>) =>
      fn('token-123'),
  ),
  HttpError: class HttpError extends Error {
    status: number;

    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock('../components/ToastNotification.js', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('../utils/session-transfer.js', () => ({
  exportSession: vi.fn(async () => undefined),
}));

function HookHarness({ onReady }: { onReady: (value: ReturnType<typeof useSessions>) => void }) {
  const sessionsState = useSessions();

  useEffect(() => {
    onReady(sessionsState);
  }, [onReady, sessionsState]);

  return null;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  listMock.mockClear();
  createSessionMock.mockClear();
  getCurrentAgentProfileMock.mockClear();
  listedSessionStateStatus = 'idle';
  window.sessionStorage.clear();
  useAuthStore.setState({
    accessToken: 'token-123',
    refreshToken: null,
    tokenExpiresAt: Date.now() + 60_000,
    email: 'admin@openAwork.local',
    gatewayUrl: 'http://localhost:3000',
    webAccessEnabled: false,
    webPort: 3000,
  });
  useUIStateStore.setState({
    savedWorkspacePaths: [],
  });

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }

  root = null;
  container?.remove();
  container = null;
  vi.restoreAllMocks();
  delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
});

describe('useSessions run-state overrides', () => {
  it('applies published run state immediately and clears when idle is published', async () => {
    let sessionsState: ReturnType<typeof useSessions> | null = null;
    const getSessionsState = (): ReturnType<typeof useSessions> => {
      if (!sessionsState) {
        throw new Error('useSessions state not ready');
      }

      return sessionsState;
    };

    await act(async () => {
      root!.render(
        <MemoryRouter initialEntries={['/chat/session-1']}>
          <Routes>
            <Route
              path="*"
              element={
                <HookHarness
                  onReady={(value) => {
                    sessionsState = value;
                  }}
                />
              }
            />
          </Routes>
        </MemoryRouter>,
      );
    });

    await flushEffects();

    expect(listMock).toHaveBeenCalledTimes(1);
    expect(getSessionsState().sessions[0]?.state_status).toBe('idle');

    await act(async () => {
      publishSessionRunState('session-1', 'running');
      await Promise.resolve();
    });

    expect(getSessionsState().sessions[0]?.state_status).toBe('running');

    await act(async () => {
      publishSessionRunState('session-1', 'idle');
      await Promise.resolve();
    });

    expect(getSessionsState().sessions[0]?.state_status).toBe('idle');
  });

  it('clears a stale running override after refresh when backend is idle and no active stream remains', async () => {
    let sessionsState: ReturnType<typeof useSessions> | null = null;
    const getSessionsState = (): ReturnType<typeof useSessions> => {
      if (!sessionsState) {
        throw new Error('useSessions state not ready');
      }

      return sessionsState;
    };

    await act(async () => {
      root!.render(
        <MemoryRouter initialEntries={['/chat/session-1']}>
          <Routes>
            <Route
              path="*"
              element={
                <HookHarness
                  onReady={(value) => {
                    sessionsState = value;
                  }}
                />
              }
            />
          </Routes>
        </MemoryRouter>,
      );
    });

    await flushEffects();

    await act(async () => {
      publishSessionRunState('session-1', 'running');
      await Promise.resolve();
    });

    expect(getSessionsState().sessions[0]?.state_status).toBe('running');

    await act(async () => {
      requestSessionListRefresh();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(listMock).toHaveBeenCalledTimes(2);
    expect(getSessionsState().sessions[0]?.state_status).toBe('idle');
  });

  it('preserves a running override during refresh while the persisted active stream still matches', async () => {
    let sessionsState: ReturnType<typeof useSessions> | null = null;
    const getSessionsState = (): ReturnType<typeof useSessions> => {
      if (!sessionsState) {
        throw new Error('useSessions state not ready');
      }

      return sessionsState;
    };
    window.sessionStorage.setItem(
      'openAwork-active-stream:admin@openawork.local',
      JSON.stringify({
        clientRequestId: 'req-1',
        sessionId: 'session-1',
        startedAt: Date.now(),
      }),
    );

    await act(async () => {
      root!.render(
        <MemoryRouter initialEntries={['/chat/session-1']}>
          <Routes>
            <Route
              path="*"
              element={
                <HookHarness
                  onReady={(value) => {
                    sessionsState = value;
                  }}
                />
              }
            />
          </Routes>
        </MemoryRouter>,
      );
    });

    await flushEffects();

    await act(async () => {
      publishSessionRunState('session-1', 'running');
      await Promise.resolve();
    });

    expect(getSessionsState().sessions[0]?.state_status).toBe('running');

    await act(async () => {
      requestSessionListRefresh();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getSessionsState().sessions[0]?.state_status).toBe('running');
  });

  it('creates new sessions with the saved default tool surface profile in metadata', async () => {
    let sessionsState: ReturnType<typeof useSessions> | null = null;

    await act(async () => {
      root!.render(
        <MemoryRouter initialEntries={['/chat']}>
          <Routes>
            <Route
              path="*"
              element={
                <HookHarness
                  onReady={(value) => {
                    sessionsState = value;
                  }}
                />
              }
            />
          </Routes>
        </MemoryRouter>,
      );
    });

    await flushEffects();
    expect(sessionsState).not.toBeNull();

    await act(async () => {
      await sessionsState!.newSession('/workspace/demo', null);
      await Promise.resolve();
    });

    expect(createSessionMock).toHaveBeenCalledWith(
      'token-123',
      expect.objectContaining({
        metadata: expect.objectContaining({
          toolSurfaceProfile: 'claude_code_default',
          workingDirectory: '/workspace/demo',
        }),
      }),
    );
  });

  it('prefers the workspace agent profile over generic saved defaults when creating a new session', async () => {
    getCurrentAgentProfileMock.mockResolvedValueOnce({
      id: 'profile-1',
      workspacePath: '/workspace/demo',
      label: 'Demo Profile',
      agentId: 'sisyphus-junior',
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4.5',
      toolSurfaceProfile: 'claude_code_simple',
      note: null,
      createdAt: '2026-04-05T00:00:00.000Z',
      updatedAt: '2026-04-05T00:00:00.000Z',
    });

    let sessionsState: ReturnType<typeof useSessions> | null = null;

    await act(async () => {
      root!.render(
        <MemoryRouter initialEntries={['/chat']}>
          <Routes>
            <Route
              path="*"
              element={
                <HookHarness
                  onReady={(value) => {
                    sessionsState = value;
                  }}
                />
              }
            />
          </Routes>
        </MemoryRouter>,
      );
    });

    await flushEffects();

    await act(async () => {
      await sessionsState!.newSession('/workspace/demo', null);
      await Promise.resolve();
    });

    expect(createSessionMock).toHaveBeenCalledWith(
      'token-123',
      expect.objectContaining({
        metadata: expect.objectContaining({
          agentId: 'sisyphus-junior',
          modelId: 'claude-sonnet-4.5',
          providerId: 'anthropic',
          toolSurfaceProfile: 'claude_code_simple',
          workingDirectory: '/workspace/demo',
        }),
      }),
    );
  });
});
