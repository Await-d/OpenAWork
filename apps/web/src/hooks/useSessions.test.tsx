// @vitest-environment jsdom

import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

vi.mock('@openAwork/web-client', () => ({
  createSessionsClient: vi.fn(() => ({
    list: listMock,
    create: vi.fn(async () => ({ id: 'session-new' })),
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
});
