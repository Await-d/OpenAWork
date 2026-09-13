/**
 * useSessions.newSession —— 草稿会话语义回归测试
 *
 * 需求：点击「新建会话」不立即落库空会话，真正的会话在用户发出首条消息时
 * 由 ChatPage 惰性创建，因此连续点击不会堆积空对话。
 */
import type { ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessions } from './useSessions.js';
import { useAuthStore } from '../../stores/auth/auth.js';
import { useUIStateStore } from '../../stores/ui/uiState.js';

const sessionsClientMocks = vi.hoisted(() => ({
  create: vi.fn(async () => ({ id: 'created-session' })),
  list: vi.fn(async () => []),
}));

vi.mock('@openAwork/web-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openAwork/web-client')>();
  return {
    ...actual,
    createSessionsClient: () => ({
      create: sessionsClientMocks.create,
      list: sessionsClientMocks.list,
    }),
  };
});

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname}</div>;
}

function createWrapper(initialPath = '/chat/session-1') {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={[initialPath]}>
        {children}
        <LocationProbe />
      </MemoryRouter>
    );
  };
}

function renderUseSessions(initialPath?: string) {
  return renderHook(() => useSessions(), { wrapper: createWrapper(initialPath) });
}

beforeEach(() => {
  sessionsClientMocks.create.mockClear();
  sessionsClientMocks.list.mockClear();
  useAuthStore.setState({ accessToken: 'test-token', gatewayUrl: 'http://localhost:3000' });
  useUIStateStore.setState({
    activeTabId: null,
    chatView: 'session',
    savedWorkspacePaths: [],
    selectedWorkspacePath: null,
    tabs: [],
  });
});

afterEach(() => {
  cleanup();
});

describe('useSessions.newSession — 草稿会话', () => {
  it('不创建服务端会话，只切到 /chat 草稿态', async () => {
    const { result } = renderUseSessions();

    await act(async () => {
      await result.current.newSession();
    });

    expect(sessionsClientMocks.create).not.toHaveBeenCalled();
    expect(useUIStateStore.getState().chatView).toBe('home');
    expect(window.document.querySelector('[data-testid="location-probe"]')?.textContent).toBe(
      '/chat',
    );
    expect(useUIStateStore.getState().tabs).toHaveLength(1);
    expect(useUIStateStore.getState().tabs[0]?.type).toBe('draft');
  });

  it('连续点击复用同一个草稿标签，不会无限堆积空对话', async () => {
    const { result } = renderUseSessions();

    await act(async () => {
      await result.current.newSession();
      await result.current.newSession();
      await result.current.newSession();
    });

    expect(sessionsClientMocks.create).not.toHaveBeenCalled();
    expect(useUIStateStore.getState().tabs).toHaveLength(1);
  });

  it('带工作区新建时把草稿绑定到该工作区', async () => {
    const { result } = renderUseSessions();

    await act(async () => {
      await result.current.newSession('/ws/a');
    });

    const state = useUIStateStore.getState();
    expect(sessionsClientMocks.create).not.toHaveBeenCalled();
    expect(state.selectedWorkspacePath).toBe('/ws/a');
    expect(state.savedWorkspacePaths).toContain('/ws/a');
    expect(state.tabs[0]?.workspacePath).toBe('/ws/a');
  });
});
